// Daemon bootstrap public surface.
// Minimal clean-room scaffold used by the package root export and bin entrypoints.

export const DEFAULT_DAEMON_LISTEN = "127.0.0.1:6767" as const;

export type DaemonListenAddress = {
  host: string;
  port: number;
};

export function parseDaemonListen(value: string = DEFAULT_DAEMON_LISTEN): DaemonListenAddress {
  const idx = value.lastIndexOf(":");
  if (idx <= 0) throw new Error(`Invalid listen address: ${value}`);
  const host = value.slice(0, idx);
  const port = Number(value.slice(idx + 1));
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid listen port: ${value}`);
  }
  return { host, port };
}

export type DaemonRuntimeInfo = {
  listen: DaemonListenAddress;
  mode: "production" | "development";
};

export function createDaemonRuntimeInfo(
  input: { listen?: string; mode?: "production" | "development" } = {},
): DaemonRuntimeInfo {
  return {
    listen: parseDaemonListen(
      input.listen ?? process.env.PI_STUDIO_LISTEN ?? DEFAULT_DAEMON_LISTEN,
    ),
    mode: input.mode ?? "production",
  };
}

// Production daemon bootstrap: startDaemon(), DaemonOptions, DaemonHandle, wrapSessionEnvelope().
export * from "./bootstrap.js";

// Dev daemon bootstrap (mock provider, in-memory): reachable from outside the package so
// cross-package E2E (e.g. packages/cli's extension-UI SDK test, sprint-067/task-004) can host a
// real dev daemon without a second, duplicated bootstrap.
export * from "./dev-bootstrap.js";
