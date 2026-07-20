/**
 * Operational logging for the self-hosted relay server. Node-only (imports `node:fs`,
 * `rotating-file-stream`) — imported only from `relay-server.ts`/`relay-main.ts`, which live
 * behind the `"./server"` package export subpath, so it never reaches a browser bundle that
 * transitively imports this package's main barrel.
 *
 * Mirrors the daemon's logging stack (`packages/server/src/logging/logger.ts`): pino everywhere,
 * pretty/colorized on a TTY, structured NDJSON otherwise. Differences, intentional for a small
 * stateless edge process:
 *
 * - **stdout is ALWAYS written** (container/PM2/journald-friendly — `docker logs` just works);
 *   a rotating file under `logDir` is ADDITIONALLY written when configured, via pino multistream.
 * - No worker-thread transport: `pino-pretty` is used as a direct sonic-boom-compatible stream,
 *   same rationale as the daemon (Vitest-friendliness, no shutdown latency).
 *
 * Logs metadata only (connection ids, remote addresses, session ids, frame sizes, durations) —
 * never relayed payloads, which the relay structurally cannot read anyway.
 */
import { mkdirSync } from "node:fs";
import { pino, multistream, type Logger as PinoLogger } from "pino";
import pinoPretty from "pino-pretty";
import { createStream as createRotatingStream } from "rotating-file-stream";

export type RelayLogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "silent";

/** The structural logger the relay passes around (pino-shaped, console-compatible subset). */
export type RelayLogger = Pick<
  PinoLogger,
  "trace" | "debug" | "info" | "warn" | "error" | "fatal"
>;

export interface CreateRelayLoggerOptions {
  /** Defaults to `PI_STUDIO_RELAY_LOG_LEVEL`, then "info". */
  level?: RelayLogLevel;
  /** Force pretty output on/off; defaults to stdout TTY detection. */
  pretty?: boolean;
  /**
   * Additionally write structured NDJSON to a rotating file in this directory (stdout keeps
   * receiving logs too). Defaults to `PI_STUDIO_RELAY_LOG_DIR` (unset = stdout only).
   */
  logDir?: string;
  /** Rotating-file size threshold (default "10M"). */
  rotateSize?: string;
  /** Rotating-file retention count (default 5). */
  rotateMaxFiles?: number;
  /** Override the stdout stream (tests). Defaults to `process.stdout`. */
  stdoutStream?: NodeJS.WritableStream;
}

const LEVELS = new Set(["trace", "debug", "info", "warn", "error", "fatal", "silent"]);

function resolveLevel(level?: string): RelayLogLevel {
  const raw = (level ?? process.env.PI_STUDIO_RELAY_LOG_LEVEL ?? "info").toLowerCase();
  return (LEVELS.has(raw) ? raw : "info") as RelayLogLevel;
}

/** Build the relay logger. Pure/synchronous; safe to call in tests. */
export function createRelayLogger(options: CreateRelayLoggerOptions = {}): RelayLogger {
  const level = resolveLevel(options.level);
  if (level === "silent") return pino({ level: "silent" });

  const base = { name: "pi-studio-relay" };
  const streams: Array<{ stream: NodeJS.WritableStream }> = [];

  // stdout: pretty on a TTY, raw NDJSON otherwise (docker logs / journald / PM2).
  const pretty = options.pretty ?? Boolean(process.stdout.isTTY);
  streams.push({
    stream: pretty
      ? pinoPretty({ colorize: true, translateTime: "SYS:HH:MM:ss.l", ignore: "pid,hostname" })
      : (options.stdoutStream ?? process.stdout),
  });

  // Optional rotating file — in addition to stdout, never instead of it.
  const logDir = options.logDir ?? process.env.PI_STUDIO_RELAY_LOG_DIR;
  if (logDir) {
    mkdirSync(logDir, { recursive: true });
    streams.push({
      stream: createRotatingStream("pi-studio-relay.log", {
        path: logDir,
        size: options.rotateSize ?? "10M",
        maxFiles: options.rotateMaxFiles ?? 5,
      }),
    });
  }

  return pino({ level, base }, multistream(streams));
}
