import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Writable } from "node:stream";

import { pino, multistream } from "pino";
// `pino-pretty` is usable directly as a sonic-boom-compatible stream, which avoids spawning a
// transport worker thread (worker threads are awkward under Vitest and add shutdown latency).
import pinoPretty from "pino-pretty";
import { createStream as createRotatingStream } from "rotating-file-stream";

import type { LogTap } from "./log-tap.js";

/**
 * Daemon logging (operational concern; adopted from the reference daemon's `pino` stack). The rest
 * of the codebase injects a `Pick<Console, "info" | "warn" | "error">`-shaped logger; a pino logger
 * satisfies that shape, so existing call sites keep working while gaining levels + structure.
 *
 * - **stdout is ALWAYS written** (pretty/colorized on a TTY, raw NDJSON otherwise) — so
 *   `docker logs`, journald, and PM2 see the daemon's lifecycle with zero configuration.
 * - With a log dir (the production daemon's `$PI_STUDIO_HOME/logs/`): structured NDJSON is
 *   ADDITIONALLY written to a rotating file — both destinations, never either/or.
 * - `pino-pretty` is used directly as a sonic-boom-compatible stream, which avoids spawning a
 *   transport worker thread (worker threads are awkward under Vitest and add shutdown latency).
 */

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "silent";

/** The structural logger the daemon passes around. A pino `Logger` is assignable to this. */
export interface Logger {
  trace(obj: unknown, msg?: string): void;
  trace(msg: string): void;
  debug(obj: unknown, msg?: string): void;
  debug(msg: string): void;
  info(obj: unknown, msg?: string): void;
  info(msg: string): void;
  warn(obj: unknown, msg?: string): void;
  warn(msg: string): void;
  error(obj: unknown, msg?: string): void;
  error(msg: string): void;
  fatal(obj: unknown, msg?: string): void;
  fatal(msg: string): void;
  child(bindings: Record<string, unknown>): Logger;
}

export interface CreateLoggerOptions {
  level?: LogLevel;
  /** Pretty, colorized output (default: true when stdout is a TTY). */
  pretty?: boolean;
  /** Write structured NDJSON to a rotating file in this directory instead of stdout. */
  logDir?: string;
  /** Rotating-file size threshold (default "10M"). */
  rotateSize?: string;
  /** Rotating-file retained count (default 5). */
  rotateMaxFiles?: number;
  /** Base bindings attached to every line (e.g. `{ name: "pi-studio" }`). */
  bindings?: Record<string, unknown>;
  /** Override the stdout stream (tests). Defaults to `process.stdout`. */
  stdoutStream?: NodeJS.WritableStream;
  /**
   * Mirror every written line into a `LogTap` (live log streaming). Adds ONE extra multistream
   * entry at the resolved level; stdout/file entries are untouched. Ignored when silent.
   */
  tap?: LogTap;
}

function resolveLevel(level: LogLevel | undefined): LogLevel {
  if (level) return level;
  const fromEnv = process.env.PI_STUDIO_LOG_LEVEL as LogLevel | undefined;
  return fromEnv ?? "info";
}

/** Build a pino logger per the options. Pure/synchronous; safe to call in tests. */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const level = resolveLevel(options.level);
  const base = { level, base: options.bindings ?? undefined };

  if (level === "silent") return pino({ ...base, level: "silent" }) as unknown as Logger;

  // stdout: pretty on a TTY, raw NDJSON otherwise (docker logs / journald / PM2).
  // Each stream entry needs its OWN `level` — pino's `multistream()` defaults an entry's level
  // to "info" when omitted, silently discarding debug/trace records at the multistream dispatch
  // step even though `logger.level` itself (and thus `logger.debug()`'s enabled check) is lower.
  const streams: Array<{ stream: NodeJS.WritableStream; level: LogLevel }> = [];
  const pretty = options.pretty ?? Boolean(process.stdout.isTTY);
  streams.push({
    level,
    stream: pretty
      ? pinoPretty({
          colorize: true,
          translateTime: "SYS:HH:MM:ss.l",
          ignore: "pid,hostname",
        })
      : (options.stdoutStream ?? process.stdout),
  });

  // Optional rotating file — in addition to stdout, never instead of it.
  let fileStream: Writable | undefined;
  if (options.logDir) {
    mkdirSync(options.logDir, { recursive: true });
    fileStream = createRotatingStream("pi-studio.log", {
      size: options.rotateSize ?? "10M",
      maxFiles: options.rotateMaxFiles ?? 5,
      path: options.logDir,
    });
    streams.push({ level, stream: fileStream });
  }

  if (options.tap) {
    options.tap.attach(level);
    streams.push({ level, stream: options.tap.stream });
  }

  const logger = pino(base, multistream(streams)) as unknown as Logger;
  if (fileStream) logFiles.set(logger, fileStream);
  return logger;
}

/** The rotating file each logger from {@link createLogger} writes to (root loggers only). */
const logFiles = new WeakMap<Logger, Writable>();

/**
 * Resolves once every line logged so far through `logger` has been handed to its log file. The file
 * stream writes asynchronously, so a process that exits right after logging (a fatal error) would
 * lose the line without this. Resolves at once for a logger without a file (silent, stdout-only, or
 * injected) and never rejects. Pass the logger `createLogger` returned, not a `child` of it.
 */
export function flushLogger(logger: Logger): Promise<void> {
  const file = logFiles.get(logger);
  if (file === undefined || file.destroyed) return Promise.resolve();
  // Writes complete in order, so the callback of an empty one fires after every earlier line.
  const { promise, resolve } = Promise.withResolvers<void>();
  file.write("", () => resolve());
  return promise;
}

/**
 * Daemon logger: stdout always, plus rotating NDJSON under `<home>/logs/` when a home dir is
 * given (the long-running daemon). `createDaemonLogger(undefined)` is the stdout-only dev logger.
 */
export function createDaemonLogger(
  home: string | undefined,
  options: CreateLoggerOptions = {},
): Logger {
  if (home) return createLogger({ ...options, logDir: options.logDir ?? join(home, "logs") });
  return createLogger(options);
}

/** A no-op logger for tests / opt-out paths. */
export function silentLogger(): Logger {
  return createLogger({ level: "silent" });
}
