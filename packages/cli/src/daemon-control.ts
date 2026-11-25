import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { request } from "node:http";
import { join } from "node:path";

import {
  daemonCommand,
  generateDaemonKeypair,
  rawObject,
  readRawConfig,
  waitForProcessExit,
  writeDaemonKeypair,
} from "@av-pi-studio/server";
import { SHUTDOWN_DEADLINE_MS } from "@av-pi-studio/server/shutdown";
import bcrypt from "bcryptjs";

import { parseHost } from "./connection.js";

/**
 * Local daemon control (features/cli.md § Command tree (daemon), § Behavior). The CLI and daemon
 * share `$PI_STUDIO_HOME`, so control operations read/write that directory directly
 * (`config.json`, `pi-studio.pid`, `daemon-keypair.json`) and probe the HTTP health endpoint.
 *
 * Side-effecting operations (process spawn/kill, network probe, password hashing) are injectable so
 * the command layer is unit-testable without touching real processes or sockets.
 */

export const PID_FILE = "pi-studio.pid";
export const CONFIG_FILE = "config.json";
export const HEALTH_PATH = "/api/health";
/** Delay between two liveness checks while waiting for a process to exit. */
const EXIT_POLL_MS = 100;

export interface DaemonPaths {
  config: string;
  pid: string;
  keypair: string;
}

export function daemonPaths(home: string): DaemonPaths {
  return {
    config: join(home, CONFIG_FILE),
    pid: join(home, PID_FILE),
    keypair: join(home, "daemon-keypair.json"),
  };
}

/** Read the recorded daemon pid (or null when no live lock file). */
export function readDaemonPid(home: string): number | null {
  const path = daemonPaths(home).pid;
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8").trim();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

// ─── Injectable side-effects ─────────────────────────────────────────────────────

/** Probe whether a daemon answers the health endpoint at host:port. */
export type HealthProbe = (host: string, port: number) => Promise<boolean>;

/** Hash a plaintext password (bcrypt). */
export type PasswordHasher = (plaintext: string) => string;

/** Send a signal to a pid; returns true on success. */
export type ProcessKiller = (pid: number, signal?: NodeJS.Signals) => boolean;

/** Resolve `true` once the process is gone, `false` when it still exists after `timeoutMs`. */
export type ProcessExitWaiter = (pid: number, timeoutMs: number) => Promise<boolean>;

/** The version the daemon at host:port reports on the health endpoint, or null when unreadable. */
export type HealthVersionReader = (host: string, port: number) => Promise<string | null>;

/** Start a detached daemon process; returns its pid. */
export type DaemonStarter = (opts: {
  home: string;
  listen: string;
  /** Overrides `PI_STUDIO_PI_HOME` — redirects the bundled Pi CLI's own `.pi` config dir. */
  piHome?: string;
}) => Promise<number>;

export interface DaemonRuntime {
  probe: HealthProbe;
  hash: PasswordHasher;
  kill: ProcessKiller;
  start: DaemonStarter;
  waitForExit: ProcessExitWaiter;
  readVersion: HealthVersionReader;
}

/** Default health probe via node:http GET /api/health (200 ⇒ up). */
export const httpHealthProbe: HealthProbe = (host, port) =>
  new Promise<boolean>((resolve) => {
    const req = request({ host, port, path: HEALTH_PATH, method: "GET", timeout: 1500 }, (res) => {
      res.resume();
      resolve((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });

export const httpHealthVersionReader: HealthVersionReader = (host, port) =>
  new Promise<string | null>((resolve) => {
    const req = request({ host, port, path: HEALTH_PATH, method: "GET", timeout: 1500 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () => {
        try {
          const parsed: unknown = JSON.parse(body);
          const version =
            parsed !== null && typeof parsed === "object" && "version" in parsed
              ? parsed.version
              : null;
          resolve(typeof version === "string" ? version : null);
        } catch {
          resolve(null);
        }
      });
      res.on("error", () => resolve(null));
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });

export const bcryptHasher: PasswordHasher = (plaintext) => bcrypt.hashSync(plaintext, 10);

export const processExitWaiter: ProcessExitWaiter = (pid, timeoutMs) =>
  waitForProcessExit(pid, { timeoutMs, pollMs: EXIT_POLL_MS });

export const signalKiller: ProcessKiller = (pid, signal = "SIGTERM") => {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
};

/** The server module's absolute URL, resolved inside the CLI's own module graph (Node only). */
const resolveServerUrl = (): string => import.meta.resolve("@av-pi-studio/server");

/**
 * Default daemon starter: spawn a detached process that boots the real daemon via
 * `@av-pi-studio/server`'s `runDaemon()` (never `startDaemon`; see `daemonStartScript`). The
 * command comes from the runtime seam: a Node `-e` script on Node, `<binary> __daemon <json>` in the
 * compiled binary. Resolves once the process is spawned (health is then polled by the caller).
 *
 * On Node the server module is resolved to an absolute file URL *here*, inside
 * `@av-pi-studio/cli`'s own module graph, and that resolved URL — not the bare
 * `"@av-pi-studio/server"` specifier — is baked into the spawned `-e` script. A detached
 * `node -e <code>` child has no package/module context of its own, so a bare-specifier `import()`
 * inside it can fail to resolve `server` even when it's correctly installed, if npm's install
 * topology nested it under `cli`'s own `node_modules` rather than hoisting it to a shared root
 * (observed in a real global install).
 */
export const subprocessStarter: DaemonStarter = ({ home, listen, piHome }) =>
  new Promise<number>((resolve, reject) => {
    const [host, portStr] = listen.split(":");
    let command: string[];
    try {
      command = daemonCommand({ host, port: Number(portStr), home }, resolveServerUrl);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    const child = spawn(command[0] as string, command.slice(1), {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        PI_STUDIO_HOME: home,
        PI_STUDIO_LISTEN: listen,
        ...(piHome ? { PI_STUDIO_PI_HOME: piHome } : {}),
      },
    });
    child.on("error", reject);
    if (child.pid === undefined) {
      reject(new Error("failed to spawn daemon process"));
      return;
    }
    child.unref();
    resolve(child.pid);
  });

export function defaultDaemonRuntime(): DaemonRuntime {
  return {
    probe: httpHealthProbe,
    hash: bcryptHasher,
    kill: signalKiller,
    start: subprocessStarter,
    waitForExit: processExitWaiter,
    readVersion: httpHealthVersionReader,
  };
}

// ─── Operations ──────────────────────────────────────────────────────────────────

/** Report whether the daemon at the given host is reachable. */
export async function daemonStatus(
  runtime: DaemonRuntime,
  hostArg?: string,
): Promise<{ up: boolean; host: string; port: number }> {
  const { host, port } = parseHost(hostArg);
  const up = await runtime.probe(host, port);
  return { up, host, port };
}

/**
 * Write a bcrypt-hashed password into `config.json` (daemon.auth.password). The daemon enforces it
 * on its next (re)start. Preserves existing config; creates the file/home if missing. Throws
 * `ConfigUnreadableError` (file untouched) when the existing file cannot be read.
 */
export function setDaemonPassword(home: string, plaintext: string, runtime: DaemonRuntime): void {
  updateConfigFile(home, (daemon) => {
    const auth = rawObject(daemon, "auth");
    auth.password = runtime.hash(plaintext);
    daemon.auth = auth;
  });
}

/**
 * Read-merge-write `config.json` for the CLI: `change` edits the `daemon` object of the RAW contents
 * (unknown keys survive, nothing is defaulted), then `version: 1` is set when absent and the file is
 * written with {@link writeConfigFile}. A file that cannot be read throws `ConfigUnreadableError`
 * before anything is written.
 */
function updateConfigFile(home: string, change: (daemon: Record<string, unknown>) => void): void {
  const path = daemonPaths(home).config;
  const config = readRawConfig(path);
  const daemon = rawObject(config, "daemon");
  change(daemon);
  config.daemon = daemon;
  if (config.version === undefined) config.version = 1;
  writeConfigFile(home, path, config);
}

/**
 * Persist `config.json` atomically (temp file in the same directory, fsync, rename) and owner-only
 * (0600): it can carry the daemon password hash. The temp file is created 0600, so the renamed file
 * is too, also when it replaces one written before this was enforced.
 */
function writeConfigFile(home: string, path: string, config: Record<string, unknown>): void {
  mkdirSync(home, { recursive: true });
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    const fd = openSync(tmp, "wx", 0o600);
    try {
      writeFileSync(fd, `${JSON.stringify(config, null, 2)}\n`, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

/** Env vars that configure the outbound relay dial (config.md § Env precedence). */
const RELAY_ENV_KEYS = [
  "PI_STUDIO_RELAY_ENABLED",
  "PI_STUDIO_RELAY_ENDPOINT",
  "PI_STUDIO_RELAY_PUBLIC_ENDPOINT",
  "PI_STUDIO_RELAY_USE_TLS",
  "PI_STUDIO_RELAY_PUBLIC_USE_TLS",
] as const;

function envBool(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Persist `PI_STUDIO_RELAY_*` env vars into `config.json`'s `daemon.relay` (creating the file/home
 * if missing), so a later `pi-studio daemon start` invoked *without* those env vars still dials the
 * same relay.
 *
 * The daemon's own `loadConfig` (`overlayEnv`) overlays env vars onto `config.json` at load time,
 * but that overlay is in-memory only, scoped to that one process — it never writes back to disk.
 * Nothing else persists relay settings either (unlike `daemon.auth.password`, which has
 * `setDaemonPassword`), so relay env vars were silently forgotten the moment the shell/env that set
 * them was gone, even though the daemon they started really was relay-enabled in the meantime.
 *
 * No-ops (does not touch or create `config.json`) when none of `RELAY_ENV_KEYS` are set — a plain
 * `daemon start` with no relay env vars must not force a config file into existence or disturb an
 * already-persisted relay config. Mirrors `setDaemonPassword`'s read-merge-write shape.
 */
export function persistRelayEnvOverrides(
  home: string,
  env: Record<string, string | undefined> = process.env,
): void {
  if (!RELAY_ENV_KEYS.some((key) => env[key] !== undefined)) return;

  updateConfigFile(home, (daemon) => {
    const relay = rawObject(daemon, "relay");

    if (env.PI_STUDIO_RELAY_ENABLED !== undefined)
      relay.enabled = envBool(env.PI_STUDIO_RELAY_ENABLED);
    if (env.PI_STUDIO_RELAY_ENDPOINT) relay.endpoint = env.PI_STUDIO_RELAY_ENDPOINT;
    if (env.PI_STUDIO_RELAY_PUBLIC_ENDPOINT)
      relay.publicEndpoint = env.PI_STUDIO_RELAY_PUBLIC_ENDPOINT;
    if (env.PI_STUDIO_RELAY_USE_TLS !== undefined)
      relay.useTls = envBool(env.PI_STUDIO_RELAY_USE_TLS);
    if (env.PI_STUDIO_RELAY_PUBLIC_USE_TLS !== undefined) {
      relay.publicUseTls = envBool(env.PI_STUDIO_RELAY_PUBLIC_USE_TLS);
    }

    daemon.relay = relay;
  });
}

/** The `daemon stop` answer: `stopped` is true only once the process has exited. */
export interface StopResult {
  stopped: boolean;
  /** `still_running`: the process was signalled (or could not be) and still exists. */
  error?: "still_running";
}

/**
 * How long `daemon stop` and `daemon restart` wait for the old process to exit: the daemon's own
 * shutdown deadline (it abandons a stuck step then and exits within a couple of seconds) plus a
 * margin. The desktop app's `STOP_TIMEOUT` (`desktop/crates/shell/src/cli_answers.rs`) must exceed
 * this.
 */
export const STOP_TIMEOUT_MS = SHUTDOWN_DEADLINE_MS + 5_000;

/**
 * Stop the local daemon: SIGTERM its recorded pid, then wait for the process to exit. No pid file,
 * or one whose process is gone (it is removed), is `{ stopped: false }`; a process that survives the
 * wait, or one that cannot be signalled but exists, is `{ stopped: false, error: "still_running" }`.
 */
export async function stopDaemon(home: string, runtime: DaemonRuntime): Promise<StopResult> {
  const pid = readDaemonPid(home);
  if (pid === null) return { stopped: false };
  const pidFile = daemonPaths(home).pid;
  if (!runtime.kill(pid)) {
    // `waitForExit(pid, 0)` is a single liveness check.
    if (!(await runtime.waitForExit(pid, 0))) return { stopped: false, error: "still_running" };
    rmSync(pidFile, { force: true });
    return { stopped: false };
  }
  if (!(await runtime.waitForExit(pid, STOP_TIMEOUT_MS))) {
    return { stopped: false, error: "still_running" };
  }
  // A daemon that exited cleanly removed its own lock; an older one or a killed one did not.
  if (readDaemonPid(home) === pid) rmSync(pidFile, { force: true });
  return { stopped: true };
}

/**
 * Replace `$PI_STUDIO_HOME/daemon-keypair.json` with a new Curve25519 pair, written atomically and
 * owner-only (0600), so the file is never missing or half-written and the daemon reads the new
 * identity on its next boot. Returns true when a keypair existed before (false: none was there to
 * revoke, and a first one is now written).
 *
 * This is credential revocation, not housekeeping: a pairing link's `offer=` key IS the credential
 * for a relay-routed connection (the password is not consulted on that path), and the relay
 * rendezvous id is `deriveRelaySessionId(publicKey)` — deterministic for the life of the key. So a
 * leaked link stays valid forever until the key behind it is replaced. Rotating invalidates every
 * previously-issued pairing link/QR; all clients must re-pair (relay-e2ee.md § Pairing).
 *
 * The daemon reads the keypair once at startup, so a rotation only takes effect after a restart —
 * callers are expected to stop the daemon first (see `daemon rotate-key`).
 */
export function rotateDaemonKeypair(home: string): boolean {
  const existed = existsSync(daemonPaths(home).keypair);
  writeDaemonKeypair(home, generateDaemonKeypair());
  return existed;
}

/** Poll the health endpoint until the daemon is up or attempts are exhausted. */
export async function waitForDaemon(
  runtime: DaemonRuntime,
  host: string,
  port: number,
  opts: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<boolean> {
  const attempts = opts.attempts ?? 40;
  const delayMs = opts.delayMs ?? 150;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; i < attempts; i++) {
    if (await runtime.probe(host, port)) return true;
    await sleep(delayMs);
  }
  return false;
}
