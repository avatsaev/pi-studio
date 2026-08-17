import type { Command } from "commander";

import { loadConfig, type PersistedConfig } from "@av-pi-studio/server";

import { type CliContext, type GlobalOptions, EXIT_ERROR, EXIT_OK } from "./cli-core.js";
import { resolveHome } from "./client-id.js";
import { parseHost } from "./connection.js";
import {
  type DaemonRuntime,
  daemonStatus,
  daemonPaths,
  defaultDaemonRuntime,
  persistRelayEnvOverrides,
  rotateDaemonKeypair,
  setDaemonPassword,
  stopDaemon,
  waitForDaemon,
} from "./daemon-control.js";
import { buildPairingUrl, readDaemonPublicKey, type PairingRelayInfo } from "./pairing.js";
import { renderQrToTerminal } from "./qr.js";

/**
 * Daemon command group + local spawn + QR pairing (features/cli.md § Command tree (daemon),
 * § Behavior; architecture/daemon-bootstrap.md; architecture/relay-e2ee.md § Pairing).
 */

/** Resolve the effective `$PI_STUDIO_HOME` for control operations. */
function resolveCtxHome(ctx: CliContext, opts: GlobalOptions): string {
  return ctx.connectOverrides?.home ?? opts.home ?? resolveHome();
}

function runtimeOf(ctx: CliContext): DaemonRuntime {
  return ctx.daemon ?? defaultDaemonRuntime();
}

/**
 * Read `daemon.relay` from `config.json` (env-overlaid, matching how the daemon itself resolves
 * relay config) and translate it into the `PairingRelayInfo` `buildPairingUrl` needs — `null` when
 * the relay isn't enabled or has no usable client-facing endpoint. The client-facing endpoint
 * prefers `publicEndpoint`/`publicUseTls` (the address clients should dial) and falls back to
 * `endpoint`/`useTls` (the daemon's own outbound-dial target) when no separate public address was
 * configured — the common case for a relay reachable at the same address from both sides.
 *
 * `printPairing` also forwards `config.app.baseUrl` (env `PI_STUDIO_APP_BASE_URL`) as
 * `buildPairingUrl`'s `baseUrl` — self-hosted/local deployments should override this to their own
 * web-client origin (e.g. `http://localhost:8080`) instead of `DEFAULT_PAIRING_BASE`
 * (`pairing.ts`), which defaults to Pi-Studio's own production web-client
 * (`https://app.molagent.ai`) — correct for a daemon that's meant to be pairable from THAT origin,
 * but wrong for a self-hosted deployment's own separately-running web-client instance.
 */
function resolvePairingRelayInfo(config: PersistedConfig): PairingRelayInfo | null {
  const relay = config.daemon.relay;
  if (!relay.enabled) return null;
  const endpoint = relay.publicEndpoint ?? relay.endpoint;
  if (!endpoint) return null;
  const useTls = relay.publicEndpoint !== undefined ? relay.publicUseTls : relay.useTls;
  return { endpoint, useTls };
}

/** Render the pairing QR + link for the daemon at `home`. Returns an exit code. */
export async function printPairing(
  ctx: CliContext,
  home: string,
  hostArg: string | undefined,
): Promise<number> {
  const publicKey = readDaemonPublicKey(home);
  if (!publicKey) {
    ctx.sink.error("no daemon keypair found — start the daemon first (`pi-studio daemon start`).");
    return EXIT_ERROR;
  }
  const config = loadConfig(daemonPaths(home).config);
  const relay = resolvePairingRelayInfo(config);
  const { host, port } = parseHost(hostArg);
  const url = buildPairingUrl(publicKey, {
    host: `${host}:${port}`,
    relay: relay ?? undefined,
    baseUrl: config.app.baseUrl,
  });
  const qr = await renderQrToTerminal(url);
  ctx.sink.write(qr);
  ctx.sink.write(`Pairing link: ${url}`);
  if (relay) {
    ctx.sink.write(
      `(routed via relay ${relay.endpoint} — reachable without a direct connection to this daemon)`,
    );
  }
  return EXIT_OK;
}

/** Ensure a local daemon is running (start it if not), then print the pairing QR. */
export async function ensureLocalDaemonAndPair(
  ctx: CliContext,
  opts: GlobalOptions,
  startOpts: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<number> {
  const runtime = runtimeOf(ctx);
  const home = resolveCtxHome(ctx, opts);
  persistRelayEnvOverrides(home);
  const { host, port } = parseHost(opts.host);

  if (await runtime.probe(host, port)) {
    ctx.sink.write(`daemon already running at ${host}:${port}`);
    return printPairing(ctx, home, opts.host);
  }

  ctx.sink.write(`starting local daemon at ${host}:${port} …`);
  await runtime.start({ home, listen: `${host}:${port}`, piHome: opts.piHome });
  const up = await waitForDaemon(runtime, host, port, { sleep: startOpts.sleep });
  if (!up) {
    ctx.sink.error("daemon did not become healthy in time.");
    return EXIT_ERROR;
  }
  ctx.sink.write(`daemon listening at ${host}:${port}`);
  return printPairing(ctx, home, opts.host);
}

export function registerDaemonCommands(
  program: Command,
  ctx: CliContext,
  setExit: (code: number) => void,
): void {
  const g = (): GlobalOptions => program.opts<GlobalOptions>();
  const daemon = program.command("daemon").description("manage the local daemon");

  daemon
    .command("status")
    .description("report daemon health")
    .action(async () => {
      const { up, host, port } = await daemonStatus(runtimeOf(ctx), g().host);
      if (g().json) ctx.sink.write(JSON.stringify({ up, host, port }));
      else ctx.sink.write(`daemon ${up ? "up" : "down"} at ${host}:${port}`);
      setExit(up ? EXIT_OK : EXIT_ERROR);
    });

  daemon
    .command("start")
    .description("start a local daemon and show a pairing QR code")
    .action(async () => {
      setExit(await ensureLocalDaemonAndPair(ctx, g()));
    });

  daemon
    .command("stop")
    .description("stop the local daemon")
    .action(() => {
      const stopped = stopDaemon(resolveCtxHome(ctx, g()), runtimeOf(ctx));
      ctx.sink.write(stopped ? "daemon stopped" : "no running daemon found");
      setExit(stopped ? EXIT_OK : EXIT_ERROR);
    });

  daemon
    .command("restart")
    .description("restart the local daemon")
    .action(async () => {
      stopDaemon(resolveCtxHome(ctx, g()), runtimeOf(ctx));
      setExit(await ensureLocalDaemonAndPair(ctx, g()));
    });

  daemon
    .command("pair")
    .description("render the pairing QR code / link")
    .action(async () => {
      setExit(await printPairing(ctx, resolveCtxHome(ctx, g()), g().host));
    });

  daemon
    .command("set-password <password>")
    .description("set the daemon password (bcrypt-hashed into config.json)")
    .action((password: string) => {
      setDaemonPassword(resolveCtxHome(ctx, g()), password, runtimeOf(ctx));
      ctx.sink.write("password set; restart the daemon to enforce it.");
      setExit(EXIT_OK);
    });

  daemon
    .command("rotate-key")
    .description("replace the daemon's pairing keypair (revokes every existing pairing link)")
    .action(async () => {
      const home = resolveCtxHome(ctx, g());
      // Stop first: a live daemon holds the old key in memory and keeps answering on the old relay
      // session id, so deleting the file under it would revoke nothing until it exited anyway.
      stopDaemon(home, runtimeOf(ctx));
      const rotated = rotateDaemonKeypair(home);
      ctx.sink.write(
        rotated
          ? "keypair rotated — every previously-issued pairing link/QR is now invalid; re-pair all clients."
          : "no existing keypair found — a new one will be generated.",
      );
      setExit(await ensureLocalDaemonAndPair(ctx, g()));
    });

  // top-level `onboard` — start/connect + show QR.
  program
    .command("onboard")
    .description("start a local daemon (if needed) and show a pairing QR code")
    .action(async () => {
      setExit(await ensureLocalDaemonAndPair(ctx, g()));
    });
}
