// The macOS job: what a machine can check without driving the page (WKWebView has no WebDriver).
// The app is started the way the dock starts it, and everything goes through the control socket
// (`desktop/docs/control-protocol.md`) and the files.
//
// Native host (sprint-106/task-004):  config dir default, ui.inspect, settings.set, clean quit.
// Daemon registry (sprint-111/task-004): the binary under the login shell's PI_STUDIO_HOME (zsh and bash),
// start, quit leaves the daemon, stop, a direct entry's password, an outdated running daemon.
// Milestone 2 (sprint-117/task-002): after the local daemon starts, one open transport with frames in
// (a window and its page exist); the app's process stopped 15 s and continued, `resumeSignals.wake`
// rises (inside `lifecycleChecks`); and `macos-keychain.mjs`, the one launch that uses the login keychain.
//
// Every daemon runs in a scratch `PI_STUDIO_HOME` on a free port, and is stopped in the `finally`
// of the run, also when a check failed.

// What the first runs on a runner showed (macos-15, arm64, 2026-11-20, pull request #59):
//  - Command-Q through System Events works there (`macos.control.quit` passes); when a runner does
//    not let `osascript` send keystrokes, the app is sent SIGTERM, the check is skipped and the
//    checklist item stays manual.
//  - `/bin/zsh -l -i -c` and `/bin/bash -l -i -c` print their environment without a terminal within
//    the app's 5 s (zsh in 160 ms, bash in 43 ms), and `~/.zprofile` / `~/.bash_profile` of a
//    scratch HOME are read.
//  - The app's default configuration directory is under `$HOME`:
//    `~/Library/Application Support/com.avatsaev.pi-studio` (the check fails if it is not).
// Not shown: that a window opens (the control socket answers either way), and that an emptied
// environment with HOME, USER, LOGNAME, SHELL, PATH and TMPDIR is close enough to launchd's for
// the dock; a launch from the dock itself stays in the manual checklist.

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir, userInfo } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { launch, SECRET_STORE_ARG, waitForControlPort, waitForExit } from "./app-process.mjs";
import { stopAndContinue, waitForOpenTransport } from "./bridge.mjs";
import { ControlClient, parseConfigDir } from "./control-client.mjs";
import { keychainCheck } from "./macos-keychain.mjs";
import { freePort, healthStatus } from "./net.mjs";
import { Skip } from "./report.mjs";
import { cliWrapperText, displayVariables, dockEnvironment, profileText, SHELLS } from "./shell-profile.mjs";
import { continuePosix, stopPosix } from "./suspend.mjs";
import { Abort, sleep, waitFor } from "./wait.mjs";

const execFileAsync = promisify(execFile);

/** The oldest daemon the app accepts is 0.0.127; a running daemon of this version is older, and the check's health endpoint answers it. */
const OUTDATED_VERSION = "0.0.118";

/** The per-user directory of the app on `platform`, relative to the home directory. */
export function defaultConfigSuffix(platform) {
  return platform === "darwin" ? "Library/Application Support/com.avatsaev.pi-studio" : ".config/com.avatsaev.pi-studio";
}

/** AppleScript for Command-Q in the app with `pid`: what a user does. Needs the runner to allow System Events to send keystrokes. */
function quitScript(pid) {
  return [
    'tell application "System Events"',
    `  set frontmost of (first process whose unix id is ${pid}) to true`,
    "  delay 0.5",
    '  keystroke "q" using command down',
    "end tell",
  ].join("\n");
}

/** `{ state, ... }` of the local daemon, from `ui.inspect`. */
async function localState(control) {
  return (await control.inspect()).daemons.local;
}

function waitLocal(control, what, accept, timeoutMs) {
  return waitFor(what, async () => accept(await localState(control)), { timeoutMs, intervalMs: 250 });
}

/**
 * Run an engine command that starts local work. The app itself probes the local daemon now and
 * then (when the Daemons screen opens, say), and the answer to a request made meanwhile is `busy`:
 * it is asked again.
 */
function executeWhenFree(control, command, params) {
  return waitFor(
    `${command} to be accepted`,
    async () => {
      try {
        return await control.execute(command, params);
      } catch (error) {
        if (error.message.endsWith(": busy")) return null;
        throw new Abort(error.message);
      }
    },
    { timeoutMs: 30_000, intervalMs: 300 },
  );
}

/** Once the app's first probe of the local daemon is done. */
async function settledLocal(control) {
  return waitFor("the first probe of the local daemon", async () => {
    const local = await localState(control);
    return local.state === "checking" ? null : local;
  }, { timeoutMs: 40_000, intervalMs: 250 });
}

async function runIn(env, command, args) {
  try {
    const { stdout } = await execFileAsync(command, args, { env, timeout: 30_000 });
    return stdout;
  } catch {
    return null;
  }
}

/** One run of the job: the scratch space, every app and daemon it started, and what to report. */
export class MacosRun {
  constructor({ app, cliEntry, fakeCli, outDir, report, shells, quit }) {
    Object.assign(this, { app, cliEntry, fakeCli, outDir, report, shells, quit });
    this.root = mkdtempSync(path.join(tmpdir(), "pi-platform-checks-"));
    this.apps = [];
    this.worlds = [];
  }

  scratch(...parts) {
    const dir = path.join(this.root, ...parts);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** Start the app with `env` (nothing else) and connect to its control socket. */
  async start(name, { env, configDir }) {
    const dir = this.scratch("control", name);
    const tokenFile = path.join(dir, "token");
    const args = ["--control", "0", "--control-token-file", tokenFile, SECRET_STORE_ARG, ...(configDir ? ["--config-dir", configDir] : [])];
    const app = launch(this.app, args, { ...displayVariables(process.env), ...env }, path.join(this.outDir, `app-${name}.log`));
    this.apps.push(app);
    const port = await waitForControlPort(app);
    const control = await ControlClient.connect({ port, token: readFileSync(tokenFile, "utf8").trim() });
    return { name, app, control };
  }

  /**
   * Quit as a user does (Command-Q). Where the runner does not let System Events press keys, or
   * for `quit: "sigterm"`, the app is sent SIGTERM instead and `graceful` is false.
   */
  async quitApp(session) {
    session.control.close();
    let graceful = this.quit === "applescript";
    let detail = graceful ? "Command-Q through System Events" : "SIGTERM";
    if (graceful) {
      try {
        await execFileAsync("osascript", ["-e", quitScript(session.app.pid)], { timeout: 20_000 });
      } catch (error) {
        graceful = false;
        detail = `SIGTERM, since System Events refused the keystroke (${String(error.stderr ?? error.message).trim()})`;
      }
    }
    if (!graceful) session.app.child.kill("SIGTERM");
    const ended = await waitForExit(session.app, 20_000);
    if (ended.killed) throw new Error(`the app did not exit within 20 s of the quit (${detail}); it was killed`);
    return { graceful, detail, code: ended.code, signal: ended.signal };
  }

  /**
   * A scratch home whose only start-up file puts `node` on PATH and sets PI_STUDIO_HOME, for `shell`. The repository's CLI is
   * installed where the app looks for its binary, `$PI_STUDIO_HOME/bin/current/pi-studio`; the app reads that home from the login
   * shell and runs it. Its version is the repository's, which is not below the pin; a build whose pin is newer would download
   * the pinned daemon instead (macOS has not been run for this layout: sprint-143/task-003).
   */
  async world(shell) {
    const root = this.scratch(`world-${shell}`);
    const [home, piHome, configDir] = ["home", "pi-home", "config"].map((name) => this.scratch(`world-${shell}`, name));
    const port = await freePort();
    const installed = this.scratch(`world-${shell}`, "pi-home", "bin", "versions", "fake");
    const wrapper = path.join(installed, "pi-studio");
    writeFileSync(wrapper, cliWrapperText({ cliEntry: path.resolve(this.cliEntry), host: `127.0.0.1:${port}` }));
    chmodSync(wrapper, 0o755);
    symlinkSync("versions/fake", path.join(piHome, "bin", "current"));
    writeFileSync(path.join(home, SHELLS[shell].profile), profileText({ binDirs: [path.dirname(process.execPath)], piHome }));
    // Auto-start off: a daemon starts only when a check asks.
    writeFileSync(path.join(configDir, "settings.json"), JSON.stringify({ version: 1, autoStartLocalDaemon: false }));
    const env = dockEnvironment({ home, shell, tmpdir: tmpdir(), user: userInfo().username });
    const world = { shell, root, home, piHome, configDir, port, wrapper, env };
    this.worlds.push(world);
    return world;
  }

  /** The end of the run: no app and no daemon is left, whatever happened. */
  async cleanup() {
    for (const app of this.apps) if (app.running()) app.child.kill("SIGKILL");
    for (const world of this.worlds) await this.stopDaemon(world);
  }

  async stopDaemon(world) {
    const env = { ...process.env, PI_STUDIO_HOME: world.piHome, PATH: `${path.dirname(process.execPath)}:${process.env.PATH}` };
    await runIn(env, world.wrapper, ["daemon", "stop"]);
    const pidFile = path.join(world.piHome, "pi-studio.pid");
    if (!existsSync(pidFile)) return;
    const pid = Number(readFileSync(pidFile, "utf8").trim());
    for (const signal of ["SIGTERM", "SIGKILL"]) {
      try {
        process.kill(pid, signal);
      } catch {
        return;
      }
      await sleep(1000);
    }
  }
}

// --- native host ---------------------------------------------------------------------------

async function configDirCheck(run) {
  const home = run.scratch("home-default");
  const env = dockEnvironment({ home, shell: "zsh", tmpdir: tmpdir(), user: userInfo().username });
  await run.report.run("macos.config-dir", "the configuration directory's default location is printed", async ({ note }) => {
    const session = await run.start("default-dir", { env });
    try {
      const dir = await waitFor("the app's log line naming its configuration directory", () => parseConfigDir(session.app.log()), { timeoutMs: 20_000 });
      run.report.fact("Configuration directory (default, as the app logs it; HOME was a scratch directory)", dir, `HOME: ${home}`);
      const expected = path.join(home, defaultConfigSuffix(process.platform));
      if (path.resolve(dir) !== path.resolve(expected)) throw new Error(`expected ${expected} (the app's documented default), the app uses ${dir}`);
      note("the default is under the user's home as documented");
    } finally {
      await run.quitApp(session).catch(() => {});
    }
  });
}

async function controlChecks(run) {
  const configDir = run.scratch("config-basic");
  const home = run.scratch("home-basic");
  const env = dockEnvironment({ home, shell: "zsh", tmpdir: tmpdir(), user: userInfo().username });
  let session;
  const started = await run.report.run("macos.control.start", "the app starts with --control 0 --config-dir <tmp>", async ({ note }) => {
    session = await run.start("basic", { env, configDir });
    note(`control socket on a free port; log: app-basic.log`);
  });
  if (!started) {
    run.report.skipAll(
      [
        { id: "macos.control.inspect", title: "ui.inspect answers" },
        { id: "macos.control.settings-write", title: "settings.set writes settings.json" },
        { id: "registry.macos.direct-entry", title: "a direct entry with a password: daemons.json is mode 0600 and no answer holds the password" },
        { id: "macos.control.quit", title: "the app exits cleanly on quit" },
        { id: "registry.macos.no-secret-in-log", title: "no line of the app's log holds the password" },
      ],
      "the app did not start",
    );
    return;
  }
  const secret = `platform-check-secret-${randomBytes(8).toString("hex")}`;
  await run.report.run("macos.control.inspect", "ui.inspect answers", async ({ note }) => {
    const view = await session.control.inspect();
    for (const key of ["ui", "settings", "daemons", "menus"]) {
      if (!(key in view)) throw new Error(`ui.inspect has no "${key}"`);
    }
    note(`entries: ${view.daemons.entries.length}, menus: ${view.menus.length}`);
  });
  await run.report.run("macos.control.settings-write", "settings.set writes settings.json", async () => {
    await session.control.execute("settings.set", { key: "autoStartLocalDaemon", value: false });
    const file = path.join(configDir, "settings.json");
    const settings = await waitFor("settings.json", () => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null), { timeoutMs: 5000 });
    if (settings.autoStartLocalDaemon !== false) throw new Error(`settings.json has autoStartLocalDaemon = ${JSON.stringify(settings.autoStartLocalDaemon)}, expected false`);
  });
  await run.report.run("registry.macos.direct-entry", "a direct entry with a password: daemons.json is mode 0600 and no answer holds the password", async ({ note }) => {
    const entry = await session.control.execute("daemon.add", { kind: "direct", name: "Secret box", address: "ws://127.0.0.1:9", password: secret });
    if (entry.hasPassword !== true) throw new Error(`the new entry says hasPassword = ${JSON.stringify(entry.hasPassword)}`);
    await session.control.execute("daemon.list");
    await session.control.inspect();
    const file = path.join(configDir, "daemons.json");
    await waitFor("daemons.json", () => existsSync(file), { timeoutMs: 5000 });
    const mode = statSync(file).mode & 0o777;
    if (mode !== 0o600) throw new Error(`daemons.json is mode ${mode.toString(8).padStart(4, "0")}, expected 0600`);
    note("daemons.json is mode 0600");
    const leaked = session.control.replies.filter((line) => line.includes(secret));
    if (leaked.length > 0) throw new Error(`${leaked.length} control answer(s) contain the password`);
    note(`${session.control.replies.length} control answers hold no password`);
  });
  let quit;
  await run.report.run("macos.control.quit", "the app exits cleanly on quit", async ({ note }) => {
    quit = await run.quitApp(session);
    note(quit.detail);
    if (!quit.graceful) throw new Skip(`the app ended (${quit.signal ?? `code ${quit.code}`}) but not through a quit a user can do`);
    if (quit.code !== 0) throw new Error(`the app exited with ${quit.signal ?? `code ${quit.code}`}`);
  });
  if (!quit) await run.quitApp(session).catch(() => {});
  await run.report.run("registry.macos.no-secret-in-log", "no line of the app's log holds the password", async ({ note }) => {
    const log = session.app.log();
    if (log.includes(secret)) throw new Error("the app's log contains the password");
    note(`${log.split("\n").length} log lines`);
  });
}

// --- daemon registry -----------------------------------------------------------------------

/**
 * A running daemon older than the minimum is `outdated`: the fake binary (a version above the pin, so nothing is installed)
 * says a daemon is up at the port of a stand-in health endpoint, which answers the old version, as an npm daemon would.
 */
async function daemonOutdatedCheck(run) {
  const dir = run.scratch("fake-cli");
  const piHome = run.scratch("fake-pi-home");
  const installed = run.scratch("fake-pi-home", "bin", "versions", "fake");
  copyFileSync(run.fakeCli, path.join(installed, "pi-studio"));
  chmodSync(path.join(installed, "pi-studio"), 0o755);
  symlinkSync("versions/fake", path.join(piHome, "bin", "current"));
  writeFileSync(path.join(dir, "running"), "");
  const health = createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "ok", version: OUTDATED_VERSION }));
  });
  await new Promise((resolve) => health.listen(0, "127.0.0.1", resolve));
  const home = run.scratch("home-fake");
  const env = dockEnvironment({
    home,
    shell: "zsh",
    tmpdir: tmpdir(),
    user: userInfo().username,
    extra: { PI_STUDIO_HOME: piHome, FAKE_PI_DIR: dir, FAKE_PI_PORT: String(health.address().port), FAKE_PI_VERSION: "999.0.0" },
  });
  const configDir = run.scratch("config-fake");
  writeFileSync(path.join(configDir, "settings.json"), JSON.stringify({ version: 1, autoStartLocalDaemon: false }));
  await run.report.run("registry.macos.daemon-outdated", `a running daemon reporting ${OUTDATED_VERSION} is outdated`, async ({ note }) => {
    const session = await run.start("fake-cli", { env, configDir });
    try {
      const local = await settledLocal(session.control);
      if (local.state !== "outdated") throw new Error(`the local daemon is ${JSON.stringify(local)}, expected outdated`);
      if (local.version !== OUTDATED_VERSION) throw new Error(`outdated names version ${local.version}, expected ${OUTDATED_VERSION}`);
      note(`state: ${JSON.stringify(local)}`);
    } finally {
      await run.quitApp(session).catch(() => {});
      health.close();
    }
  });
}

/** The state is `stopped`: PI_STUDIO_HOME and `node` were both read from the login shell, so the probe ran the binary's `daemon status`. */
async function foundCheck(run, world) {
  const { shell } = world;
  let session = null;
  const found = await run.report.run(`registry.macos.cli-found.${shell}`, `${shell}: the binary under PI_STUDIO_HOME is found through the login shell's start-up file alone`, async ({ note }) => {
    session = await run.start(`cli-${shell}`, { env: world.env, configDir: world.configDir });
    try {
      const local = await settledLocal(session.control);
      if (local.state !== "stopped") {
        throw new Error(`the local daemon is ${JSON.stringify(local)}, expected {"state":"stopped"}. PATH of the app was ${world.env.PATH}; ${SHELLS[shell].profile} put ${path.dirname(process.execPath)} on it and set PI_STUDIO_HOME=${world.piHome}`);
      }
    } catch (error) {
      // One app at a time (single instance): this one must be gone before the next check starts.
      await run.quitApp(session).catch(() => {});
      throw error;
    }
    note(`${shell} (${SHELLS[shell].path} -l -i) found ${world.wrapper}`);
    run.report.fact(`Binary found through the login shell: ${shell}`, `${world.wrapper} via ~/${SHELLS[shell].profile}`);
  });
  return found ? session : null;
}

/** The checks of the connection through Rust, in the order they run after the local daemon started. */
const BRIDGE_CHECKS = [
  { id: "bridge.macos.transport-open", title: "after the local daemon starts, ui.inspect shows one open transport with frames in (so a window and its page exist)" },
  { id: "bridge.macos.wake", title: "the app's process stopped for 15 s and continued: resumeSignals.wake rises and the transport is open again" },
];

/** How long the app's process is stopped, as a machine's sleep stops it (a wake is 10 s or more unaccounted for). */
const STOP_MS = 15_000;

/**
 * With the local daemon running and the window connected to it by the workbench itself (it
 * connects when a daemon that was started comes up while it is connected to nothing): the page's
 * connection is through Rust, and the app's wake signal works on this machine.
 */
async function bridgeChecks(run, session) {
  const { control } = session;
  const [opened, wake] = BRIDGE_CHECKS;
  const connected = await run.report.run(opened.id, opened.title, async ({ note }) => {
    const began = Date.now();
    const connection = await waitForOpenTransport(control, { entryId: "local", timeoutMs: 60_000 });
    const [transport] = connection.transports;
    note(`open after ${((Date.now() - began) / 1000).toFixed(1)} s: framesIn ${transport.framesIn}, framesOut ${transport.framesOut}; secretStore ${connection.secretStore}; lastError ${connection.lastError?.code ?? "none"}`);
    run.report.fact("The page's connection to the local daemon through Rust (macOS, WKWebView)", `transport ${transport.state} for ${transport.entryId}: framesIn ${transport.framesIn}, bytesIn ${transport.bytesIn}, framesOut ${transport.framesOut}, bytesOut ${transport.bytesOut}, peakHeldIn ${transport.peakHeldIn}, peakHeldOut ${transport.peakHeldOut}`);
  });
  if (!connected) {
    run.report.skipAll([wake], "no transport opened");
    return;
  }
  await run.report.run(wake.id, wake.title, async ({ note }) => {
    const pid = session.app.pid;
    const [before] = (await control.inspect()).connection.transports;
    const result = await stopAndContinue({ control, stop: () => stopPosix(pid), resume: () => continuePosix(pid), holdMs: STOP_MS });
    const connection = await waitForOpenTransport(control, { entryId: "local", timeoutMs: 20_000 });
    const [after] = connection.transports;
    // The page asks the daemon with a ping when it is told of a resume: framesIn rises with the answer.
    const probed = await waitFor("the page's probe to be answered", async () => ((await control.inspect()).connection.transports[0]?.framesIn > before.framesIn ? true : null), { timeoutMs: 12_000, intervalMs: 500 }).catch(() => false);
    note(`stopped ${(result.heldMs / 1000).toFixed(1)} s; wake ${result.before} -> ${result.after}, counted ${(result.countedAfterMs / 1000).toFixed(1)} s after the continue; transport ${after.state}, framesIn ${before.framesIn} -> ${after.framesIn}${probed ? " (the page's probe was answered)" : " (no frame came after the continue)"}`);
    run.report.fact("Resume signal (macOS, the app's process stopped 15 s)", `resumeSignals.wake ${result.before} -> ${result.after} (${(result.countedAfterMs / 1000).toFixed(1)} s after the continue)`, `transport open again, same entry; the page's probe answered: ${probed ? "yes" : "no"}`);
  });
}

async function lifecycleChecks(run, world, session) {
  const { port } = world;
  const rest = [
    { id: "registry.macos.daemon-health", title: "the daemon answers its health check" },
    { id: "registry.macos.quit-leaves-daemon", title: "quitting the app leaves the daemon running" },
    { id: "registry.macos.daemon-stop", title: "daemon.local.stop stops it" },
    ...BRIDGE_CHECKS,
  ];
  const started = await run.report.run("registry.macos.daemon-start", "daemon.local.start: running", async ({ note }) => {
    const began = Date.now();
    await executeWhenFree(session.control, "daemon.local.start");
    const local = await waitFor(
      "the local daemon running",
      async () => {
        const state = await localState(session.control);
        if (state.state === "running") return state;
        if (state.state !== "starting") throw new Abort(`the local daemon is ${JSON.stringify(state)} after start`);
        return null;
      },
      { timeoutMs: 120_000, intervalMs: 250 },
    );
    const took = Date.now() - began;
    if (local.port !== port) throw new Error(`running on port ${local.port}, expected ${port}`);
    note(`start took ${(took / 1000).toFixed(1)} s`);
    run.report.fact("daemon.local.start duration", `${(took / 1000).toFixed(1)} s (to state running, on port ${port})`);
  });
  if (!started) {
    await run.quitApp(session).catch(() => {});
    run.report.skipAll(rest, "the daemon did not start");
    return;
  }
  await run.report.run("registry.macos.daemon-health", "the daemon answers its health check", async () => {
    const status = await waitFor("the health endpoint", async () => ((await healthStatus(port)) === 200 ? 200 : null), { timeoutMs: 15_000, intervalMs: 500 });
    if (status !== 200) throw new Error("unreachable");
  });
  await bridgeChecks(run, session);
  await run.report.run("registry.macos.quit-leaves-daemon", "quitting the app leaves the daemon running", async ({ note }) => {
    await run.quitApp(session);
    await sleep(2000);
    if ((await healthStatus(port)) !== 200) throw new Error("the daemon stopped when the app quit");
    note("health check answers 200 two seconds after the app ended");
  });
  await run.report.run("registry.macos.daemon-stop", "daemon.local.stop stops it", async ({ note }) => {
    const again = await run.start(`cli-${world.shell}-again`, { env: world.env, configDir: world.configDir });
    try {
      const local = await settledLocal(again.control);
      if (local.state !== "running") throw new Error(`a new launch sees the local daemon as ${JSON.stringify(local)}, expected running (adopted)`);
      await executeWhenFree(again.control, "daemon.local.stop");
      await waitLocal(again.control, "stopped", (s) => (s.state === "stopped" ? s : null), 60_000);
      await waitFor("the health endpoint to stop answering", async () => ((await healthStatus(port)) === null ? true : null), { timeoutMs: 15_000, intervalMs: 500 });
      note("a second launch adopted the running daemon, then stopped it");
    } finally {
      await run.quitApp(again).catch(() => {});
    }
  });
}

async function shellChecks(run, shell, withLifecycle) {
  const world = await run.world(shell);
  const session = await foundCheck(run, world);
  if (!session) {
    if (withLifecycle) {
      run.report.skipAll(
        [
          { id: "registry.macos.daemon-start", title: "daemon.local.start: running" },
          { id: "registry.macos.daemon-health", title: "the daemon answers its health check" },
          { id: "registry.macos.quit-leaves-daemon", title: "quitting the app leaves the daemon running" },
          { id: "registry.macos.daemon-stop", title: "daemon.local.stop stops it" },
          ...BRIDGE_CHECKS,
        ],
        `the CLI was not found under ${shell}`,
      );
    }
    return;
  }
  if (withLifecycle) await lifecycleChecks(run, world, session);
  else await run.quitApp(session).catch(() => {});
}

/**
 * Run the real CLI's `--version` once, before the app does, and print how long that first run took.
 * The app allows `--version` 15 s; the first run on a macOS runner (cold files, Gatekeeper) took
 * over that once (run of 2026-11-20: `failed`/`timeout` under zsh) and about 4.5 s another time,
 * which is a fact about a cold machine, not about the shell lookup these checks are for.
 */
async function warmCli(run) {
  const began = Date.now();
  try {
    await execFileAsync(process.execPath, [path.resolve(run.cliEntry), "--version"], { timeout: 60_000 });
    run.report.fact("The real CLI's first `--version` (cold), run before the app's checks", `${((Date.now() - began) / 1000).toFixed(1)} s (the app allows 15 s)`);
  } catch (error) {
    run.report.fact("The real CLI's first `--version` (cold)", `failed: ${error.message.split("\n")[0]}`);
  }
}

/** Every macOS check. Daemons and apps started on the way are stopped at the end, whatever failed. */
export async function runMacosChecks(run) {
  await warmCli(run);
  try {
    await configDirCheck(run);
    await controlChecks(run);
    await daemonOutdatedCheck(run);
    for (const [index, shell] of run.shells.entries()) await shellChecks(run, shell, index === 0);
    await keychainCheck(run);
  } finally {
    await run.cleanup();
  }
}
