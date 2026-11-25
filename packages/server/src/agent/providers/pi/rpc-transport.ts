import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import treeKill from "tree-kill";
import which from "which";

import { expandHome } from "../../../files/resolve-path.js";

import type { Unsubscribe } from "../../provider-contract.js";

/**
 * Transport abstraction over a `pi --mode rpc` process (Pi RPC protocol, docs/rpc.md). The concrete
 * implementation spawns the process; tests inject a fake.
 *
 * Wire shape: commands are JSON lines `{type, ...fields, id?}`; the matching reply is
 * `{type:"response", command, success, id?, data?, error?}`; everything else is a streamed event.
 */

export interface PiTransportSpawnArgs {
  /** Full argv (`command[0]` is the binary). */
  args: string[];
  cwd: string;
  env: Record<string, string>;
  /** Pi JSONL session file for resume/import (becomes the `nativeHandle`). */
  sessionFile?: string;
  /** Operational logger: process spawned (info), spawn failure / abnormal exit (error), clean exit (info). */
  logger?: Pick<Console, "info" | "warn" | "error">;
}

export interface PiRpcTransport {
  /** Send a command and await its correlated `{type:"response"}`. Resolves with `data` (or rejects). */
  request(command: string, params?: Record<string, unknown>): Promise<unknown>;
  /** Fire-and-forget command (no response awaited), e.g. `prompt`, `abort`. */
  notify(command: string, params?: Record<string, unknown>): void;
  /** Subscribe to streamed events (any non-`response` line). */
  onEvent(cb: (event: unknown) => void): Unsubscribe;
  close(): Promise<void>;
}

export type PiTransportFactory = (spawnArgs: PiTransportSpawnArgs) => PiRpcTransport;

/** Returns true if `bin` resolves to an executable (absolute/relative path or on `$PATH`). */
export function resolveBinaryOnPath(
  bin: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (bin.includes("/") || bin.includes("\\")) return existsSync(bin);
  return which.sync(bin, { nothrow: true, path: env.PATH ?? env.Path }) !== null;
}

/** Expand a leading `~` / `~/` to the user's home directory (clients sometimes send a literal `~`).
 *  Re-exported from `files/resolve-path.ts`, the package's single implementation, so existing
 *  imports of `expandHome` from this module (via `agent/index.ts`'s barrel) keep working. */
export { expandHome };

/**
 * Candidate CLI entrypoints inside the `@earendil-works/pi-coding-agent` package, relative to its
 * root, tried in order when the package's own `bin.pi` cannot be read. `dist/bundle/cli.js` is the
 * prebundled entry Pi declares as `bin` since 0.84.4; `dist/cli.js` is the unbundled entry it
 * declared through 0.84.3 and still ships. Both start the same program.
 */
const PI_CLI_FALLBACKS = [join("dist", "bundle", "cli.js"), join("dist", "cli.js")];

/**
 * Resolve the `pi` CLI entrypoint inside an already-located package root, preferring whatever the
 * package's own `package.json` declares as `bin.pi`.
 *
 * Reading the declared `bin` rather than hardcoding a path is deliberate: Pi moved it from
 * `dist/cli.js` to `dist/bundle/cli.js` in 0.84.4, and the dependency range intentionally accepts
 * future minor releases (`>=0.85.1 <1.0.0`), so a relocation must not silently fall back to a
 * global `pi` — or to an entry upstream has stopped shipping.
 */
function resolvePiCliInPackage(root: string): string | null {
  try {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      bin?: string | Record<string, string>;
    };
    const declared = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.pi;
    if (declared) {
      const cli = join(root, declared);
      if (existsSync(cli)) return cli;
    }
  } catch {
    // Unreadable/malformed manifest — fall through to the known entrypoints.
  }
  for (const rel of PI_CLI_FALLBACKS) {
    const cli = join(root, rel);
    if (existsSync(cli)) return cli;
  }
  return null;
}

/**
 * Resolve the `pi` CLI **bundled inside the `@earendil-works/pi-coding-agent` dependency**. This is
 * what lets pi-studio run the agent without a separate global `pi` install. Returns `null` if the
 * package isn't present.
 *
 * Note: `import.meta.resolve` is used (not `require.resolve`) because the package's `exports` map
 * only defines the `import` condition, so CJS resolution throws `ERR_PACKAGE_PATH_NOT_EXPORTED`.
 */
export function resolveBundledPiCli(): string | null {
  // 1) ESM resolution — works in the compiled daemon (real `node` ESM). Resolves the package's
  //    `main` (`dist/index.js`); its package root is the parent of that `dist` directory.
  try {
    const indexPath = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
    const cli = resolvePiCliInPackage(dirname(dirname(indexPath)));
    if (cli) return cli;
  } catch {
    // `import.meta.resolve` is unavailable under some loaders (e.g. vitest); fall through.
  }
  // 2) Walk up from cwd looking for the dependency in node_modules (loader-independent).
  const rel = join("node_modules", "@earendil-works", "pi-coding-agent");
  let dir = process.cwd();
  for (;;) {
    const cli = resolvePiCliInPackage(join(dir, rel));
    if (cli) return cli;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** What a rejected request and the `error` stream event say when the Pi process is gone: the exit
 *  status, then whatever Pi wrote to stderr (a failing extension is named there). */
function exitMessage(code: number | null, signal: string | null, stderr: string): string {
  return (
    `pi process exited (code ${code ?? "null"}${signal ? `, ${signal}` : ""})` +
    (stderr ? `: ${stderr}` : "")
  );
}

/** A request Pi does not answer within this long is rejected (the process is left running). */
export const PI_REQUEST_TIMEOUT_MS = 60_000;
/**
 * Longer bound for the commands that legitimately run for minutes: `compact` (an LLM summarisation;
 * the SDK's `COMPACT_TIMEOUT_MS` is the same 10 minutes) and a correlated `prompt` (Pi acks a
 * slash command only after an extension command ran inline, which may wait on a dialog).
 */
export const PI_LONG_REQUEST_TIMEOUT_MS = 10 * 60_000;
/** How long `close()` waits after SIGTERM before it SIGKILLs a process that has not exited. */
export const PI_KILL_GRACE_MS = 5_000;

const LONG_REQUESTS: Readonly<Record<string, true>> = { compact: true, prompt: true };

/** Timing knobs of the process transport; tests shorten them. */
export interface ProcessTransportOptions {
  requestTimeoutMs?: number;
  longRequestTimeoutMs?: number;
  killGraceMs?: number;
}

/**
 * Default transport: spawn `pi --mode rpc` and frame JSON commands/events over stdio per the Pi RPC
 * protocol. Framing is strict JSONL: split on `\n` only, strip an optional trailing `\r`. (Node's
 * `readline` is intentionally avoided — it also splits on U+2028/U+2029, which are valid inside JSON
 * strings and would corrupt records.)
 */
export function createProcessTransport(
  spawnArgs: PiTransportSpawnArgs,
  options: ProcessTransportOptions = {},
): PiRpcTransport {
  const requestTimeoutMs = options.requestTimeoutMs ?? PI_REQUEST_TIMEOUT_MS;
  const longRequestTimeoutMs = options.longRequestTimeoutMs ?? PI_LONG_REQUEST_TIMEOUT_MS;
  const killGraceMs = options.killGraceMs ?? PI_KILL_GRACE_MS;
  const [command, ...rest] = spawnArgs.args;
  const child = spawn(command as string, rest, {
    cwd: expandHome(spawnArgs.cwd),
    env: { ...process.env, ...spawnArgs.env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  // Decode as UTF-8 across chunk boundaries (a multibyte character may be split between two reads).
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");

  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const eventCbs = new Set<(event: unknown) => void>();
  let nextId = 0;
  /** Set once the process fails to spawn or exits abnormally; all further calls reject with it. */
  let failure: Error | null = null;
  /** Set by `close()`: the exit that follows is requested, not a failure. */
  let closing = false;
  let closePromise: Promise<void> | null = null;
  /** Set once the process has exited or failed to spawn: there is nothing left to stop. */
  let exited = false;
  const { promise: exitPromise, resolve: markExited } = Promise.withResolvers<void>();

  const log = spawnArgs.logger;
  log?.info({ pid: child.pid, command, cwd: spawnArgs.cwd }, "pi process spawned");

  // Capture stderr so a crashing `pi` process is diagnosable — the JSONL protocol lives on
  // stdout only, so anything on stderr is either a startup crash, an uncaught exception, or a
  // warning the CLI printed directly. Kept as a small ring buffer (last 16 KiB) so a runaway
  // process can't grow this unbounded; logged in full on any non-zero/signal exit.
  let stderrTail = "";
  const STDERR_TAIL_MAX = 16 * 1024;
  child.stderr?.on("data", (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_MAX);
  });

  const failPending = (error: Error): void => {
    failure = error;
    for (const [, p] of pending) p.reject(error);
    pending.clear();
  };

  const failAll = (error: Error): void => {
    failPending(error);
    // Surface as a stream event so the session learns the process is gone (`error` frame).
    for (const cb of eventCbs) cb({ type: "error", error: error.message });
  };

  // CRITICAL: a missing binary emits an async 'error' event. Without this listener Node rethrows it
  // as an unhandled error and crashes the whole daemon. Convert it into a clean operation failure.
  child.on("error", (err: Error) => {
    const failureError = err.message.includes("ENOENT")
      ? new Error(
          `failed to spawn '${command as string}': not found on PATH. Install the Pi CLI or use the mock provider.`,
        )
      : err;
    log?.error({ pid: child.pid, command, err: failureError.message }, "pi process spawn failed");
    failAll(failureError);
    exited = true;
    markExited();
  });
  child.on("exit", (code, signal) => {
    exited = true;
    markExited();
    const trimmedStderr = stderrTail.trim();
    // An exit that `close()` asked for is routine whatever its status (SIGTERM gives 143).
    const clean = closing || (code === 0 && signal === null);
    if (pending.size > 0) {
      log?.error(
        {
          pid: child.pid,
          code: code ?? undefined,
          signal: signal ?? undefined,
          pendingCommands: pending.size,
          ...(trimmedStderr ? { stderr: trimmedStderr } : {}),
        },
        "pi process exited with commands in flight",
      );
    } else if (!clean) {
      log?.error(
        {
          pid: child.pid,
          code: code ?? undefined,
          signal: signal ?? undefined,
          ...(trimmedStderr ? { stderr: trimmedStderr } : {}),
        },
        "pi process exited non-zero",
      );
    } else {
      log?.info(
        { pid: child.pid, code: code ?? undefined, signal: signal ?? undefined },
        "pi process exited",
      );
    }
    // Whatever the status, a process that ends without `close()` asking for it is gone for good:
    // nothing will answer a request and no terminal event will follow a turn's `prompt` (a notify,
    // so nothing is pending during a turn). Failing the transport hands the status and stderr to
    // the session. That covers a signal (`code` null: the OOM killer's SIGKILL) and an exit 0 nobody
    // asked for. A requested exit only rejects what was still waiting.
    const error = new Error(exitMessage(code, signal, trimmedStderr));
    if (closing) failPending(error);
    else failAll(error);
  });
  child.stdin?.on("error", () => {
    // Broken pipe after the process died; the exit/error handler already reports it.
  });

  const writeStdin = (payload: string): boolean => {
    if (failure || !child.stdin || child.stdin.destroyed) return false;
    try {
      child.stdin.write(payload);
      return true;
    } catch {
      return false;
    }
  };

  // Strict JSONL reader: split on \n only, strip a trailing \r.
  let buffer = "";
  const handleLine = (line: string): void => {
    const text = (line.endsWith("\r") ? line.slice(0, -1) : line).trim();
    if (!text) return;
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    const record = msg as Record<string, unknown>;
    if (record.type === "response") {
      const id = record.id === undefined ? undefined : String(record.id);
      if (id && pending.has(id)) {
        const p = pending.get(id);
        pending.delete(id);
        if (record.success === false)
          p?.reject(new Error(String(record.error ?? "command failed")));
        else p?.resolve(record.data ?? record);
      }
      return;
    }
    for (const cb of eventCbs) cb(msg);
  };
  child.stdout?.on("data", (chunk: string) => {
    buffer += chunk;
    let nl = buffer.indexOf("\n");
    while (nl !== -1) {
      handleLine(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf("\n");
    }
  });

  return {
    request(commandType, params = {}) {
      const id = `c${nextId++}`;
      return new Promise<unknown>((resolve, reject) => {
        if (failure) {
          reject(failure);
          return;
        }
        const timeoutMs = LONG_REQUESTS[commandType] ? longRequestTimeoutMs : requestTimeoutMs;
        const timer = setTimeout(() => {
          pending.delete(id);
          log?.warn(
            { pid: child.pid, command: commandType, timeoutMs },
            "pi request timed out; the process is left running",
          );
          reject(new Error(`pi request '${commandType}' timed out after ${timeoutMs} ms`));
        }, timeoutMs);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        if (!writeStdin(`${JSON.stringify({ type: commandType, ...params, id })}\n`)) {
          pending.delete(id);
          clearTimeout(timer);
          reject(failure ?? new Error("pi transport is not writable"));
        }
      });
    },
    notify(commandType, params = {}) {
      writeStdin(`${JSON.stringify({ type: commandType, ...params })}\n`);
    },
    onEvent(cb) {
      eventCbs.add(cb);
      return () => eventCbs.delete(cb);
    },
    close() {
      if (closePromise) return closePromise;
      closing = true;
      failPending(new Error("pi transport closed"));
      if (exited) return (closePromise = Promise.resolve());
      // Kill the whole `pi` process tree so any helpers it spawned don't linger; a process that has
      // not exited by the end of the grace period is SIGKILLed. Resolves once the process is gone.
      const killTimer = setTimeout(() => {
        if (exited) return;
        log?.warn({ pid: child.pid, killGraceMs }, "pi process ignored SIGTERM; sending SIGKILL");
        if (child.pid !== undefined) {
          treeKill(child.pid, "SIGKILL", () => {
            // best-effort
          });
        }
        child.kill("SIGKILL");
      }, killGraceMs);
      closePromise = exitPromise.then(() => clearTimeout(killTimer));
      if (child.pid !== undefined) {
        treeKill(child.pid, "SIGTERM", () => {
          // best-effort
        });
      }
      child.kill();
      return closePromise;
    },
  };
}
