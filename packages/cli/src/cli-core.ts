import { DaemonClient, RpcError, RpcTimeoutError } from "@av-pi-studio/client";

import { type ConnectOptions, connectDaemon } from "./connection.js";
import type { DaemonRuntime } from "./daemon-control.js";
import type { RelayRuntime } from "./relay-control.js";
import { type OutputFormat, type OutputSink, consoleSink, renderJson } from "./output.js";

/**
 * CLI core (features/cli.md § Behavior — main): connect a `DaemonClient`, dispatch a subcommand to
 * one or more WS RPCs, render output, and produce an exit code. The Commander program (program.ts)
 * is a thin shell over these helpers; tests drive the helpers directly with an injected transport.
 */

/** Process exit codes. */
export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_CONNECTION = 2;

/** Global options shared by every command, parsed from the root Commander program. */
export interface GlobalOptions {
  host?: string;
  password?: string;
  json?: boolean;
  home?: string;
}

/** Injectable runtime context (production defaults; tests override transport/sink/clientId). */
export interface CliContext {
  /** Connect a daemon client for the given global options. */
  connect(opts: ConnectOptions): ReturnType<typeof connectDaemon>;
  /** Output sink (stdout/stderr). */
  sink: OutputSink;
  /** Default RPC timeout (ms). */
  rpcTimeoutMs?: number;
  /** Test hooks injected into the connection (transport / fixed clientId). */
  connectOverrides?: Pick<ConnectOptions, "transport" | "clientId" | "home">;
  /** Local daemon control runtime (process/network side-effects); tests inject fakes. */
  daemon?: DaemonRuntime;
  /** Local relay-server control runtime (process/network side-effects); tests inject fakes. */
  relay?: RelayRuntime;
}

/** Default production context. */
export function defaultContext(): CliContext {
  return {
    connect: (opts) => connectDaemon(opts),
    sink: consoleSink,
  };
}

/** Resolve the output format from global options. */
export function formatOf(opts: GlobalOptions): OutputFormat {
  return opts.json ? "json" : "table";
}

/** Map global options + context overrides into ConnectOptions. */
export function connectOptionsFrom(ctx: CliContext, opts: GlobalOptions): ConnectOptions {
  return {
    host: opts.host,
    password: opts.password,
    home: ctx.connectOverrides?.home ?? opts.home,
    transport: ctx.connectOverrides?.transport,
    clientId: ctx.connectOverrides?.clientId,
    rpcTimeoutMs: ctx.rpcTimeoutMs,
  };
}

/**
 * A command action that already has an open daemon client. Returns an exit code (defaults to OK).
 */
export type ConnectedAction = (
  client: DaemonClient,
  ctx: CliContext,
  opts: GlobalOptions,
) => Promise<number | void> | number | void;

/**
 * Run an action with a connected daemon client, translating connection/RPC failures into the
 * appropriate exit code + error message. Always closes the client.
 */
export async function withDaemon(
  ctx: CliContext,
  opts: GlobalOptions,
  action: ConnectedAction,
): Promise<number> {
  let client: DaemonClient | undefined;
  try {
    const result = await ctx.connect(connectOptionsFrom(ctx, opts));
    client = result.client;
  } catch (error) {
    ctx.sink.error(`connection error: ${errorMessage(error)}`);
    return EXIT_CONNECTION;
  }

  try {
    const code = await action(client, ctx, opts);
    return typeof code === "number" ? code : EXIT_OK;
  } catch (error) {
    if (error instanceof RpcError) {
      ctx.sink.error(`error: ${error.message}${error.code ? ` (${error.code})` : ""}`);
      return EXIT_ERROR;
    }
    if (error instanceof RpcTimeoutError) {
      ctx.sink.error(`error: request timed out`);
      return EXIT_ERROR;
    }
    ctx.sink.error(`error: ${errorMessage(error)}`);
    return EXIT_ERROR;
  } finally {
    client?.close();
  }
}

/**
 * Convenience: run a single RPC and render its payload, then return an exit code. `render` turns the
 * payload into text for the table view; the JSON view always prints the raw payload.
 */
export async function runRpc(
  ctx: CliContext,
  opts: GlobalOptions,
  type: string,
  params: Record<string, unknown>,
  render: (payload: unknown) => string,
): Promise<number> {
  return withDaemon(ctx, opts, async (client) => {
    const payload = await client.request(type, params);
    ctx.sink.write(opts.json ? renderJson(payload) : render(payload));
    return EXIT_OK;
  });
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
