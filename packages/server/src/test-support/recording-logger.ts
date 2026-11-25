import type { Logger } from "../logging/logger.js";

/** One line a {@link recordingLogger} received. */
export interface LogLine {
  level: string;
  msg: string;
  obj?: unknown;
}

/** A `Logger` that records every line; children log into the same list. Tests only. */
export function recordingLogger(): { logger: Logger; lines: LogLine[] } {
  const lines: LogLine[] = [];
  const record =
    (level: string) =>
    (first: unknown, second?: string): void => {
      lines.push(
        typeof first === "string"
          ? { level, msg: first }
          : { level, msg: second ?? "", obj: first },
      );
    };
  const logger: Logger = {
    trace: record("trace"),
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
    fatal: record("fatal"),
    child: () => logger,
  };
  return { logger, lines };
}
