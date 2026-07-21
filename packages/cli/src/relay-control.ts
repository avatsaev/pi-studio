import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";

/**
 * Local relay-server process control (architecture/relay-e2ee.md § Purpose — self-hosted relay;
 * MAIN-SCOPE.md § 6 — "Relay | Remote access | WebSocket + NaCl box | Hosted or self-hosted").
 * Mirrors `daemon-control.ts`'s shape exactly (PID file under `$PI_STUDIO_HOME`, injectable
 * health-probe/spawn/kill side-effects) so `pi-studio relay start|stop|status` behaves like
 * `pi-studio daemon start|stop|status` — a separate long-lived process the CLI can manage, not
 * something bundled into the daemon's own lifecycle.
 */

export const RELAY_PID_FILE = "pi-studio-relay.pid";
export const RELAY_HEALTH_PATH = "/health";
export const DEFAULT_RELAY_PORT = 7000;

/** Read the recorded relay pid (or null when no live lock file). */
export function readRelayPid(home: string): number | null {
  const path = join(home, RELAY_PID_FILE);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8").trim();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function writeRelayPid(home: string, pid: number): void {
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, RELAY_PID_FILE), String(pid), "utf8");
}

// ─── Injectable side-effects (mirrors DaemonRuntime) ──────────────────────────────

export type RelayHealthProbe = (host: string, port: number) => Promise<boolean>;
export type RelayProcessKiller = (pid: number, signal?: NodeJS.Signals) => boolean;
export type RelayStarter = (opts: { home: string; listen: string }) => Promise<number>;

export interface RelayRuntime {
  probe: RelayHealthProbe;
  kill: RelayProcessKiller;
  start: RelayStarter;
}

/** Default health probe via node:http GET /health (200 ⇒ up). */
export const httpRelayHealthProbe: RelayHealthProbe = (host, port) =>
  new Promise<boolean>((resolve) => {
    const req = request({ host, port, path: RELAY_HEALTH_PATH, method: "GET", timeout: 1500 }, (res) => {
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

export const relaySignalKiller: RelayProcessKiller = (pid, signal = "SIGTERM") => {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
};

/**
 * Default relay starter: spawn a detached Node process running `@av-pi-studio/relay`'s
 * `startRelayServer()` (via the Node-only `@av-pi-studio/relay/server` subpath — the package's
 * main entry is deliberately browser-safe and does not export it), writing its pid to
 * `$PI_STUDIO_HOME/pi-studio-relay.pid`. Mirrors `subprocessStarter` in `daemon-control.ts` exactly
 * — resolve the module's absolute URL *inside* the CLI's own module graph first, then bake that
 * resolved URL (not the bare specifier) into the spawned `-e` script, since a detached child has
 * no module context of its own.
 */
export const subprocessRelayStarter: RelayStarter = ({ home, listen }) =>
  new Promise<number>((resolve, reject) => {
    let relayUrl: string;
    try {
      relayUrl = import.meta.resolve("@av-pi-studio/relay/server");
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    const idx = listen.lastIndexOf(":");
    const host = listen.slice(0, idx);
    const port = Number(listen.slice(idx + 1));
    // stdio is "ignore" (detached child), so operational logs go to a rotating file under
    // `$PI_STUDIO_HOME/logs/` — same destination pattern as the daemon's own file logging.
    const logDir = join(home, "logs");
    const code = `import(${JSON.stringify(
      relayUrl,
    )}).then(m=>m.startRelayServer({host:${JSON.stringify(host)},port:${JSON.stringify(port)},logger:m.createRelayLogger({logDir:${JSON.stringify(logDir)}})}))`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", reject);
    if (child.pid === undefined) {
      reject(new Error("failed to spawn relay process"));
      return;
    }
    child.unref();
    writeRelayPid(home, child.pid);
    resolve(child.pid);
  });

export function defaultRelayRuntime(): RelayRuntime {
  return {
    probe: httpRelayHealthProbe,
    kill: relaySignalKiller,
    start: subprocessRelayStarter,
  };
}

// ─── Operations ────────────────────────────────────────────────────────────────────

/** Report whether the relay at the given host:port is reachable. */
export async function relayStatus(
  runtime: RelayRuntime,
  host: string,
  port: number,
): Promise<{ up: boolean; host: string; port: number }> {
  const up = await runtime.probe(host, port);
  return { up, host, port };
}

/** Stop the local relay by signaling its recorded pid. Returns false when no relay was found. */
export function stopRelay(home: string, runtime: RelayRuntime): boolean {
  const pid = readRelayPid(home);
  if (pid === null) return false;
  return runtime.kill(pid);
}

/** Poll the health endpoint until the relay is up or attempts are exhausted. */
export async function waitForRelay(
  runtime: RelayRuntime,
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
