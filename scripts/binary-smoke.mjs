#!/usr/bin/env node
// Smoke test of one built binary folder: `npm run test:binary -- dist-binary/pi-studio-<v>-<target>`
// (swe/features/single-binary-daemon.md § Release). Runs under Node from the repository; only the
// daemon under test is the binary. HOME and PI_STUDIO_HOME are a temporary folder and the daemon
// listens on a free port. Each step prints one line (`ok   ...` / `FAIL ...`); the first failure
// stops the run, and the exit code is 0 only when every step passed. The daemon process is gone at
// the end in both outcomes (the last line says so, or the run fails).
//
//   node scripts/binary-smoke.mjs <folder> [--expect-version <version>]
//
// The expected version defaults to packages/cli's (what `build:binary` names the folder after).
//
// Needs the repo built (`npm run build`): the mock agent turn, the terminal and the 1 MiB
// upload/download run through the built `@av-pi-studio/client`.
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { WebSocket } from "ws";

import {
  createWebSocketTransport,
  DaemonClient,
  FileTransferClient,
  PiStudioClient,
  TerminalStreamRouter,
} from "@av-pi-studio/client";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The daemon's pid file inside `$PI_STUDIO_HOME` (packages/cli/src/daemon-control.ts). */
const PID_FILE = "pi-studio.pid";
const COMMAND_TIMEOUT_MS = 60_000;
const STEP_TIMEOUT_MS = 30_000;
const UPLOAD_BYTES = 1024 * 1024;

/** `{ folder, expectVersion }` from the command line; `expectVersion` is undefined when not given. */
export function parseArgs(argv) {
  let folder;
  let expectVersion;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--expect-version") {
      expectVersion = argv[++i];
      if (expectVersion === undefined) throw new Error("--expect-version needs a value");
    } else if (arg.startsWith("--expect-version=")) {
      expectVersion = arg.slice("--expect-version=".length);
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown argument: ${arg}`);
    } else if (folder === undefined) {
      folder = arg;
    } else {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }
  if (folder === undefined) {
    throw new Error("usage: binary-smoke.mjs <binary folder> [--expect-version <version>]");
  }
  return { folder, expectVersion };
}

/**
 * The environment of the binary under test: the runner's own minus every `PI_*` variable (a
 * developer's daemon settings must not leak in), with HOME and the daemon's folders in `home`.
 */
export function smokeEnv(base, home) {
  const env = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && !key.startsWith("PI_")) env[key] = value;
  }
  return {
    ...env,
    HOME: home,
    PI_STUDIO_HOME: join(home, "pi-studio"),
    PI_CODING_AGENT_DIR: join(home, ".pi", "agent"),
    PI_SKIP_VERSION_CHECK: "1",
    PI_TELEMETRY: "0",
  };
}

/**
 * The daemon config of the throwaway home: the update check stays off (no registry traffic). The
 * mock provider needs no config entry: `mock` is a built-in provider id the daemon resolves for any
 * agent created with `provider: "mock"`, so the turn needs no credential.
 */
export function smokeConfig() {
  return { version: 1, daemon: { update: { autoCheck: false } }, log: { level: "info" } };
}

/** The first non-empty line of a command's output, trimmed, for a one-line failure message. */
export function firstLine(text) {
  return (
    String(text)
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "") ?? ""
  );
}

/** Runs `file args…`; resolves `{ code, stdout, stderr }` and never rejects (spawn errors → code -1). */
function run(file, args, env) {
  return new Promise((resolvePromise) => {
    execFile(
      file,
      args,
      { env, timeout: COMMAND_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error === null) {
          resolvePromise({ code: 0, stdout, stderr });
        } else {
          const code = typeof error.code === "number" ? error.code : -1;
          resolvePromise({ code, stdout, stderr: stderr || error.message });
        }
      },
    );
  });
}

/** A free TCP port on the loopback interface. */
function freePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolvePromise(port));
    });
  });
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/** Polls `predicate` until it returns a truthy value; throws `Error("timed out waiting for <what>")`. */
async function waitFor(what, predicate, timeoutMs = STEP_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

async function readPid(pidFile) {
  try {
    const pid = Number((await readFile(pidFile, "utf8")).trim());
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readHealth(port) {
  const response = await fetch(`http://127.0.0.1:${port}/api/health`);
  if (!response.ok) throw new Error(`/api/health answered HTTP ${response.status}`);
  return response.json();
}

/** Connects the SDK to the daemon at `port`; the caller closes `daemon`. */
async function connect(port) {
  const daemon = new DaemonClient({
    url: `ws://127.0.0.1:${port}`,
    clientId: "binary-smoke",
    clientType: "cli",
    transport: createWebSocketTransport((url) => new WebSocket(url)),
  });
  await daemon.connect();
  return daemon;
}

/** One mock turn: a prompt answered with `echo: <prompt>` and the turn going idle. */
async function mockTurn(daemon, cwd) {
  const client = new PiStudioClient(daemon);
  const { agentId } = await client.createAgent({
    config: { provider: "mock", cwd },
    labels: {},
  });
  const agent = client.agent(agentId);
  const prompt = `smoke-${randomBytes(4).toString("hex")}`;
  let seen = "";
  const off = agent.timeline.subscribe((event) => {
    seen += `${JSON.stringify(event)}\n`;
  });
  try {
    await agent.send(prompt);
    await waitFor(`the mock agent to answer "${prompt}"`, () => seen.includes(`echo: ${prompt}`));
  } finally {
    off();
  }
  await agent.delete();
  return prompt;
}

/** A PTY that echoes: the shell computes `40+2`, so only its output (not the typed line) has `42`. */
async function terminalEcho(daemon, cwd) {
  const router = new TerminalStreamRouter(daemon);
  router.start();
  let output = "";
  let slot;
  try {
    const created = await daemon.request("create_terminal_request", {
      workspaceId: "binary-smoke",
      cwd,
      shell: "/bin/sh",
      name: "binary-smoke",
      cols: 80,
      rows: 24,
    });
    slot = Number(created?.terminal?.slot);
    if (!Number.isInteger(slot)) throw new Error("create_terminal_response carries no slot");
    const decoder = new TextDecoder();
    const append = (data) => {
      output += decoder.decode(data, { stream: true });
    };
    router.subscribeSlot(slot, { onOutput: append, onSnapshot: append, onRestore: append });
    await daemon.request("subscribe_terminal_request", { slot, cols: 80, rows: 24 });
    router.sendInput(slot, new TextEncoder().encode("echo smoke-$((40+2))\n"));
    await waitFor("the terminal to echo smoke-42", () => output.includes("smoke-42"));
  } finally {
    router.stop();
    if (slot !== undefined) await daemon.request("kill_terminal_request", { slot }).catch(() => {});
  }
}

/** Uploads 1 MiB of random bytes, then downloads them; the three SHA-256s must be equal. */
async function transfer(daemon, dir) {
  const files = new FileTransferClient(daemon);
  files.start();
  try {
    const bytes = randomBytes(UPLOAD_BYTES);
    const path = join(dir, "upload.bin");
    await files.upload(path, new Blob([bytes]));
    const onDisk = sha256(await readFile(path));
    const downloaded = await files.download(path);
    const back = sha256(downloaded.bytes);
    const sent = sha256(bytes);
    if (onDisk !== sent) throw new Error(`the uploaded file differs (${onDisk} != ${sent})`);
    if (back !== sent) throw new Error(`the downloaded file differs (${back} != ${sent})`);
    return sent.slice(0, 12);
  } finally {
    files.stop();
  }
}

/** Runs the whole smoke test; resolves the process exit code. */
export async function smoke({ folder, expectVersion }) {
  const binary = resolve(folder, "pi-studio");
  const version =
    expectVersion ??
    JSON.parse(readFileSync(join(ROOT, "packages", "cli", "package.json"), "utf8")).version;
  const home = await mkdtemp(join(tmpdir(), "pi-binary-smoke-"));
  const env = smokeEnv(process.env, home);
  const studioHome = env.PI_STUDIO_HOME;
  const pidFile = join(studioHome, PID_FILE);
  const port = await freePort();
  const host = `127.0.0.1:${port}`;
  let failed = false;
  let daemonPid;
  let daemon;

  /** One step: prints `ok   <label>[: <detail>]`, or `FAIL <label>: <reason>` and rethrows. */
  const step = async (label, body) => {
    try {
      const detail = await body();
      console.log(detail ? `ok   ${label}: ${detail}` : `ok   ${label}`);
    } catch (error) {
      failed = true;
      const reason = error instanceof Error ? error.message : String(error);
      console.log(`FAIL ${label}: ${firstLine(reason)}`);
      throw error;
    }
  };

  /** A CLI call of the binary; throws with the first line of its output on a non-zero exit. */
  const cli = async (args) => {
    const result = await run(binary, args, env);
    if (result.code !== 0) {
      throw new Error(
        `\`pi-studio ${args.join(" ")}\` exited ${result.code}: ${firstLine(result.stderr || result.stdout)}`,
      );
    }
    return result.stdout.trim();
  };

  try {
    await mkdir(studioHome, { recursive: true });
    await mkdir(env.PI_CODING_AGENT_DIR, { recursive: true });
    await writeFile(join(studioHome, "config.json"), JSON.stringify(smokeConfig()));
    console.log(`binary smoke test: ${binary} (expecting ${version}, daemon on ${host})`);

    await step("--version", async () => {
      if (!existsSync(binary)) throw new Error(`no executable at ${binary}`);
      const printed = await cli(["--version"]);
      if (printed !== version) throw new Error(`printed "${printed}", expected "${version}"`);
      return printed;
    });

    await step("--json daemon start", async () => {
      const started = JSON.parse(await cli(["--json", "-H", host, "daemon", "start"]));
      daemonPid = await readPid(pidFile);
      if (started.up !== true || started.started !== true) {
        throw new Error(`the daemon did not start: ${JSON.stringify(started)}`);
      }
      return host;
    });

    await step("/api/health", async () => {
      const health = await waitFor("/api/health", () => readHealth(port).catch(() => undefined));
      if (health.status !== "ok" || health.version !== version) {
        throw new Error(`answered ${JSON.stringify(health)}, expected ok and ${version}`);
      }
      return `{status: ok, version: ${health.version}}`;
    });

    daemon = await connect(port).catch(() => undefined);
    await step("SDK connection", async () => {
      if (daemon === undefined) throw new Error(`cannot connect to ws://${host}`);
      return daemon.hasFeature("fileTransferAck") ? "fileTransferAck" : "";
    });

    await step("mock agent turn", async () => `answered ${await mockTurn(daemon, home)}`);
    await step("terminal echo", async () => {
      await terminalEcho(daemon, home);
    });
    await step("1 MiB upload and download", async () => `sha256 ${await transfer(daemon, home)}`);

    daemon.close();
    daemon = undefined;

    await step("__pi --version", async () => {
      const printed = await cli(["__pi", "--version"]);
      if (!/^\d+\.\d+\.\d+/.test(printed)) throw new Error(`printed "${printed}"`);
      return printed;
    });

    await step("--json daemon stop", async () => {
      const stopped = JSON.parse(await cli(["--json", "daemon", "stop"]));
      if (stopped.stopped !== true) throw new Error(`answered ${JSON.stringify(stopped)}`);
      if (daemonPid !== undefined) {
        await waitFor(`daemon process ${daemonPid} to exit`, () => !alive(daemonPid));
      }
      return daemonPid === undefined ? "" : `process ${daemonPid} gone`;
    });
  } catch {
    // The failing step already printed its line; the exit code carries it.
  } finally {
    daemon?.close();
    const pid = daemonPid ?? (await readPid(pidFile));
    failed = (await ensureDaemonGone(binary, env, pid)) || failed;
    // The daemon's boot-time extension sync can leave a `bun install` still writing its cache a
    // moment after the daemon stops (seen on CI): retry, and never fail the test over a temp folder.
    try {
      await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch (error) {
      console.log(
        `warn temporary folder not removed: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  console.log(failed ? "binary smoke test FAILED" : "binary smoke test passed");
  return failed ? 1 : 0;
}

/**
 * Leaves no daemon behind: a pid still alive is stopped through the binary, then killed. Resolves
 * true when the process could not be removed.
 */
async function ensureDaemonGone(binary, env, pid) {
  if (pid === undefined || !alive(pid)) {
    console.log("ok   daemon process gone");
    return false;
  }
  console.log(`warn daemon process ${pid} is still running: stopping it`);
  await run(binary, ["--json", "daemon", "stop"], env);
  const stopped = () =>
    waitFor("the daemon to exit", () => !alive(pid), 5_000).then(isTrue, isFalse);
  if (!(await stopped())) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  const gone = await stopped();
  console.log(
    gone ? "ok   daemon process gone" : `FAIL daemon process ${pid} could not be stopped`,
  );
  return !gone;
}

function isTrue() {
  return true;
}

function isFalse() {
  return false;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
  process.exit(await smoke(args));
}
