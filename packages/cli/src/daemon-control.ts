import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { pid?: number };
    return typeof parsed.pid === "number" ? parsed.pid : null;
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
export type DaemonStarter = (opts: { home: string; listen: string }) => Promise<number>;

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
 */
export const subprocessStarter: DaemonStarter = ({ home, listen }) =>
  new Promise<number>((resolve, reject) => {
    const [host, portStr] = listen.split(":");
    const port = Number(portStr);
    const code = `import('@av-pi-studio/server').then(m=>m.startDaemon({host:${JSON.stringify(
      host,
    )},port:${JSON.stringify(port)},home:${JSON.stringify(home)}}))`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, PI_STUDIO_HOME: home, PI_STUDIO_LISTEN: listen },
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

  mkdirSync(home, { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

/** Stop the local daemon by signaling its recorded pid. Returns false when no daemon was found. */
export function stopDaemon(home: string, runtime: DaemonRuntime): boolean {
  const pid = readDaemonPid(home);
  if (pid === null) return false;
  return runtime.kill(pid);
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
