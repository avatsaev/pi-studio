import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";

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

export const bcryptHasher: PasswordHasher = (plaintext) => bcrypt.hashSync(plaintext, 10);

export const signalKiller: ProcessKiller = (pid, signal = "SIGTERM") => {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
};

/**
 * Default daemon starter: spawn a detached Node process that boots the real daemon via
 * `@av-pi-studio/server`'s `startDaemon()`. Resolves once the process is spawned (health is then
 * polled by the caller).
 *
 * The server module is resolved to an absolute file URL *here*, inside `@av-pi-studio/cli`'s own
 * module graph, and that resolved URL — not the bare `"@av-pi-studio/server"` specifier — is
 * baked into the spawned `-e` script. A detached `node -e <code>` child has no package/module
 * context of its own, so a bare-specifier `import()` inside it can fail to resolve `server` even
 * when it's correctly installed, if npm's install topology nested it under `cli`'s own
 * `node_modules` rather than hoisting it to a shared root (observed in a real global install).
 */
export const subprocessStarter: DaemonStarter = ({ home, listen, piHome }) =>
  new Promise<number>((resolve, reject) => {
    const [host, portStr] = listen.split(":");
    const port = Number(portStr);
    let serverUrl: string;
    try {
      serverUrl = import.meta.resolve("@av-pi-studio/server");
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    // `onFatalError` is the process-level half of `startDaemon`'s fatal-error contract: the
    // bootstrap logs the bind failure and tears down the WS server but never exits on its own, so
    // without this the detached child would linger with a dead HTTP server after an EADDRINUSE.
    const code = `import(${JSON.stringify(
      serverUrl,
    )}).then(m=>m.startDaemon({host:${JSON.stringify(host)},port:${JSON.stringify(
      port,
    )},home:${JSON.stringify(home)},onFatalError:()=>process.exit(1)}))`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
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
 * on its next (re)start. Preserves existing config; creates the file/home if missing.
 */
export function setDaemonPassword(home: string, plaintext: string, runtime: DaemonRuntime): void {
  const path = daemonPaths(home).config;
  let config: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      config = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch {
      config = {};
    }
  }
  const daemon = (config.daemon as Record<string, unknown> | undefined) ?? {};
  const auth = (daemon.auth as Record<string, unknown> | undefined) ?? {};
  auth.password = runtime.hash(plaintext);
  daemon.auth = auth;
  config.daemon = daemon;
  if (config.version === undefined) config.version = 1;

  writeConfigFile(home, path, config);
}

/**
 * Persist `config.json` owner-only (0600): it can carry the daemon password hash. `mode` only
 * applies on creation, so an explicit chmod re-tightens files written before this was enforced.
 */
function writeConfigFile(home: string, path: string, config: Record<string, unknown>): void {
  mkdirSync(home, { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* best-effort */
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

  const path = daemonPaths(home).config;
  let config: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      config = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch {
      config = {};
    }
  }
  const daemon = (config.daemon as Record<string, unknown> | undefined) ?? {};
  const relay = (daemon.relay as Record<string, unknown> | undefined) ?? {};

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
  config.daemon = daemon;
  if (config.version === undefined) config.version = 1;

  writeConfigFile(home, path, config);
}

/** Stop the local daemon by signaling its recorded pid. Returns false when no daemon was found. */
export function stopDaemon(home: string, runtime: DaemonRuntime): boolean {
  const pid = readDaemonPid(home);
  if (pid === null) return false;
  return runtime.kill(pid);
}

/**
 * Delete `$PI_STUDIO_HOME/daemon-keypair.json` so the daemon mints a fresh Curve25519 identity on
 * its next boot (`packages/server/src/daemon/bootstrap.ts#resolveDaemonKeypair` regenerates when the
 * file is missing/unreadable). Returns true when a keypair was actually removed.
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
  const path = daemonPaths(home).keypair;
  if (!existsSync(path)) return false;
  rmSync(path, { force: true });
  return true;
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
