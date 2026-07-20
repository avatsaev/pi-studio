import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { pino, multistream } from "pino";
// `pino-pretty` is usable directly as a sonic-boom-compatible stream, which avoids spawning a
// transport worker thread (worker threads are awkward under Vitest and add shutdown latency).
import pinoPretty from "pino-pretty";
import { createStream as createRotatingStream } from "rotating-file-stream";

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
  const streams: Array<{ stream: NodeJS.WritableStream }> = [];
  const pretty = options.pretty ?? Boolean(process.stdout.isTTY);
  streams.push({
    stream: pretty
      ? pinoPretty({
          colorize: true,
          translateTime: "SYS:HH:MM:ss.l",
          ignore: "pid,hostname",
        })
      : (options.stdoutStream ?? process.stdout),
  });

  // Optional rotating file — in addition to stdout, never instead of it.
  if (options.logDir) {
    mkdirSync(options.logDir, { recursive: true });
    streams.push({
      stream: createRotatingStream("pi-studio.log", {
        size: options.rotateSize ?? "10M",
        maxFiles: options.rotateMaxFiles ?? 5,
        path: options.logDir,
      }),
    });
  }

  return pino(base, multistream(streams)) as unknown as Logger;
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
