import { SUBCOMMAND, type DaemonOpts, type RelayOpts } from "@av-pi-studio/server";

/**
 * Which program the compiled binary runs for its arguments (`swe/architecture/single-binary-daemon.md`
 * § The sub-commands). The first argument is either one of the hidden sub-commands the runtime
 * seam (`SUBCOMMAND`) emits, or the start of a normal CLI command line. Pure: `binary-main.ts` runs
 * the result.
 */
export type BinaryCommand =
  | { kind: "daemon"; opts: DaemonOpts }
  | { kind: "relay"; opts: RelayOpts }
  | { kind: "pi"; args: string[] }
  | { kind: "skills"; args: string[] }
  | { kind: "update-helper"; json: string }
  | { kind: "cli"; args: string[] };

function parseJsonObject(name: string, json: string | undefined): Record<string, unknown> {
  if (json === undefined) throw new Error(`${name}: missing JSON argument`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`${name}: the argument is not valid JSON`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${name}: the argument must be a JSON object`);
  }
  return Object.fromEntries(Object.entries(parsed));
}

function requireString(name: string, fields: Record<string, unknown>, key: string): string {
  const value = fields[key];
  if (typeof value !== "string" || value === "") {
    throw new Error(`${name}: "${key}" must be a non-empty string`);
  }
  return value;
}

function requirePort(name: string, fields: Record<string, unknown>): number {
  const port = fields.port;
  if (typeof port !== "number" || !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`${name}: "port" must be an integer from 1 to 65535`);
  }
  return port;
}

/** `__daemon`'s argument (`DaemonOpts`: `host` is absent when the daemon picks its own). */
export function parseDaemonOpts(json: string | undefined): DaemonOpts {
  const name = SUBCOMMAND.daemon;
  const fields = parseJsonObject(name, json);
  const host = fields.host;
  if (host !== undefined && typeof host !== "string") {
    throw new Error(`${name}: "host" must be a string`);
  }
  return { host, port: requirePort(name, fields), home: requireString(name, fields, "home") };
}

/** `__relay`'s argument (`RelayOpts`). */
export function parseRelayOpts(json: string | undefined): RelayOpts {
  const name = SUBCOMMAND.relay;
  const fields = parseJsonObject(name, json);
  return {
    host: requireString(name, fields, "host"),
    port: requirePort(name, fields),
    logDir: requireString(name, fields, "logDir"),
  };
}

/** Decide what to run from the arguments after the executable (`process.argv.slice(2)`). */
export function parseBinaryCommand(args: readonly string[]): BinaryCommand {
  const [first, ...rest] = args;
  switch (first) {
    case SUBCOMMAND.daemon:
      return { kind: "daemon", opts: parseDaemonOpts(rest[0]) };
    case SUBCOMMAND.relay:
      return { kind: "relay", opts: parseRelayOpts(rest[0]) };
    case SUBCOMMAND.pi:
      return { kind: "pi", args: rest };
    case SUBCOMMAND.skills:
      return { kind: "skills", args: rest };
    case SUBCOMMAND.updateHelper: {
      const json = rest[0];
      if (json === undefined) throw new Error(`${SUBCOMMAND.updateHelper}: missing JSON argument`);
      return { kind: "update-helper", json };
    }
    default:
      return { kind: "cli", args: [...args] };
  }
}
