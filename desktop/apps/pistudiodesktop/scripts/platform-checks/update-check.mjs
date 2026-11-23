#!/usr/bin/env node
// The release check of the app's self-update (spec `swe/features/desktop-self-update.md` § The
// release workflow, D8, U4, U6): install a build on this machine, launch it with `--control` and
// `--update-manifest`, have it find, download, install and restart into the offered build through
// the control socket, and prove the result. Run by `.github/workflows/desktop-release.yml` on a
// Linux, a macOS and a Windows runner; the same script runs against test builds (U5) and a local
// HTTP server.
//
//   node update-check.mjs --from <installer> --manifest <url> --expect-version <N> [--self-check-manifest <url>]
//   node update-check.mjs --self-check --from <installer> --manifest <url> [--expect-version <N>]
//
// P -> N: `--from` is the installer of the build before (P), `--manifest` is release N's
// `latest.json`; the running app must become version N. With `--self-check-manifest` (release N's
// `self-check.json`) the same install then proves N can update itself, so P and N share one install.
// N -> N: `--from` is N's installer, `--manifest` is `self-check.json`: the app is offered its own
// files under a higher version, and must end as a new process, on the same version, with the
// installed file replaced.
//
// One `--kind` per run (derived from the installer's name): `appimage` or `deb` on Linux, `app` (the
// `.dmg`) on macOS, `nsis` (the `-setup.exe`) on Windows. Linux needs a display (run under
// `xvfb-run`); `deb` needs passwordless `sudo`, and the script puts a polkit rule in for the user
// before the run and removes it after, so that the app's `pkexec` step succeeds without a person.
// The run prints one line per step, writes `summary.md` and `results.json` to `--out` beside the
// app's logs, appends the summary to the job summary (`GITHUB_STEP_SUMMARY`) and exits 1 when a
// step failed (2 for a bad command line).
//
// Every step has a time limit, so that a dialog nobody answers (the plug-in's administrator dialog
// on a `/Applications` the user cannot write to, a password box) fails the step instead of the job.
// The app is launched with a fixed control port and token file and a scratch `--config-dir`, and
// `--secret-store file`, so that nothing of a person's is touched; the restarted app takes the same
// options (spec § 6), so the script finds it on the same port.

import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, constants, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { access, chmod, copyFile } from "node:fs/promises";
import { arch, release, tmpdir, userInfo } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { launch, SECRET_STORE_ARG, waitForControlPort } from "./app-process.mjs";
import { ControlClient } from "./control-client.mjs";
import { freePort } from "./net.mjs";
import { killProcesses } from "./processes.mjs";
import { renderSummary, Report } from "./report.mjs";
import { Abort, sleep, waitFor } from "./wait.mjs";

// --- the command line ---------------------------------------------------------------------------

export const USAGE = `usage:
  node update-check.mjs --from <installer> --manifest <url> --expect-version <N> [--self-check-manifest <url>] [options]
  node update-check.mjs --self-check --from <installer> --manifest <url> [--expect-version <N>] [options]

  --from FILE                  the installer of the build to install first: appimage, .deb, .dmg or -setup.exe
                               (P with the first form, N with --self-check)
  --manifest URL               the manifest the app is pointed at (--update-manifest): release N's latest.json,
                               or its self-check.json with --self-check
  --expect-version N           the version that must run after the update (required unless --self-check)
  --self-check-manifest URL    after P -> N, also prove N updates itself, against this manifest (self-check.json)
  --self-check                 N -> N: the installed build is offered its own files under a higher version
  --kind KIND                  appimage, deb, app or nsis (default: from the installer's name)
  --install-timeout SECONDS    the limit of the download and install step (default 300)
  --out DIR                    where logs and the summary go (default update-check-out)
`;

/** The install kinds a system can run a check for, in the manifest's names (spec § 4). */
export const KINDS_BY_PLATFORM = { linux: ["appimage", "deb"], darwin: ["app"], win32: ["nsis"] };

/** The kind of installer a file is, from its name; a thrown Error when it is none of the four. */
export function installerKind(file) {
  const name = path.basename(file).toLowerCase();
  if (name.endsWith(".appimage")) return "appimage";
  if (name.endsWith(".deb")) return "deb";
  if (name.endsWith(".dmg")) return "app";
  if (name.endsWith("-setup.exe")) return "nsis";
  throw new Error(`cannot tell what kind of installer "${path.basename(file)}" is: it must end in .AppImage, .deb, .dmg or -setup.exe (or name --kind)`);
}

const PLAIN_VERSION = /^\d+\.\d+\.\d+$/;

function parseUrl(name, text) {
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`${name} is not an address: "${text}"`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`${name} must be an http or https address, got "${text}"`);
  return url.href;
}

/** The options of a run, or a thrown Error that names what is wrong. */
export function parseOptions(argv, platform = process.platform) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      from: { type: "string" },
      manifest: { type: "string" },
      "expect-version": { type: "string" },
      "self-check-manifest": { type: "string" },
      "self-check": { type: "boolean", default: false },
      kind: { type: "string" },
      "install-timeout": { type: "string", default: "300" },
      out: { type: "string", default: "update-check-out" },
    },
  });
  if (positionals.length > 0) throw new Error(`unexpected argument "${positionals[0]}"`);
  if (!values.from) throw new Error("--from is required");
  if (!values.manifest) throw new Error("--manifest is required");
  const selfCheckOnly = values["self-check"];
  const expectVersion = values["expect-version"];
  if (expectVersion !== undefined && !PLAIN_VERSION.test(expectVersion)) throw new Error(`--expect-version must be major.minor.patch, got "${expectVersion}"`);
  if (!selfCheckOnly && expectVersion === undefined) throw new Error("--expect-version is required (the version the update must reach)");
  if (selfCheckOnly && values["self-check-manifest"] !== undefined) throw new Error("--self-check-manifest belongs to the P -> N run; with --self-check the --manifest is the self check's");
  const kind = values.kind ?? installerKind(values.from);
  const allowed = KINDS_BY_PLATFORM[platform];
  if (!allowed) throw new Error(`there is no check for ${platform}`);
  if (!allowed.includes(kind)) throw new Error(`--kind ${kind} cannot run on ${platform}: it is one of ${allowed.join(", ")}`);
  const timeout = Number(values["install-timeout"]);
  if (!Number.isInteger(timeout) || timeout < 10) throw new Error("--install-timeout is a whole number of seconds, at least 10");
  return {
    from: values.from,
    kind,
    selfCheckOnly,
    manifest: parseUrl("--manifest", values.manifest),
    expectVersion,
    selfCheckManifest: values["self-check-manifest"] === undefined ? undefined : parseUrl("--self-check-manifest", values["self-check-manifest"]),
    installTimeoutMs: timeout * 1000,
    out: values.out,
  };
}

// --- what a stage must show --------------------------------------------------------------------

/**
 * The stages of a run, each an app launched at a manifest. `expect.version` is the version that must
 * run afterwards; a self check names none unless the caller did, and then the version before must stay.
 */
export function stagesOf(options) {
  if (options.selfCheckOnly) return [{ id: "self-check", manifest: options.manifest, selfCheck: true, version: options.expectVersion }];
  const stages = [{ id: "update", manifest: options.manifest, selfCheck: false, version: options.expectVersion }];
  if (options.selfCheckManifest !== undefined) stages.push({ id: "self-check", manifest: options.selfCheckManifest, selfCheck: true, version: options.expectVersion });
  return stages;
}

/** The states the new process may be in once it has started and looked: never an error, never half-way through an update. */
export function acceptableAfterStates(stage) {
  return stage.selfCheck ? ["idle", "checking", "available", "up_to_date"] : ["idle", "checking", "up_to_date"];
}

/** Whether an installed file was replaced: another file (inode), or written again (change or modification time). */
export function fileChanged(before, after) {
  return before.ino !== after.ino || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs;
}

/** One line for a state of `ui.inspect.update`, for messages: the state and the fields that explain it. */
export function describeUpdate(update) {
  if (!update || typeof update !== "object") return "no update part";
  const fields = ["version", "reason", "code", "received", "total"].filter((key) => update[key] !== undefined).map((key) => `${key}=${update[key]}`);
  return `${update.state}${fields.length > 0 ? ` (${fields.join(", ")})` : ""}`;
}

/**
 * What is wrong with a finished stage, as a list of sentences (empty: it passed). The facts are what
 * the script read: `before` and `after` are `{ version, kind, manifest, state?, lastError?, file }`,
 * `file` being `{ ino, mtimeMs, ctimeMs }`; `offered` is the version the check found; `oldExited`
 * whether the process that was running ended on its own; `newPids` the process ids that are there now
 * and were not before (`null` when the system could not list processes).
 */
export function judgeStage(stage, { before, offered, after, oldExited, newPids }) {
  const problems = [];
  if (before.manifest !== "override") problems.push(`the app did not take --update-manifest (manifest is "${before.manifest}")`);
  if (stage.selfCheck) {
    if (!offered || offered === before.version) problems.push(`the self check was offered "${offered}", which is not a version above ${before.version}`);
  } else if (offered !== stage.version) {
    problems.push(`the check offered version ${offered}, expected ${stage.version}`);
  }
  if (stage.version !== undefined && after.version !== stage.version) problems.push(`the app runs version ${after.version} after the restart, expected ${stage.version}`);
  if (stage.selfCheck && after.version !== before.version) problems.push(`the self check changed the version from ${before.version} to ${after.version}`);
  if (!stage.selfCheck && after.version === before.version) problems.push(`the version did not change (${before.version})`);
  if (after.kind !== before.kind) problems.push(`the install kind changed from ${before.kind} to ${after.kind}`);
  if (!oldExited) problems.push("the process that ran the old build did not exit");
  if (newPids !== null && newPids.length === 0) problems.push("no new process is running after the restart");
  if (!fileChanged(before.file, after.file)) problems.push("the installed file was not replaced (same file, same times)");
  if (after.lastError !== undefined) problems.push(`the new process reports the last error "${after.lastError}"`);
  const allowed = acceptableAfterStates(stage);
  if (after.state !== undefined && !allowed.includes(after.state)) problems.push(`the new process is in state "${after.state}", expected one of ${allowed.join(", ")}`);
  return problems;
}

// --- installing on a system ---------------------------------------------------------------------

/** The user name polkit's rule is written for: what the system's tools accept, nothing a rule's JavaScript could be broken by. */
const SAFE_USER = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

export const POLKIT_RULE_PATH = "/etc/polkit-1/rules.d/49-pi-studio-update-check.rules";

/** The polkit rule that lets `user` run `pkexec` without authentication (the runner has no agent to ask). */
export function polkitRule(user) {
  if (!SAFE_USER.test(user)) throw new Error(`cannot write a polkit rule for the user name "${user}"`);
  return [
    "polkit.addRule(function (action, subject) {",
    `  if (action.id == "org.freedesktop.policykit.exec" && subject.user == "${user}") {`,
    "    return polkit.Result.YES;",
    "  }",
    "});",
    "",
  ].join("\n");
}

/** The path of the product's binary inside an install: the Cargo package's name, `pistudiodesktop`. */
const BINARY = "pistudiodesktop";
const MAC_APP = "Pi Studio.app";

/**
 * Where a kind of install puts the app on this system. `exe` is the file whose replacement proves an
 * update; `launch` is what is run (the AppImage itself, or the binary). `home` is the per-user
 * directory (`LOCALAPPDATA` on Windows), `workDir` the run's scratch directory.
 */
export function installLayout(kind, { workDir, localAppData }) {
  switch (kind) {
    case "appimage": {
      const file = path.join(workDir, "install", "PiStudio.AppImage");
      return { exe: file, launch: file };
    }
    case "deb":
      return { exe: `/usr/bin/${BINARY}`, launch: `/usr/bin/${BINARY}` };
    case "app": {
      const exe = `/Applications/${MAC_APP}/Contents/MacOS/${BINARY}`;
      return { exe, launch: exe, bundle: `/Applications/${MAC_APP}` };
    }
    case "nsis": {
      const exe = path.win32.join(localAppData ?? "", "Pi Studio", `${BINARY}.exe`);
      return { exe, launch: exe };
    }
    default:
      throw new Error(`unknown install kind ${kind}`);
  }
}

const FIVE_MINUTES = 300_000;
const TEN_MINUTES = 600_000;

/**
 * The steps that install `installer` (an absolute path) for `kind`, as data: `{ op: "copy", from, to,
 * mode }` or `{ op: "run", command, args, timeoutMs, always?, tolerate? }`. `always` steps run even after
 * an earlier one failed (the disk image is detached); `tolerate` steps may fail (no quarantine mark to remove).
 * `mountPoint` is where the disk image is attached.
 */
export function installSteps(kind, installer, layout, mountPoint) {
  switch (kind) {
    case "appimage":
      return [{ op: "copy", from: installer, to: layout.launch, mode: 0o755 }];
    case "deb":
      return [
        {
          op: "run",
          command: "sudo",
          args: ["-n", "env", "DEBIAN_FRONTEND=noninteractive", "apt-get", "install", "-y", installer],
          timeoutMs: TEN_MINUTES,
        },
      ];
    case "app":
      return [
        { op: "run", command: "hdiutil", args: ["attach", "-nobrowse", "-readonly", "-noverify", "-mountpoint", mountPoint, installer], timeoutMs: FIVE_MINUTES },
        { op: "run", command: "ditto", args: [path.posix.join(mountPoint, MAC_APP), layout.bundle], timeoutMs: FIVE_MINUTES },
        { op: "run", command: "hdiutil", args: ["detach", mountPoint, "-force"], timeoutMs: 120_000, always: true },
        { op: "run", command: "xattr", args: ["-dr", "com.apple.quarantine", layout.bundle], timeoutMs: 60_000, tolerate: true },
      ];
    case "nsis":
      return [{ op: "run", command: installer, args: ["/S"], timeoutMs: FIVE_MINUTES }];
    default:
      throw new Error(`unknown install kind ${kind}`);
  }
}

/** What the app is started with: the control socket on a fixed port, a scratch configuration, files for secrets, the manifest. */
export function appArguments({ port, tokenFile, configDir, manifest }) {
  return ["--control", String(port), "--control-token-file", tokenFile, SECRET_STORE_ARG, "--config-dir", configDir, "--update-manifest", manifest];
}

const SECRET_LIKE = /key|token|secret|password|passphrase/i;

/** The environment the app gets: this one without anything that looks like a secret of the job (the app needs none). */
export function appEnvironment(source) {
  return Object.fromEntries(Object.entries(source).filter(([name, value]) => value !== undefined && !SECRET_LIKE.test(name)));
}

// --- the report ----------------------------------------------------------------------------------

export function headingFor(platform, kind, selfCheckOnly) {
  const system = { linux: "Linux", darwin: "macOS", win32: "Windows" }[platform] ?? platform;
  return `Desktop update check: ${system}, ${kind}${selfCheckOnly ? " (self check)" : ""}`;
}

/** The lines a stage prints and nobody asserts: versions, offered version, processes, the installed file before and after. */
export function stageFacts(stage, { before, offered, after, oldPids, newPids, downloaded }) {
  const file = (f) => `${f.size} bytes, sha256 ${f.sha256 ?? "not read"}, inode ${f.ino}, modified ${new Date(f.mtimeMs).toISOString()}`;
  return [
    `manifest ${stage.manifest}`,
    `version ${before.version} -> ${after.version} (offered ${offered})`,
    `install kind ${after.kind}; state after the restart ${after.state ?? "unknown"}`,
    `processes before ${oldPids.join(" ") || "none found"}; new ${newPids === null ? "not listed" : newPids.join(" ") || "none"}`,
    `download: ${downloaded}`,
    `installed file before: ${file(before.file)}`,
    `installed file after: ${file(after.file)}`,
  ];
}

// --- the system-touching parts ----------------------------------------------------------------

/** `command args` run to its end, with the limit and an optional standard input; rejects with the command's output on failure or timeout. */
function run(command, args, { timeoutMs, input, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    let output = "";
    const append = (chunk) => {
      output = (output + chunk).slice(-4000);
    };
    child.stdout.setEncoding("utf8").on("data", append);
    child.stderr.setEncoding("utf8").on("data", append);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`\`${command} ${args.join(" ")}\` did not finish within ${Math.round(timeoutMs / 1000)} s and was killed (a dialog may be waiting). Output:\n${output}`));
    }, timeoutMs ?? FIVE_MINUTES);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`\`${command}\` could not start: ${error.message}`));
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(`\`${command} ${args.join(" ")}\` ended with ${signal ?? `code ${code}`}. Output:\n${output}`));
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

const execFileText = (command, args) =>
  new Promise((resolve) => execFile(command, args, { timeout: 15_000 }, (error, stdout) => resolve(error ? null : String(stdout))));

/** A step that may not take longer than `ms`: what a hung dialog would otherwise block forever. */
function withLimit(ms, what, promise) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish within ${Math.round(ms / 1000)} s`)), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

async function fingerprint(file) {
  const stats = statSync(file);
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    createReadStream(file).on("data", (chunk) => hash.update(chunk)).on("error", reject).on("end", resolve);
  });
  return { ino: stats.ino, size: stats.size, mtimeMs: stats.mtimeMs, ctimeMs: stats.ctimeMs, sha256: hash.digest("hex") };
}

/** The ids of the processes whose command line holds `needle`; `null` when the system could not say. */
async function processIds(needle) {
  if (process.platform === "win32") {
    const script = "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:PI_NEEDLE) } | ForEach-Object { $_.ProcessId }";
    const out = await new Promise((resolve) =>
      execFile("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 30_000, env: { ...process.env, PI_NEEDLE: needle } }, (error, stdout) => resolve(error ? null : String(stdout))),
    );
    return out === null ? null : out.split(/\r?\n/).map((line) => Number(line.trim())).filter((pid) => Number.isInteger(pid) && pid > 0);
  }
  const out = await new Promise((resolve) => execFile("pgrep", ["-f", "--", needle], { timeout: 15_000 }, (error, stdout) => resolve(error && error.code !== 1 ? null : String(stdout ?? ""))));
  return out === null ? null : out.split("\n").map((line) => Number(line.trim())).filter((pid) => Number.isInteger(pid) && pid > 0);
}

/** The state of `ui.inspect.update`, `waitFor` until `decide` accepts; a timeout or an `Abort` says what the state was. */
async function waitUpdate(control, what, decide, timeoutMs) {
  let last = "nothing read";
  try {
    return await waitFor(
      what,
      async () => {
        const { update } = await control.inspect();
        last = describeUpdate(update);
        return decide(update);
      },
      { timeoutMs, intervalMs: 500 },
    );
  } catch (error) {
    throw new Error(`${error.message}; the update state was ${last}`);
  }
}

/** Run an engine command, asking again while the app says it cannot take it yet (an automatic check running, an action starting). */
function executeWhenFree(control, command) {
  return waitFor(
    `${command} to be accepted`,
    async () => {
      const reply = await control.execute(command);
      return reply?.accepted === true ? reply : null;
    },
    { timeoutMs: 30_000, intervalMs: 500 },
  );
}

class Check {
  constructor(options, report, outDir) {
    this.options = options;
    this.report = report;
    this.outDir = outDir;
    this.workDir = mkdtempSync(path.join(tmpdir(), "pi-update-check-"));
    this.configDir = path.join(this.workDir, "config");
    this.tokenFile = path.join(this.workDir, "control.token");
    mkdirSync(this.configDir, { recursive: true });
    this.layout = installLayout(options.kind, { workDir: this.workDir, localAppData: process.env.LOCALAPPDATA });
    this.port = 0;
    this.app = null;
    this.control = null;
    this.polkit = false;
  }

  /** The text a command line of this run's app holds: every process of it (the restarted one too) is found by it. */
  get needle() {
    return this.tokenFile;
  }

  async preconditions() {
    const { kind } = this.options;
    if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
      throw new Error("no display: run the script under xvfb-run (xvfb-run -a node update-check.mjs …)");
    }
    if (!existsSync(this.options.from)) throw new Error(`the installer ${this.options.from} does not exist`);
    if (kind === "deb") {
      await run("sudo", ["-n", "true"], { timeoutMs: 30_000 }).catch(() => {
        throw new Error("passwordless sudo is needed for the .deb (sudo -n true failed)");
      });
      await run("sh", ["-c", "command -v pkexec"], { timeoutMs: 15_000 }).catch(() => {
        throw new Error("pkexec is not installed: install the polkit packages, the app installs a .deb through it");
      });
    }
    if (kind === "app") {
      await access("/Applications", constants.W_OK).catch(() => {
        throw new Error("/Applications is not writable by this user: the plug-in would show an administrator dialog that nobody answers");
      });
    }
    this.report.fact("Environment", `${process.platform} ${release()} ${arch()}`, `node ${process.version}`, `user ${userInfo().username}`, `installer ${path.resolve(this.options.from)}`);
  }

  async installPolkitRule() {
    await run("sudo", ["-n", "tee", POLKIT_RULE_PATH], { timeoutMs: 30_000, input: polkitRule(userInfo().username) });
    this.polkit = true;
  }

  async removePolkitRule() {
    if (!this.polkit) return;
    this.polkit = false;
    await run("sudo", ["-n", "rm", "-f", POLKIT_RULE_PATH], { timeoutMs: 30_000 }).catch((error) => this.report.fact("The polkit rule was not removed", error.message));
  }

  /** Install the installer on this system, with the limits of the steps. */
  async install() {
    const installer = path.resolve(this.options.from);
    const mountPoint = path.join(this.workDir, "mnt");
    if (this.options.kind === "appimage") mkdirSync(path.dirname(this.layout.exe), { recursive: true });
    if (this.options.kind === "app") mkdirSync(mountPoint, { recursive: true });
    if (this.options.kind === "app" && existsSync(this.layout.bundle)) rmSync(this.layout.bundle, { recursive: true, force: true });
    let failure = null;
    for (const step of installSteps(this.options.kind, installer, this.layout, mountPoint)) {
      if (failure && !step.always) continue;
      try {
        if (step.op === "copy") {
          await copyFile(step.from, step.to);
          await chmod(step.to, step.mode);
        } else {
          await run(step.command, step.args, { timeoutMs: step.timeoutMs });
        }
      } catch (error) {
        if (step.tolerate) continue;
        failure ??= error;
      }
    }
    if (failure) throw failure;
    if (!existsSync(this.layout.exe)) throw new Error(`the install finished and ${this.layout.exe} does not exist`);
  }

  async startApp(name, manifest) {
    this.port ||= await freePort();
    const log = path.join(this.outDir, `app-${name}.log`);
    this.app = launch(this.layout.launch, appArguments({ port: this.port, tokenFile: this.tokenFile, configDir: this.configDir, manifest }), appEnvironment(process.env), log);
    await waitForControlPort(this.app, 60_000);
    this.control = await this.connect(30_000);
  }

  connect(timeoutMs) {
    return waitFor(
      "the app's control socket",
      () => ControlClient.connect({ port: this.port, token: readFileSync(this.tokenFile, "utf8").trim() }),
      { timeoutMs, intervalMs: 500 },
    );
  }

  /** Ends every process of this run's app, the restarted one included, and waits until none is left. */
  async stopApp() {
    this.control?.close();
    this.control = null;
    if (process.platform === "win32") {
      await killProcesses(`${path.win32.basename(this.layout.exe)}`);
      return;
    }
    for (const signal of ["TERM", "KILL"]) {
      await execFileText("pkill", [`-${signal}`, "-f", "--", this.needle]);
      for (let i = 0; i < 20; i += 1) {
        const pids = await processIds(this.needle);
        if (pids === null || pids.length === 0) return;
        await sleep(500);
      }
    }
  }

  /** `ui.inspect.update` and the installed file, as the stage's facts. */
  async observe() {
    const { update } = await this.control.inspect();
    return {
      version: update.current,
      kind: update.kind,
      manifest: update.manifest,
      state: update.state,
      lastError: update.lastError,
      file: await fingerprint(this.layout.exe),
    };
  }

  /** The steps of one stage, in order: each its own result, the first failure skips the rest. */
  async stage(stage) {
    const { report, options } = this;
    const prefix = stage.id;
    const note = { before: null, offered: null, oldPids: [], downloaded: "none seen", oldExited: false };
    const steps = [
      [`${prefix}.launch`, `launch the installed build at ${stage.manifest}`, 120_000, async () => {
        await this.stopApp();
        await this.startApp(prefix, stage.manifest);
        note.before = await this.observe();
        note.oldPids = (await processIds(this.needle)) ?? [];
        report.fact(`${prefix}: the build before`, `version ${note.before.version}, kind ${note.before.kind}, state ${note.before.state}`);
      }],
      [`${prefix}.check`, "update.check finds the offered version", 150_000, async ({ note: say }) => {
        await executeWhenFree(this.control, "update.check");
        const acceptedAt = Date.now();
        const update = await waitUpdate(
          this.control,
          "the update state `available`",
          (current) => {
            if (current.state === "available") return current;
            if (current.state === "failed" || current.state === "cannot_install") throw new Abort(`the check ended in ${describeUpdate(current)}`);
            if (current.state === "up_to_date" && Date.now() - acceptedAt > 5000) throw new Abort("the check found nothing newer: up_to_date");
            return null;
          },
          90_000,
        );
        note.offered = update.version;
        say(`offered ${update.version}`);
      }],
      [`${prefix}.install`, "update.install downloads and installs it", options.installTimeoutMs + 60_000, async ({ note: say }) => {
        await executeWhenFree(this.control, "update.install");
        let seen = 0;
        let last = null;
        await waitUpdate(
          this.control,
          "the update state `restart_needed`",
          (current) => {
            if (current.state === "downloading") {
              seen += 1;
              last = current;
            }
            if (current.state === "restart_needed") return current;
            if (current.state === "failed" || current.state === "cannot_install") throw new Abort(`the install ended in ${describeUpdate(current)}`);
            return null;
          },
          options.installTimeoutMs,
        );
        note.downloaded = last ? `${seen} progress reads, the last ${last.received} of ${last.total ?? "unknown"} bytes` : "finished between two reads";
        say(note.downloaded);
      }],
      [`${prefix}.restart`, "update.restart ends the old process and starts a new one", 240_000, async ({ note: say }) => {
        await executeWhenFree(this.control, "update.restart");
        const ended = await Promise.race([this.app.exited.then(() => true), sleep(60_000).then(() => false)]);
        note.oldExited = ended;
        if (!ended) throw new Error("the old process did not exit within 60 s of update.restart");
        this.control.close();
        this.control = await this.connect(120_000);
        say("reconnected to the control port");
      }],
      [`${prefix}.verify`, "the new process runs the expected build", 120_000, async ({ note: say }) => {
        await waitUpdate(this.control, "the new app's first check to end", (current) => (current.state !== "idle" && current.state !== "checking" ? current : null), 30_000).catch((error) => say(`the state did not settle: ${error.message}`));
        const after = await this.observe();
        const pids = await processIds(this.needle);
        const newPids = pids === null || note.oldPids.length === 0 ? null : pids.filter((pid) => !note.oldPids.includes(pid));
        const evidence = { before: note.before, offered: note.offered, after, oldPids: note.oldPids, newPids, downloaded: note.downloaded };
        report.fact(`${prefix}: evidence`, ...stageFacts(stage, evidence));
        const problems = judgeStage(stage, { ...evidence, oldExited: note.oldExited });
        if (problems.length > 0) throw new Error(problems.join("; "));
        say(`version ${after.version}, state ${after.state}, installed file replaced`);
      }],
    ];
    for (const [index, [id, title, limitMs, body]] of steps.entries()) {
      const ok = await report.run(id, title, (context) => withLimit(limitMs, `step ${id}`, body(context)));
      if (!ok) {
        report.skipAll(steps.slice(index + 1).map(([skipId, skipTitle]) => ({ id: skipId, title: skipTitle })), `${id} failed`);
        const tail = this.app ? this.app.log().slice(-1500) : "";
        if (tail) report.fact(`${prefix}: the end of the app's log`, ...tail.split("\n"));
        return false;
      }
    }
    return true;
  }

  async finish() {
    await this.stopApp().catch(() => {});
    await this.removePolkitRule();
    rmSync(this.workDir, { recursive: true, force: true });
  }
}

async function main() {
  let options;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    console.error(`update-check: ${error.message}\n\n${USAGE}`);
    process.exit(2);
  }
  const outDir = path.resolve(options.out);
  mkdirSync(outDir, { recursive: true });
  const report = new Report((line) => console.log(line));
  const check = new Check(options, report, outDir);
  try {
    const ready = await report.run("precheck", "this machine can run the check", () => check.preconditions());
    if (ready && options.kind === "deb") await report.run("polkit", "a polkit rule lets this user run pkexec without a password", () => check.installPolkitRule());
    const installed = ready && (!(options.kind === "deb") || check.polkit) && (await report.run("install", `install ${path.basename(options.from)} (${options.kind})`, () => withLimit(options.kind === "deb" ? TEN_MINUTES + 60_000 : 12 * 60_000, "the install", check.install())));
    if (installed) {
      for (const stage of stagesOf(options)) {
        if (!(await check.stage(stage))) break;
      }
    }
  } catch (error) {
    await report.run("run", "the run itself", async () => {
      throw error;
    });
  } finally {
    await check.finish();
  }
  const summary = renderSummary(headingFor(process.platform, options.kind, options.selfCheckOnly), report);
  writeFileSync(path.join(outDir, "summary.md"), summary);
  writeFileSync(path.join(outDir, "results.json"), `${JSON.stringify({ options: { ...options, from: path.basename(options.from) }, results: report.results, facts: report.facts }, null, 2)}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  console.log(`\n${summary}`);
  process.exit(report.failed ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
