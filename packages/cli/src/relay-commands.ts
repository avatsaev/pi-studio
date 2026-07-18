import type { Command } from "commander";

import { type CliContext, type GlobalOptions, EXIT_ERROR, EXIT_OK } from "./cli-core.js";
import { resolveHome } from "./client-id.js";
import {
  DEFAULT_RELAY_PORT,
  type RelayRuntime,
  defaultRelayRuntime,
  relayStatus,
  stopRelay,
  waitForRelay,
} from "./relay-control.js";

/**
 * `relay` command group (architecture/relay-e2ee.md § Purpose — self-hosted relay;
 * MAIN-SCOPE.md § 6 — "Relay | Remote access | WebSocket + NaCl box | Hosted or self-hosted").
 * Runs `@av-pi-studio/relay`'s standalone `startRelayServer()` as a managed local process — a
 * separate lifecycle from the daemon (`pi-studio daemon ...`): the relay has no home-directory
 * state of its own beyond its PID file, no identity keypair, and no per-project data. It exists
 * purely to bridge a daemon's outbound connection with a client's, by session id.
 */

const DEFAULT_RELAY_HOST = "0.0.0.0";

/** Resolve the effective `$PI_STUDIO_HOME` for the relay's PID file (shared with the daemon's home). */
function resolveCtxHome(ctx: CliContext, opts: GlobalOptions): string {
  return ctx.connectOverrides?.home ?? opts.home ?? resolveHome();
}

function runtimeOf(ctx: CliContext): RelayRuntime {
  return ctx.relay ?? defaultRelayRuntime();
}

/** Parse a `host:port` listen value, defaulting host/port independently when either is omitted. */
export function parseRelayListen(value: string | undefined): { host: string; port: number } {
  if (!value) return { host: DEFAULT_RELAY_HOST, port: DEFAULT_RELAY_PORT };
  const idx = value.lastIndexOf(":");
  if (idx === -1) return { host: value, port: DEFAULT_RELAY_PORT };
  const host = value.slice(0, idx) || DEFAULT_RELAY_HOST;
  const portStr = value.slice(idx + 1);
  const port = /^\d+$/.test(portStr) ? Number(portStr) : DEFAULT_RELAY_PORT;
  return { host, port };
}

/** Start the local relay if not already running, waiting for it to become healthy. Returns an exit code. */
export async function runRelayStart(
  ctx: CliContext,
  opts: GlobalOptions,
  listenArg: string | undefined,
  startOpts: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<number> {
  const { host, port } = parseRelayListen(listenArg);
  const runtime = runtimeOf(ctx);
  const home = resolveCtxHome(ctx, opts);

  const already = await relayStatus(runtime, host, port);
  if (already.up) {
    ctx.sink.write(`relay already running at ws://${host}:${port}`);
    return EXIT_OK;
  }

  try {
    await runtime.start({ home, listen: `${host}:${port}` });
  } catch (err) {
    ctx.sink.error(`failed to start relay: ${(err as Error)?.message ?? String(err)}`);
    return EXIT_ERROR;
  }

  const up = await waitForRelay(runtime, host, port, { sleep: startOpts.sleep });
  if (!up) {
    ctx.sink.error(`relay did not become healthy at ${host}:${port}`);
    return EXIT_ERROR;
  }
  ctx.sink.write(`relay listening on ws://${host}:${port} (health: http://${host}:${port}/health)`);
  return EXIT_OK;
}

export function registerRelayCommands(
  program: Command,
  ctx: CliContext,
  setExit: (code: number) => void,
): void {
  const g = (): GlobalOptions => program.opts<GlobalOptions>();
  const relay = program.command("relay").description("manage the self-hosted relay server");

  relay
    .command("start")
    .description("start a local relay server (WebSocket + NaCl box bridging)")
    .option("--listen <host:port>", `interface:port to bind (default 0.0.0.0:${DEFAULT_RELAY_PORT})`)
    .action(async (cmdOpts: { listen?: string }) => {
      setExit(await runRelayStart(ctx, g(), cmdOpts.listen));
    });

  relay
    .command("stop")
    .description("stop the local relay server")
    .action(() => {
      const stopped = stopRelay(resolveCtxHome(ctx, g()), runtimeOf(ctx));
      ctx.sink.write(stopped ? "relay stopped" : "no running relay found");
      setExit(stopped ? EXIT_OK : EXIT_ERROR);
    });

  relay
    .command("status")
    .description("report relay health")
    .option("--listen <host:port>", `interface:port to probe (default 0.0.0.0:${DEFAULT_RELAY_PORT})`)
    .action(async (cmdOpts: { listen?: string }) => {
      const { host, port } = parseRelayListen(cmdOpts.listen);
      const { up } = await relayStatus(runtimeOf(ctx), host, port);
      if (g().json) ctx.sink.write(JSON.stringify({ up, host, port }));
      else ctx.sink.write(`relay ${up ? "up" : "down"} at ${host}:${port}`);
      setExit(up ? EXIT_OK : EXIT_ERROR);
    });
}
