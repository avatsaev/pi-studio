import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

import { helperCommand } from "../runtime/self.js";

/**
 * The update restart helper (features/self-update.md § The helper). A detached `node -e` process
 * started before the daemon shuts down: it waits for the old daemon to exit, starts the new one,
 * checks `/api/health` for the new version, rolls back to the previous version when it never
 * answers, and leaves `update-result.json` for the next daemon start.
 *
 * The script is ONE self-contained text that imports nothing from this package (only `node:`
 * built-ins): the package is replaced under it. Its decision logic (`HELPER_LOGIC`) takes every
 * side effect as an injected seam and is also compiled by `compileHelperLogic()` so the tests drive
 * the very code that ships; the real seams (`HELPER_MAIN`) are a thin layer over Node built-ins.
 *
 * Both parts are JS text inside a template literal: they must contain no backtick and no `${`.
 */

/** What the daemon hands the helper (JSON in `argv[1]`; the environment is carried in `env`). */
export interface HelperParams {
  /** The old daemon's pid: the helper waits for it to exit. */
  oldPid: number;
  /** The version just installed. */
  target: string;
  /** The version running before the update (the rollback). */
  previous: string;
  /** The address the old daemon was bound to, `host:port`. */
  listen: string;
  /** `$PI_STUDIO_HOME`: where the log and the result file live. */
  home: string;
  /** The npm package to install again on rollback. */
  packageName: string;
}

/** The result file the next daemon start reads (`update-result.json`). */
export interface HelperResult {
  from: string;
  to: string;
  outcome: "updated" | "rolled_back" | "failed";
  at: number;
  message?: string;
}

/** A daemon process the helper started. */
export interface StartedDaemon {
  pid: number | undefined;
  hasExited(): boolean;
  /** SIGTERM, then SIGKILL after a grace period; resolves once it is gone. */
  stop(): Promise<void>;
}

/** Every side effect of the helper's logic. */
export interface HelperSeams {
  now(): number;
  sleep(ms: number): Promise<void>;
  /** One line of `logs/update-restart.log`. */
  log(line: string): void;
  /** Resolves `true` once `pid` is gone, `false` after `timeoutMs`. */
  waitForExit(pid: number, timeoutMs: number): Promise<boolean>;
  /** The daemon's `main.js` after the install (both npm layouts), preferring the one of `version`. */
  findEntry(version: string): Promise<string | null>;
  /** Starts the daemon detached, with the carried environment; throws when it cannot spawn. */
  startDaemon(entry: string): StartedDaemon;
  /** The `version` `/api/health` answers with, `null` when it does not answer. */
  healthVersion(): Promise<string | null>;
  /** `npm install -g <package>@<version>` (120 s). */
  installPrevious(version: string): Promise<{ ok: boolean; message: string }>;
  writeResult(result: HelperResult): void | Promise<void>;
}

export const HELPER_EXIT_WAIT_MS = 30_000;
export const HELPER_HEALTH_WAIT_MS = 6_000;
export const HELPER_TRIES = 3;

/** Decision logic: no `require`, no globals but the language's. Defines `runHelper(params, seams)`. */
export const HELPER_LOGIC = String.raw`
var EXIT_WAIT_MS = 30000;
var HEALTH_WAIT_MS = 6000;
var HEALTH_POLL_MS = 250;
var TRIES = 3;
var MESSAGE_MAX = 2048;

function healthUrl(listen) {
  var idx = listen.lastIndexOf(":");
  var host = listen.slice(0, idx);
  var port = listen.slice(idx + 1);
  if (host === "" || host === "0.0.0.0" || host === "::" || host === "[::]") host = "127.0.0.1";
  if (host.indexOf(":") !== -1 && host.charAt(0) !== "[") host = "[" + host + "]";
  return "http://" + host + ":" + port + "/api/health";
}

function tail(text) {
  return text.length > MESSAGE_MAX ? text.slice(text.length - MESSAGE_MAX) : text;
}

async function waitForVersion(version, proc, s) {
  var deadline = s.now() + HEALTH_WAIT_MS;
  for (;;) {
    var got = await s.healthVersion();
    if (got === version) return true;
    if (proc.hasExited()) return false;
    if (s.now() >= deadline) return false;
    await s.sleep(HEALTH_POLL_MS);
  }
}

async function startAndVerify(version, s) {
  for (var attempt = 1; attempt <= TRIES; attempt++) {
    var label = "start " + version + ", try " + attempt + "/" + TRIES + ": ";
    var entry = await s.findEntry(version);
    if (!entry) {
      s.log(label + "the daemon entry was not found");
      continue;
    }
    var proc;
    try {
      proc = s.startDaemon(entry);
    } catch (err) {
      s.log(label + "cannot start the daemon: " + (err && err.message ? err.message : String(err)));
      continue;
    }
    s.log(label + "started " + entry + " (pid " + proc.pid + ")");
    if (await waitForVersion(version, proc, s)) {
      s.log(label + "answers with version " + version);
      return true;
    }
    s.log(label + (proc.hasExited() ? "the daemon exited" : "no answer with version " + version + " within " + HEALTH_WAIT_MS / 1000 + " s") + "; stopping it");
    await proc.stop();
  }
  return false;
}

async function finish(p, s, outcome, message) {
  var result = { from: p.previous, to: p.target, outcome: outcome, at: s.now() };
  if (message) result.message = message;
  await s.writeResult(result);
  s.log("update " + outcome + (message ? ": " + message : ""));
  return result;
}

async function runHelper(p, s) {
  s.log("update helper: " + p.previous + " -> " + p.target + ", old pid " + p.oldPid + ", listen " + p.listen);
  var gone = await s.waitForExit(p.oldPid, EXIT_WAIT_MS);
  s.log(gone ? "the old daemon exited" : "the old daemon is still running after " + EXIT_WAIT_MS / 1000 + " s; going on");

  if (await startAndVerify(p.target, s)) return finish(p, s, "updated");

  s.log("the new version " + p.target + " does not start; installing " + p.previous + " again");
  var install = await s.installPrevious(p.previous);
  if (!install.ok) s.log("rollback install failed: " + install.message);

  if (await startAndVerify(p.previous, s)) {
    return finish(p, s, "rolled_back", p.target + " did not start on " + p.listen + "; back on " + p.previous + ".");
  }
  var command = "Run pi-studio daemon start to start it.";
  var message = "Neither " + p.target + " nor " + p.previous + " started. " + command + (install.ok ? "" : " The rollback install failed: " + install.message);
  var result = await finish(p, s, "failed", tail(message));
  s.log("The daemon is not running. " + command);
  return result;
}
`;

/** Real seams over Node built-ins, then the run. Needs `HELPER_LOGIC` in front of it. */
export const HELPER_MAIN = String.raw`
var cp = require("node:child_process");
var fs = require("node:fs");
var http = require("node:http");
var path = require("node:path");

function realSeams(p) {
  var logDir = path.join(p.home, "logs");
  fs.mkdirSync(logDir, { recursive: true });
  var logPath = path.join(logDir, "update-restart.log");
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var alive = function (pid) {
    try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
  };
  var run = function (command, args, timeout) {
    return new Promise(function (resolve) {
      cp.execFile(command, args, { timeout: timeout, env: process.env, maxBuffer: 4194304 }, function (err, stdout, stderr) {
        resolve({ err: err, stdout: String(stdout), stderr: String(stderr) });
      });
    });
  };
  var versionOf = function (dir) {
    try { return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version; } catch (e) { return null; }
  };
  return {
    now: Date.now,
    sleep: sleep,
    log: function (line) { fs.appendFileSync(logPath, new Date().toISOString() + " " + line + "\n"); },
    waitForExit: async function (pid, timeoutMs) {
      var end = Date.now() + timeoutMs;
      while (alive(pid)) {
        if (Date.now() >= end) return false;
        await sleep(100);
      }
      return true;
    },
    findEntry: async function (version) {
      var r = await run("npm", ["root", "-g"], 15000);
      var root = r.err ? "" : r.stdout.trim();
      if (!root) return null;
      var scope = path.join(root, "@av-pi-studio");
      var dirs = [path.join(scope, "server"), path.join(scope, "cli", "node_modules", "@av-pi-studio", "server")];
      var found = dirs.filter(function (d) { return fs.existsSync(path.join(d, "dist", "daemon", "main.js")); });
      var pick = found.filter(function (d) { return versionOf(d) === version; })[0] || found[0];
      return pick ? path.join(pick, "dist", "daemon", "main.js") : null;
    },
    startDaemon: function (entry) {
      var child = cp.spawn(process.execPath, [entry], { detached: true, stdio: "ignore", env: process.env });
      var exited = false;
      child.on("exit", function () { exited = true; });
      child.on("error", function () { exited = true; });
      child.unref();
      if (child.pid === undefined) throw new Error("spawn failed");
      return {
        pid: child.pid,
        hasExited: function () { return exited; },
        stop: async function () {
          if (exited) return;
          try { process.kill(child.pid, "SIGTERM"); } catch (e) { return; }
          var end = Date.now() + 5000;
          while (!exited && Date.now() < end) await sleep(100);
          if (!exited) { try { process.kill(child.pid, "SIGKILL"); } catch (e) { /* gone */ } }
        },
      };
    },
    healthVersion: function () {
      return new Promise(function (resolve) {
        var req = http.get(healthUrl(p.listen), { timeout: 1000 }, function (res) {
          var body = "";
          res.setEncoding("utf8");
          res.on("data", function (c) { body += c; });
          res.on("end", function () {
            try { var v = JSON.parse(body).version; resolve(typeof v === "string" ? v : null); } catch (e) { resolve(null); }
          });
          res.on("error", function () { resolve(null); });
        });
        req.on("timeout", function () { req.destroy(); });
        req.on("error", function () { resolve(null); });
      });
    },
    installPrevious: async function (version) {
      // --prefer-offline: the previous version was installed here, so npm's cache has it; with the
      // registry gone a plain install stalls for the whole 120 s and fails (live check, 2026-11-24).
      var r = await run("npm", ["install", "-g", p.packageName + "@" + version, "--prefer-offline"], 120000);
      return { ok: !r.err, message: r.err ? tail((r.stderr.trim() || r.err.message)) : "" };
    },
    writeResult: function (result) {
      var file = path.join(p.home, "update-result.json");
      var tmp = file + "." + process.pid + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(result), "utf8");
      fs.renameSync(tmp, file);
    },
  };
}

(async function () {
  var p = JSON.parse(process.argv[1]);
  var s = realSeams(p);
  try {
    await runHelper(p, s);
  } catch (err) {
    var message = "the update helper crashed: " + (err && err.stack ? err.stack : String(err));
    try { s.log(message); await s.writeResult({ from: p.previous, to: p.target, outcome: "failed", at: Date.now(), message: tail(message) }); } catch (e) { /* nothing left to try */ }
    process.exitCode = 1;
  }
  process.exit();
})();
`;

/** The text passed to `node -e`. */
export const HELPER_SCRIPT = HELPER_LOGIC + HELPER_MAIN;

/** The helper's decision logic as a function (the tests' entry; the daemon never calls it). */
export function compileHelperLogic(): (
  params: HelperParams,
  seams: HelperSeams,
) => Promise<HelperResult> {
  return new Function(`${HELPER_LOGIC}\nreturn runHelper;`)() as (
    params: HelperParams,
    seams: HelperSeams,
  ) => Promise<HelperResult>;
}

/** The slice of `child_process.spawn` the daemon uses; tests pass a fake. */
export type HelperSpawn = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => Pick<ChildProcess, "pid" | "unref" | "on">;

/**
 * Starts the helper detached from this process (it must outlive the daemon). The environment is
 * carried as it is, with `PI_STUDIO_LISTEN` and `PI_STUDIO_HOME` set to what the old daemon uses so
 * the new one binds the same address and reads the same home. Throws when the process cannot spawn.
 */
export function spawnUpdateHelper(
  params: HelperParams,
  env: NodeJS.ProcessEnv = process.env,
  spawnFn: HelperSpawn = spawn,
): void {
  const [command, ...args] = helperCommand(params, HELPER_SCRIPT);
  const child = spawnFn(command as string, args, {
    detached: true,
    stdio: "ignore",
    env: { ...env, PI_STUDIO_LISTEN: params.listen, PI_STUDIO_HOME: params.home },
  });
  // A spawn failure arrives as an event; without a listener it would crash the daemon.
  child.on("error", () => undefined);
  if (child.pid === undefined) throw new Error("failed to spawn the update helper");
  child.unref();
}
