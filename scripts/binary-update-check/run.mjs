#!/usr/bin/env node
// Live check of the single binary's self-update (swe/features/self-update.md § Acceptance criteria,
// milestone 6): a daemon that is an unpacked `pi-studio` folder under `$PI_STUDIO_HOME/bin/versions/`,
// in a container with no Node and no npm, updates itself from N to N+1 through the RPC, rolls a
// broken N+2 back, skips it, refuses to update where it is not managed, and survives a corrupted
// asset. The release channel is a local HTTP server (`PI_STUDIO_DAEMON_UPDATE_URL`), its
// `latest.json` written by `scripts/release/daemon-manifest.mjs`; nothing reaches GitHub.
//
//   npm run build && node scripts/binary-update-check/run.mjs [--out results.json]
//
// See README.md for the flags, what each scenario proves and how to read the output.
import {
  chmodSync,
  copyFileSync,
  cpSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  docker,
  freePort,
  loadSdk,
  openClient,
  run,
  waitFor,
} from "../daemon-update-check/lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

const { values: flags } = parseArgs({
  options: {
    repo: { type: "string", default: path.resolve(here, "../..") },
    prefix: { type: "string", default: "binupd" },
    "daemon-port": { type: "string", default: "16767" },
    "other-port": { type: "string", default: "16768" },
    "http-port": { type: "string", default: "16800" },
    base: { type: "string", default: "0.0.9001" },
    image: { type: "string", default: "debian:bookworm-slim" },
    out: { type: "string" },
    keep: { type: "boolean", default: false },
  },
});

const repo = path.resolve(flags.repo);
const P = flags.prefix;
const CONTAINER = `${P}-daemon`;
const daemonPort = Number(flags["daemon-port"]);
const otherPort = Number(flags["other-port"]);
const httpPort = Number(flags["http-port"]);
const PASSWORD = `${P}-pw`;
const LISTEN = `127.0.0.1:${daemonPort}`;
const OTHER_LISTEN = `127.0.0.1:${otherPort}`;
const RELEASES_PAGE = "https://github.com/avatsaev/pi-studio/releases";
const TARGET = "linux-x64";

const [maj, min, patch] = flags.base.split(".").map(Number);
const V1 = `${maj}.${min}.${patch}`; // N: installed
const V2 = `${maj}.${min}.${patch + 1}`; // N+1: the update
const V3 = `${maj}.${min}.${patch + 2}`; // N+2: its daemon exits at start
const V4 = `${maj}.${min}.${patch + 3}`; // N+3: a newer release after the rollback

const scratch = mkdtempSync(path.join(tmpdir(), `${P}-`));
const WORK = path.join(scratch, "work"); // mounted at /work in the container
const DIST = path.join(scratch, "dist");
const SERVE = path.join(scratch, "serve");
const BROKEN = path.join(scratch, "broken");
const PSH = "/work/psh"; // $PI_STUDIO_HOME of the managed daemon (a container path)
const PSH_OTHER = "/work/psh-other"; // $PI_STUDIO_HOME of the daemon run from another folder
const results = [];
const openClients = [];
const log = (line) => console.log(line);

/** One scenario: its evidence lines, a pass/fail, and the abort of the whole run on a failure. */
async function scenario(title, fn) {
  const evidence = [];
  const started = Date.now();
  const seconds = () => Math.round((Date.now() - started) / 1000);
  log(`\n=== ${title}`);
  const ev = (line) => {
    evidence.push(line);
    log(`  · ${line}`);
  };
  const expect = (condition, text) => {
    ev(`${condition ? "PASS" : "FAIL"}: ${text}`);
    if (!condition) throw new Error(`expectation failed: ${text}`);
  };
  try {
    await fn(ev, expect);
    results.push({ title, pass: true, seconds: seconds(), evidence });
  } catch (err) {
    results.push({
      title,
      pass: false,
      seconds: seconds(),
      evidence,
      error: String(err.message ?? err),
    });
    throw err;
  }
}

// ─── The release channel: archives, manifests, a local HTTP server ───────────────────────────────

const archiveName = (version) => `pi-studio-${version}-${TARGET}.tar.gz`;
const folderOf = (version) => path.join(DIST, `pi-studio-${version}-${TARGET}`);
const archiveOf = (version) => `${folderOf(version)}.tar.gz`;
const requests = []; // { at, path, status } of every request the server answered

function startHttp() {
  const root = path.resolve(SERVE);
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const target = path.resolve(root, `.${pathname}`);
    const ok =
      target.startsWith(`${root}${path.sep}`) && existsSync(target) && statSync(target).isFile();
    requests.push({ at: Date.now(), path: pathname, status: ok ? 200 : 404 });
    if (!ok) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "Content-Length": statSync(target).size });
    createReadStream(target).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(httpPort, "127.0.0.1", () => resolve(server));
  });
}
const requestsFor = (suffix) => requests.filter((r) => r.path.endsWith(suffix)).length;

/**
 * `serve/<version>/` holds the four archive names `daemon-manifest.mjs` insists on (the other
 * three targets are links to the linux one: only linux-x64 is ever downloaded) and the
 * `latest.json` it writes for them.
 */
async function stage(version, archive) {
  const dir = path.join(SERVE, version);
  mkdirSync(dir, { recursive: true });
  copyFileSync(archive, path.join(dir, archiveName(version)));
  for (const other of ["linux-arm64", "darwin-arm64", "darwin-x64"]) {
    symlinkSync(archiveName(version), path.join(dir, `pi-studio-${version}-${other}.tar.gz`));
  }
  await run("node", [
    path.join(repo, "scripts/release/daemon-manifest.mjs"),
    "--version",
    version,
    "--dir",
    dir,
    "--base-url",
    `http://127.0.0.1:${httpPort}/${version}`,
  ]);
}

/** Flips one byte in the middle of the served archive; the manifest keeps the genuine SHA-256. */
function corruptServed(version) {
  const file = path.join(SERVE, version, archiveName(version));
  const bytes = readFileSync(file);
  bytes[Math.floor(bytes.length / 2)] ^= 0xff;
  writeFileSync(file, bytes);
}

const restoreServed = (version, archive) =>
  copyFileSync(archive, path.join(SERVE, version, archiveName(version)));

/** What `GET latest.json` answers from now on. */
const release = (version) =>
  copyFileSync(path.join(SERVE, version, "latest.json"), path.join(SERVE, "latest.json"));

/**
 * N+2: the real build of that version whose `pi-studio` is a shell wrapper: `--version` and every
 * command but one reach the real executable (`pi-studio.real`), `__daemon` exits 3 at once, the
 * way a release whose daemon cannot start behaves.
 */
async function makeBroken(version) {
  const folder = path.join(BROKEN, `pi-studio-${version}-${TARGET}`);
  mkdirSync(BROKEN, { recursive: true });
  cpSync(folderOf(version), folder, { recursive: true });
  renameSync(path.join(folder, "pi-studio"), path.join(folder, "pi-studio.real"));
  writeFileSync(
    path.join(folder, "pi-studio"),
    [
      "#!/bin/sh",
      '[ "$1" = "__daemon" ] && { echo "pi-studio: this release cannot start its daemon" >&2; exit 3; }',
      'exec "$(dirname "$0")/pi-studio.real" "$@"',
      "",
    ].join("\n"),
  );
  chmodSync(path.join(folder, "pi-studio"), 0o755);
  const archive = `${folder}.tar.gz`;
  await run("tar", ["-czf", archive, "-C", BROKEN, path.basename(folder)]);
  return archive;
}

// ─── The daemon container ────────────────────────────────────────────────────────────────────────

/** `docker exec` in the daemon container (the user and environment of `docker run`). */
function dx(command, { env = {}, allowFail = false, timeoutMs, input } = {}) {
  const envArgs = Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
  return docker(["exec", "-i", "-w", "/work", ...envArgs, CONTAINER, ...command], {
    allowFail,
    timeoutMs,
    input,
  });
}
const dbash = (script, opts) => dx(["bash", "-c", script], opts);

/** The managed install: `bin/current/pi-studio`, what the app and the command line run through. */
const CURRENT = `${PSH}/bin/current/pi-studio`;
const cli = (args, opts) => dx([CURRENT, "-H", LISTEN, ...args], { allowFail: true, ...opts });

/** `{pid, ppid, stat, args}` of every process of the container, read from /proc (no `ps` there). */
async function psList() {
  const { stdout } = await dbash("bash /work/ps.sh");
  return stdout
    .split("\n")
    .map((line) => /^(\d+) (\d+) (\S+) ?(.*)$/.exec(line))
    .filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), stat: m[3], args: m[4].trim() }));
}

/** `pid` and everything below it. */
function descendants(list, pid) {
  const found = new Set([pid]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of list) {
      if (found.has(p.ppid) && !found.has(p.pid)) {
        found.add(p.pid);
        grew = true;
      }
    }
  }
  return list.filter((p) => found.has(p.pid));
}

/** The agent's Pi process: the binary running as `__pi … --mode rpc`. */
const isPi = (p) => /--mode rpc/.test(p.args);

const health = async (port = daemonPort) => {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return await res.json();
  } catch {
    return null;
  }
};
const healthVersion = async (port) => (await health(port))?.version ?? null;

const readText = async (file) => {
  const { stdout, code } = await dbash(`cat ${file}`, { allowFail: true });
  return code === 0 ? stdout.trim() : null;
};
const pidFile = async (home = PSH) => {
  const text = await readText(`${home}/pi-studio.pid`);
  return text === null ? null : Number(text);
};
const exeOf = async (pid) =>
  (await dbash(`readlink /proc/${pid}/exe`, { allowFail: true })).stdout.trim();
const currentTarget = async () =>
  (await dbash(`readlink ${PSH}/bin/current`, { allowFail: true })).stdout.trim();
const listDir = async (dir) =>
  (await dbash(`ls -A ${dir} 2>/dev/null | sort`, { allowFail: true })).stdout
    .split("\n")
    .filter(Boolean);
const restartLog = async () => (await readText(`${PSH}/logs/update-restart.log`)) ?? "";
const tail = (text, n = 14) => text.split("\n").slice(-n);
const skipFile = async () => readText(`${PSH}/update-skip.json`);

async function startDaemon() {
  const res = await cli(["daemon", "start"]);
  if (res.code !== 0) throw new Error(`daemon start failed: ${res.stdout}${res.stderr}`);
  await waitFor("daemon health", healthVersion, { timeoutMs: 30_000 });
}

async function connect(name, port = daemonPort) {
  const client = await openClient(sdk, { name, port, password: PASSWORD });
  openClients.push(client);
  return client;
}

const statusWhere = (client, what, predicate) =>
  waitFor(
    `${client.name}: ${what}`,
    async () => {
      const status = await client.pi.getDaemonUpdateStatus();
      return predicate(status) ? status : null;
    },
    { timeoutMs: 30_000, intervalMs: 500 },
  );

/** The first status that carries `checkedAt`: the start's automatic check has run. */
const checkedStatus = (client) =>
  statusWhere(client, "the automatic check ran", (status) => status.checkedAt !== undefined);

/** The container's TCP sockets listening on `port`: their local addresses (IPv4 as dotted quads). */
async function listeningAddresses(port) {
  const { stdout } = await dx(["cat", "/proc/net/tcp", "/proc/net/tcp6"]);
  const hexPort = port.toString(16).toUpperCase().padStart(4, "0");
  const found = [];
  for (const line of stdout.split("\n")) {
    const m = /^\s*\d+:\s+([0-9A-F]+):([0-9A-F]{4})\s+\S+\s+0A\b/.exec(line);
    if (!m || m[2] !== hexPort) continue;
    found.push(
      m[1].length === 8
        ? m[1]
            .match(/../g)
            .toReversed()
            .map((byte) => parseInt(byte, 16))
            .join(".")
        : m[1],
    );
  }
  return found;
}

let sdk;
let A; // direct client 1
let B; // direct client 2
let httpServer;

async function cleanup() {
  for (const client of openClients) {
    try {
      client.close();
    } catch {
      /* already closed */
    }
  }
  httpServer?.close();
  if (flags.keep) {
    log(`\n--keep: container ${CONTAINER} and ${scratch} left in place`);
    return;
  }
  await docker(["rm", "-f", CONTAINER], { allowFail: true });
  rmSync(scratch, { recursive: true, force: true });
}

// ─── Run ─────────────────────────────────────────────────────────────────────────────────────────

let failed = false;
try {
  await Promise.all([daemonPort, otherPort, httpPort].map(freePort));
  sdk = await loadSdk(repo);

  await scenario(
    "setup: four binaries, the release channel, N installed in the layout",
    async (ev, expect) => {
      for (const version of [V1, V2, V3, V4]) {
        const started = Date.now();
        await run("node", [
          path.join(repo, "scripts/build-binary.mjs"),
          "--target",
          TARGET,
          "--version",
          version,
          "--out-dir",
          DIST,
        ]);
        ev(
          `built ${version} in ${Math.round((Date.now() - started) / 1000)} s: ${(statSync(archiveOf(version)).size / 1048576).toFixed(1)} MiB archive`,
        );
      }
      const brokenArchive = await makeBroken(V3);
      await stage(V1, archiveOf(V1));
      await stage(V2, archiveOf(V2));
      await stage(V3, brokenArchive);
      await stage(V4, archiveOf(V4));
      release(V1);
      ev(`manifests written by scripts/release/daemon-manifest.mjs; latest.json names ${V1}`);
      httpServer = await startHttp();
      ev(`release channel: http://127.0.0.1:${httpPort}/latest.json`);

      mkdirSync(path.join(WORK, "home"), { recursive: true });
      mkdirSync(path.join(WORK, "psh/bin/versions"), { recursive: true });
      cpSync(folderOf(V1), path.join(WORK, "psh/bin/versions", V1), { recursive: true });
      symlinkSync(path.join("versions", V1), path.join(WORK, "psh/bin/current"));
      writeFileSync(
        path.join(WORK, "ps.sh"),
        [
          "for d in /proc/[0-9]*; do",
          '  p="${d#/proc/}"',
          '  s="$(cat "$d/stat" 2>/dev/null)" || continue',
          '  r="${s##*) }"',
          "  set -- $r",
          `  printf '%s %s %s %s\\n' "$p" "$2" "$1" "$(tr '\\0' ' ' < "$d/cmdline" 2>/dev/null)"`,
          "done",
          "",
        ].join("\n"),
      );
      const env = {
        HOME: "/work/home",
        PI_STUDIO_HOME: PSH,
        PI_CODING_AGENT_DIR: "/work/home/.pi/agent",
        PI_SKIP_VERSION_CHECK: "1",
        PI_TELEMETRY: "0",
        PI_STUDIO_EXTENSIONS_AUTOSYNC: "false",
        PI_STUDIO_PASSWORD: PASSWORD,
        PI_STUDIO_DAEMON_UPDATE_URL: `http://127.0.0.1:${httpPort}/latest.json`,
      };
      await docker([
        "run",
        "-d",
        "--init",
        "--name",
        CONTAINER,
        "--network",
        "host",
        "-u",
        `${process.getuid()}:${process.getgid()}`,
        "-v",
        `${WORK}:/work`,
        "-w",
        "/work",
        ...Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
        flags.image,
        "sleep",
        "infinity",
      ]);
      const id = (await dx(["id"])).stdout.trim();
      ev(`container ${CONTAINER} (${flags.image}, host network) runs as ${id}`);
      const tools = (await dbash("command -v node; command -v npm; true")).stdout.trim();
      expect(tools === "", "neither node nor npm is on the container's PATH");
      const version = (await dx([CURRENT, "--version"])).stdout.trim();
      expect(version === V1, `bin/current/pi-studio --version = ${version}`);
      ev(
        `layout: ${await currentTarget()} ← bin/current; bin/versions = ${(await listDir(`${PSH}/bin/versions`)).join(", ")}`,
      );
    },
  );

  await scenario(
    `${V1}: the daemon starts as a managed binary; the start's check finds nothing newer`,
    async (ev, expect) => {
      const before = requestsFor("/latest.json");
      await startDaemon();
      expect((await healthVersion()) === V1, `/api/health answers version ${V1}`);
      const pid = await pidFile();
      const exe = await exeOf(pid);
      expect(
        exe === `${PSH}/bin/versions/${V1}/pi-studio`,
        `pi-studio.pid names pid ${pid}, running ${exe}`,
      );
      ev(
        `bound addresses of :${daemonPort} = ${(await listeningAddresses(daemonPort)).join(", ")}`,
      );
      A = await connect("binupd-a");
      B = await connect("binupd-b");
      expect(A.pi.hasDaemonUpdateCapability(), "server_info.features.daemonUpdate is advertised");
      const first = await checkedStatus(A);
      expect(first.installKind === "binary", `installKind = ${first.installKind}`);
      expect(first.currentVersion === V1, `currentVersion = ${first.currentVersion}`);
      expect(
        first.state.kind === "idle",
        `after the start's automatic check state = ${first.state.kind}`,
      );
      expect(first.autoCheck === true, "autoCheck is on");
      expect(first.skippedVersion === undefined, "no skipped version");
      expect(
        requestsFor("/latest.json") - before === 1,
        `the start's automatic check made ${requestsFor("/latest.json") - before} GET of latest.json`,
      );
    },
  );

  await scenario(
    `(d) a corrupted asset for ${V2}: failed, the daemon keeps running`,
    async (ev, expect) => {
      release(V2);
      corruptServed(V2);
      const pid0 = await pidFile();
      const current0 = await currentTarget();
      const checkMark = [A, B].map((c) => c.mark());
      const checked = await A.pi.checkDaemonUpdate();
      expect(
        checked.state.kind === "available" && checked.state.version === V2,
        `client A's check: ${JSON.stringify(checked.state)}`,
      );
      const seen = await B.waitEvent(
        "available broadcast",
        (e) => e.type === "status" && e.kind === "available",
        checkMark[1],
        10_000,
      );
      expect(
        seen.status.state.version === V2,
        `client B received the broadcast: available ${seen.status.state.version}`,
      );

      const downloads0 = requestsFor(archiveName(V2));
      const mark = A.mark();
      const applied = await A.pi.applyDaemonUpdate();
      expect(applied.ok === true, "apply answered ok at once");
      const failedEvent = await A.waitEvent(
        "failed",
        (e) => e.type === "status" && e.kind === "failed",
        mark,
        120_000,
      );
      const state = failedEvent.status.state;
      ev(`failed: ${JSON.stringify({ ...state, message: undefined })}`);
      ev(`failed message: ${String(state.message).slice(0, 300)}`);
      const kinds = A.kindsSince(mark);
      ev(`broadcasts after the apply: ${JSON.stringify(kinds)}`);
      expect(kinds[0] === "installing" && kinds.at(-1) === "failed", "installing → failed");
      expect(
        !kinds.includes("updating_extensions") && !kinds.includes("restarting"),
        "no extensions step, no restart",
      );
      expect(
        requestsFor(archiveName(V2)) - downloads0 === 1,
        "the archive was downloaded once (and refused)",
      );
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(!A.since(mark).some((e) => e.type === "conn"), "client A's socket never dropped");
      expect((await pidFile()) === pid0, `pi-studio.pid still names pid ${pid0}`);
      expect((await healthVersion()) === V1, `/api/health still answers ${V1}`);
      expect((await currentTarget()) === current0, `bin/current unchanged: ${current0}`);
      const versions = await listDir(`${PSH}/bin/versions`);
      expect(versions.join(",") === V1, `bin/versions = ${versions.join(", ")}`);
      const tmp = await listDir(`${PSH}/bin/tmp`);
      expect(tmp.length === 0, `bin/tmp is empty (${tmp.join(", ") || "nothing left"})`);
      expect((await readText(`${PSH}/update-result.json`)) === null, "no update-result.json");
      const again = await A.pi.checkDaemonUpdate();
      expect(
        again.state.kind === "available",
        `the next check replaces failed: ${JSON.stringify(again.state)}`,
      );
    },
  );

  let oldPid;
  await scenario(
    `(a) apply ${V1} → ${V2}: same address, clients reconnect, no old process left`,
    async (ev, expect) => {
      restoreServed(V2, archiveOf(V2));
      const offered = await A.pi.checkDaemonUpdate();
      expect(
        offered.state.kind === "available" && offered.state.version === V2,
        `the genuine asset is offered: ${JSON.stringify(offered.state)}`,
      );
      const agent = await A.pi.createAgent({
        config: { provider: "pi", cwd: "/work" },
        labels: {},
      });
      // No model is configured, so the turn never ends: the answer is not awaited, the process is.
      A.pi
        .agent(agent.agentId)
        .send("hello")
        .catch(() => undefined);
      const terminal = await A.daemon.request("create_terminal_request", {
        workspaceId: "binupd",
        cwd: "/work",
      });
      ev(
        `agent ${agent.agentId} and terminal ${JSON.stringify(terminal.terminal?.slot ?? terminal)} created`,
      );
      await waitFor("the agent's pi process", async () => (await psList()).some(isPi), {
        timeoutMs: 30_000,
      });
      oldPid = await pidFile();
      const before = await psList();
      const oldTree = descendants(before, oldPid);
      ev(
        `old daemon pid ${oldPid} (${V1}); tree: ${oldTree.map((p) => `${p.pid}:${p.args.slice(0, 60)}`).join(" | ")}`,
      );
      expect(before.some(isPi), "an agent process (`__pi … --mode rpc`) exists before the update");
      expect(
        oldTree.length >= 3,
        `the daemon has children (agent, terminal shell): ${oldTree.length - 1}`,
      );

      const marks = [A, B].map((c) => c.mark());
      const t0 = Date.now();
      const applied = await A.pi.applyDaemonUpdate();
      expect(applied.ok === true, "apply answered ok at once");
      const second = await B.pi
        .applyDaemonUpdate()
        .catch((e) => ({ ok: false, error: `rpc: ${e.message}` }));
      expect(
        second.ok === false && second.error === "in_progress",
        `a second apply during the update: ${JSON.stringify(second)}`,
      );

      for (const [i, client] of [A, B].entries()) {
        const back = await client.waitEvent(
          "reconnected",
          (e) => e.type === "reconnected",
          marks[i],
          240_000,
        );
        const kinds = client.kindsSince(marks[i]);
        ev(
          `${client.name}: broadcasts ${JSON.stringify(kinds)}, reconnected ${Math.round((back.at - t0) / 1000)} s after the apply`,
        );
        expect(
          ["installing", "updating_extensions", "restarting"].every((k) => kinds.includes(k)),
          `${client.name} saw installing → updating_extensions → restarting`,
        );
      }
      const stageAt = (kind) =>
        A.events.slice(marks[0]).find((e) => e.type === "status" && e.kind === kind)?.at;
      ev(
        `stage durations seen by client A: download+install ${((stageAt("updating_extensions") - t0) / 1000).toFixed(1)} s, ` +
          `extensions ${((stageAt("restarting") - stageAt("updating_extensions")) / 1000).toFixed(1)} s`,
      );
      expect((await healthVersion()) === V2, `/api/health answers version ${V2}`);
      const addresses = await listeningAddresses(daemonPort);
      expect(
        addresses.includes("127.0.0.1"),
        `same address after the update: ${addresses.join(", ")}`,
      );
      const newPid = await pidFile();
      expect(newPid !== oldPid, `pi-studio.pid names the new daemon: ${newPid} (was ${oldPid})`);
      const exe = await exeOf(newPid);
      expect(exe === `${PSH}/bin/versions/${V2}/pi-studio`, `pid ${newPid} runs ${exe}`);
      const after = await psList();
      expect(
        oldTree.every((old) => !after.some((p) => p.pid === old.pid)),
        `none of the old daemon's ${oldTree.length} processes (daemon, agent, shell) is left`,
      );
      expect(!after.some(isPi), "no `--mode rpc` agent process exists after the restart");
      for (const client of [A, B]) {
        const status = await statusWhere(client, "lastResult", (s) => s.lastResult !== undefined);
        expect(
          status.currentVersion === V2 &&
            status.lastResult.outcome === "updated" &&
            status.lastResult.from === V1 &&
            status.lastResult.to === V2,
          `${client.name}: currentVersion ${status.currentVersion}, lastResult ${JSON.stringify(status.lastResult)}`,
        );
        expect(
          status.installKind === "binary" && status.state.kind === "idle",
          `${client.name}: installKind ${status.installKind}, state ${status.state.kind}`,
        );
      }
      expect(
        (await readText(`${PSH}/update-result.json`)) === null,
        "update-result.json was read once and removed by the new daemon",
      );
      expect(
        (await currentTarget()) === path.join("versions", V2),
        `bin/current → ${await currentTarget()}`,
      );
      const versions = await listDir(`${PSH}/bin/versions`);
      expect(
        versions.join(",") === `${V1},${V2}`,
        `bin/versions = ${versions.join(", ")} (the new and the previous one)`,
      );
      expect((await listDir(`${PSH}/bin/tmp`)).length === 0, "bin/tmp is empty");
      ev(`update-restart.log:\n      ${tail(await restartLog()).join("\n      ")}`);
    },
  );

  await scenario(
    `(b) ${V3} does not start: rolled back to ${V2}, skipped, "Check now" still offers it`,
    async (ev, expect) => {
      release(V3);
      const offered = await A.pi.checkDaemonUpdate();
      expect(
        offered.state.kind === "available" && offered.state.version === V3,
        `the daemon the helper started (installKind ${offered.installKind}) is offered ${V3}: ${JSON.stringify(offered.state)}`,
      );
      const pid0 = await pidFile();
      const marks = [A, B].map((c) => c.mark());
      const t0 = Date.now();
      expect((await A.pi.applyDaemonUpdate()).ok === true, "apply answered ok at once");
      for (const [i, client] of [A, B].entries()) {
        const back = await client.waitEvent(
          "reconnected",
          (e) => e.type === "reconnected",
          marks[i],
          240_000,
        );
        ev(
          `${client.name}: broadcasts ${JSON.stringify(client.kindsSince(marks[i]))}, reconnected ${Math.round((back.at - t0) / 1000)} s after the apply`,
        );
      }
      expect((await healthVersion()) === V2, `/api/health answers ${V2}`);
      const pid1 = await pidFile();
      expect(
        pid1 !== pid0 && (await exeOf(pid1)) === `${PSH}/bin/versions/${V2}/pi-studio`,
        `pi-studio.pid names the live daemon ${pid1} (was ${pid0}) running ${V2}`,
      );
      expect(
        (await currentTarget()) === path.join("versions", V2),
        `bin/current → ${await currentTarget()}`,
      );
      for (const client of [A, B]) {
        const status = await statusWhere(client, "lastResult", (s) => s.lastResult !== undefined);
        const last = status.lastResult;
        expect(
          last.outcome === "rolled_back" && last.from === V2 && last.to === V3,
          `${client.name}: lastResult ${JSON.stringify(last)}`,
        );
        expect(
          status.skippedVersion === V3,
          `${client.name}: skippedVersion ${status.skippedVersion}`,
        );
        expect(
          status.state.kind === "idle",
          `${client.name}: the rolled-back version is not offered again (state ${JSON.stringify(status.state)})`,
        );
      }
      expect(JSON.parse(await skipFile()).version === V3, `update-skip.json = ${await skipFile()}`);
      expect(
        (await readText(`${PSH}/update-result.json`)) === null,
        "update-result.json was consumed",
      );
      ev(
        `bin/versions = ${(await listDir(`${PSH}/bin/versions`)).join(", ")}; bin/tmp = [${(await listDir(`${PSH}/bin/tmp`)).join(", ")}]`,
      );
      const helper = await restartLog();
      ev(`update-restart.log:\n      ${tail(helper, 18).join("\n      ")}`);
      expect(
        (helper.match(/the daemon exited; stopping it/g) ?? []).length === 3 &&
          /update rolled_back/.test(helper),
        "the helper tried the new version three times, then went back",
      );
    },
  );

  await scenario(
    "(b) the next automatic check does not offer it; Check now does; a newer release is offered again",
    async (ev, expect) => {
      const marks = [A, B].map((c) => c.mark());
      const asks0 = requestsFor("/latest.json");
      const restarted = await cli(["daemon", "restart"]);
      expect(restarted.code === 0, `pi-studio daemon restart exits ${restarted.code}`);
      for (const [i, client] of [A, B].entries()) {
        await client.waitEvent("reconnected", (e) => e.type === "reconnected", marks[i], 60_000);
      }
      const auto = await checkedStatus(A);
      expect(
        requestsFor("/latest.json") > asks0,
        "the start's automatic check asked the release channel",
      );
      expect(
        auto.state.kind === "idle",
        `automatic check: state ${JSON.stringify(auto.state)}, manifest names ${V3}`,
      );
      expect(
        auto.skippedVersion === V3,
        `skippedVersion ${auto.skippedVersion} survived the restart`,
      );

      const markB = B.mark();
      const manual = await A.pi.checkDaemonUpdate();
      expect(
        manual.state.kind === "available" && manual.state.version === V3,
        `Check now offers it: ${JSON.stringify(manual.state)}`,
      );
      const seen = await B.waitEvent(
        "available broadcast",
        (e) => e.type === "status" && e.kind === "available",
        markB,
        10_000,
      );
      expect(
        seen.status.state.version === V3,
        `client B received available ${seen.status.state.version}`,
      );
      expect(
        manual.skippedVersion === V3 && JSON.parse(await skipFile()).version === V3,
        "the skip stays until a newer release exists",
      );

      release(V4);
      const newerMarks = [A, B].map((c) => c.mark());
      const restart2 = await cli(["daemon", "restart"]);
      expect(restart2.code === 0, "daemon restart");
      for (const [i, client] of [A, B].entries()) {
        await client.waitEvent(
          "reconnected",
          (e) => e.type === "reconnected",
          newerMarks[i],
          60_000,
        );
      }
      const newer = await statusWhere(
        A,
        "the automatic check offers the newer release",
        (s) => s.checkedAt !== undefined && s.state.kind !== "checking",
      );
      expect(
        newer.state.kind === "available" && newer.state.version === V4,
        `a newer release (${V4}) is offered by the automatic check: ${JSON.stringify(newer.state)}`,
      );
      expect(
        newer.skippedVersion === undefined && (await skipFile()) === null,
        `the skip is cleared: skippedVersion ${newer.skippedVersion}, update-skip.json ${await skipFile()}`,
      );
    },
  );

  await scenario("(e) the command line on a binary: update --check, update", async (ev, expect) => {
    // The daemon is on V2 and the channel names V4 (the previous scenario).
    const check = await cli(["update", "--check"]);
    ev(`pi-studio update --check → ${JSON.stringify(check.stdout.trim())} (exit ${check.code})`);
    expect(
      check.code === 0 && check.stdout.trim() === `update available: ${V2} -> ${V4}`,
      "update --check reports the newer version",
    );

    const marks = [A, B].map((c) => c.mark());
    const pid0 = await pidFile();
    const t0 = Date.now();
    const updated = await cli(["update"], { timeoutMs: 300_000 });
    ev(
      `pi-studio update (exit ${updated.code}, ${Math.round((Date.now() - t0) / 1000)} s):\n      ${(updated.stdout + updated.stderr).trim().split("\n").join("\n      ")}`,
    );
    expect(updated.code === 0, "pi-studio update exits 0");
    expect(
      updated.stdout.includes(`updated to ${V4}`) &&
        updated.stdout.includes(`daemon restarted: ${V4}`),
      `output names ${V4} and the restarted daemon`,
    );
    expect((await healthVersion()) === V4, `/api/health answers ${V4}`);
    const pid1 = await pidFile();
    expect(
      pid1 !== pid0 && (await exeOf(pid1)) === `${PSH}/bin/versions/${V4}/pi-studio`,
      `pi-studio.pid names pid ${pid1} (was ${pid0}), running ${V4}`,
    );
    expect(
      (await currentTarget()) === path.join("versions", V4),
      `bin/current → ${await currentTarget()}`,
    );
    const versions = await listDir(`${PSH}/bin/versions`);
    expect(
      versions.join(",") === `${V2},${V4}`,
      `bin/versions = ${versions.join(", ")} (the new and the previous one)`,
    );
    expect((await listDir(`${PSH}/bin/tmp`)).length === 0, "bin/tmp is empty");
    for (const [i, client] of [A, B].entries()) {
      await client.waitEvent("reconnected", (e) => e.type === "reconnected", marks[i], 60_000);
      const status = await client.pi.getDaemonUpdateStatus();
      expect(
        status.currentVersion === V4 && status.installKind === "binary",
        `${client.name} reconnected to ${status.currentVersion} (${status.installKind})`,
      );
    }
    const again = await cli(["update"]);
    expect(
      again.code === 0 &&
        again.stdout.includes(`already up to date (${V4})`) &&
        (await pidFile()) === pid1,
      `a second update: ${again.stdout.trim().split("\n")[0]}; the daemon was not restarted`,
    );
  });

  await scenario(
    `(c) the same binary run from another folder: cannot_update(unmanaged_binary)`,
    async (ev, expect) => {
      const elsewhere = `/work/elsewhere/pi-studio-${V1}`;
      cpSync(folderOf(V1), path.join(WORK, "elsewhere", `pi-studio-${V1}`), { recursive: true });
      const other = (args, opts) =>
        dx([`${elsewhere}/pi-studio`, "-H", OTHER_LISTEN, ...args], {
          env: { PI_STUDIO_HOME: PSH_OTHER },
          allowFail: true,
          ...opts,
        });
      const started = await other(["daemon", "start"]);
      expect(started.code === 0, `daemon start from ${elsewhere}`);
      await waitFor("the other daemon's health", () => healthVersion(otherPort), {
        timeoutMs: 30_000,
      });
      const pid = await pidFile(PSH_OTHER);
      ev(`the daemon (pid ${pid}) runs ${await exeOf(pid)}; manifest names ${V4}`);
      const C = await connect("binupd-c", otherPort);
      const status = await checkedStatus(C);
      expect(
        status.installKind === "binary" && status.currentVersion === V1,
        `installKind ${status.installKind}, currentVersion ${status.currentVersion}`,
      );
      ev(`state: ${JSON.stringify(status.state)}`);
      expect(
        status.state.kind === "cannot_update" &&
          status.state.reason === "unmanaged_binary" &&
          status.state.version === V4,
        "cannot_update(unmanaged_binary) with the newer version",
      );
      expect(status.state.command === RELEASES_PAGE, `command = ${status.state.command}`);
      const forged = await C.pi
        .applyDaemonUpdate()
        .catch((e) => ({ ok: false, error: `rpc: ${e.message}` }));
      expect(
        forged.ok === false && forged.error === "cannot_update",
        `a forged apply is refused: ${JSON.stringify(forged)}`,
      );
      const check = await other(["update", "--check"]);
      expect(
        check.stdout.trim() === `update available: ${V1} -> ${V4}`,
        `update --check: ${check.stdout.trim()}`,
      );
      const update = await other(["update"]);
      ev(
        `pi-studio update (exit ${update.code}): ${(update.stdout + update.stderr).trim().split("\n").join(" | ")}`,
      );
      expect(update.code !== 0, "pi-studio update from there fails");
      expect(
        (update.stdout + update.stderr).includes(`not installed under ${PSH_OTHER}/bin/versions`) &&
          (update.stdout + update.stderr).includes(RELEASES_PAGE),
        "…naming where it must be installed and the release page",
      );
      expect(
        !existsSync(path.join(WORK, "psh-other/bin")),
        "nothing was installed: no bin/ under the other home",
      );
      expect(
        (await pidFile(PSH_OTHER)) === pid && (await healthVersion(otherPort)) === V1,
        "the daemon was not touched",
      );
      const stopped = await other(["daemon", "stop"]);
      expect(stopped.code === 0, "daemon stop");
    },
  );

  const stopped = await cli(["daemon", "stop"]);
  log(`\nfinal: daemon stop → exit ${stopped.code}`);
} catch (err) {
  failed = true;
  console.error(`\nFAILED: ${err.message ?? err}`);
  try {
    const list = await psList();
    log(
      `processes:\n  ${list
        .filter((p) => /pi-studio|sleep/.test(p.args))
        .map((p) => `${p.pid}<${p.ppid} ${p.stat} ${p.args.slice(0, 110)}`)
        .join("\n  ")}`,
    );
    log(`update-restart.log tail:\n  ${tail(await restartLog()).join("\n  ")}`);
    const daemonLog = await dbash(`tail -n 25 ${PSH}/logs/*.log 2>/dev/null`, { allowFail: true });
    log(`daemon logs tail:\n${daemonLog.stdout}`);
  } catch {
    /* nothing to show */
  }
}

log("\n── summary ──");
for (const r of results) log(`${r.pass ? "PASS" : "FAIL"}  ${r.title}  (${r.seconds} s)`);
if (flags.out)
  writeFileSync(
    flags.out,
    JSON.stringify({ versions: { V1, V2, V3, V4 }, results, requests }, null, 2),
  );
await cleanup();
process.exit(failed ? 1 : 0);
