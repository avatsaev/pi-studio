import type { Command } from "commander";

import {
  ConfigUnreadableError,
  isUnprotectedBind,
  loadConfig,
  UNPROTECTED_BIND_CODE,
  unprotectedBindMessage,
  type PersistedConfig,
} from "@av-pi-studio/server";

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

const STILL_RUNNING_MESSAGE = "the daemon did not exit in time; it is still running.";

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

interface ResolvedPairing {
  url: string;
  relay: PairingRelayInfo | null;
}

/** Build the pairing link for the daemon at `home`; `null` when no keypair exists yet. */
function resolvePairing(home: string, hostArg: string | undefined): ResolvedPairing | null {
  const publicKey = readDaemonPublicKey(home);
  if (!publicKey) return null;
  const config = loadConfig(daemonPaths(home).config);
  const relay = resolvePairingRelayInfo(config);
  const { host, port } = parseHost(hostArg);
  const url = buildPairingUrl(publicKey, {
    host: `${host}:${port}`,
    relay: relay ?? undefined,
    baseUrl: config.app.baseUrl,
  });
  return { url, relay };
}

/**
 * Run `run`; when it throws {@link ConfigUnreadableError} (a `config.json` that cannot be used),
 * report it and exit with an error: the message on stderr, or with `json` one
 * `{ up: false, host, port, error: "config_unreadable" }` line. Nothing has been spawned or
 * written at that point; every other error propagates.
 */
export async function reportingConfigErrors(
  ctx: CliContext,
  hostArg: string | undefined,
  json: boolean | undefined,
  run: () => number | Promise<number>,
): Promise<number> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof ConfigUnreadableError)) throw error;
    const { host, port } = parseHost(hostArg);
    if (json) ctx.sink.write(JSON.stringify({ up: false, host, port, error: error.code }));
    else ctx.sink.error(error.message);
    return EXIT_ERROR;
  }
}

/**
 * Render the pairing QR + link for the daemon at `home`. Returns an exit code. With `json` it
 * writes one `{ pairingUrl, relay }` / `{ error: "no_keypair" }` line instead (no QR, no prose).
 */
export async function printPairing(
  ctx: CliContext,
  home: string,
  hostArg: string | undefined,
  json = false,
): Promise<number> {
  const pairing = resolvePairing(home, hostArg);
  if (!pairing) {
    if (json) ctx.sink.write(JSON.stringify({ error: "no_keypair" }));
    else
      ctx.sink.error(
        "no daemon keypair found — start the daemon first (`pi-studio daemon start`).",
      );
    return EXIT_ERROR;
  }
  const { url, relay } = pairing;
  if (json) {
    ctx.sink.write(JSON.stringify({ pairingUrl: url, relay: relay?.endpoint ?? null }));
    return EXIT_OK;
  }
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

/**
 * Ensure a local daemon is running (start it if not), then print the pairing QR. With
 * `startOpts.json` (only `daemon start|restart` pass it) it writes exactly one JSON line instead:
 * `{ up, started, host, port, pairingUrl, relay }`, `{ up: false, host, port, error: "not_healthy" }`,
 * `{ up: false, host, port, error: "unprotected_bind" }` (non-loopback host, no password),
 * `{ up: false, host, port, error: "config_unreadable" }` (`config.json` damaged; nothing is spawned
 * and the message goes to stderr in text mode),
 * or, when healthy but no keypair file exists, `{ up: true, started, host, port, error: "no_keypair" }`.
 */
export async function ensureLocalDaemonAndPair(
  ctx: CliContext,
  opts: GlobalOptions,
  startOpts: { sleep?: (ms: number) => Promise<void>; json?: boolean } = {},
): Promise<number> {
  return reportingConfigErrors(ctx, opts.host, startOpts.json === true, () =>
    startAndPair(ctx, opts, startOpts),
  );
}

async function startAndPair(
  ctx: CliContext,
  opts: GlobalOptions,
  startOpts: { sleep?: (ms: number) => Promise<void>; json?: boolean },
): Promise<number> {
  const json = startOpts.json === true;
  const runtime = runtimeOf(ctx);
  const home = resolveCtxHome(ctx, opts);
  persistRelayEnvOverrides(home);
  const { host, port } = parseHost(opts.host);

  let started = false;
  if (await runtime.probe(host, port)) {
    if (!json) ctx.sink.write(`daemon already running at ${host}:${port}`);
  } else {
    // The daemon refuses this bind itself; checking first reports it instead of a health timeout.
    const config = loadConfig(daemonPaths(home).config);
    if (
      isUnprotectedBind(host, {
        configPassword: config.daemon.auth.password,
        envPassword: process.env.PI_STUDIO_PASSWORD,
      })
    ) {
      if (json) {
        ctx.sink.write(JSON.stringify({ up: false, host, port, error: UNPROTECTED_BIND_CODE }));
      } else {
        ctx.sink.error(unprotectedBindMessage(host, port));
      }
      return EXIT_ERROR;
    }
    if (!json) ctx.sink.write(`starting local daemon at ${host}:${port} …`);
    await runtime.start({ home, listen: `${host}:${port}`, piHome: opts.piHome });
    const up = await waitForDaemon(runtime, host, port, { sleep: startOpts.sleep });
    if (!up) {
      if (json) ctx.sink.write(JSON.stringify({ up: false, host, port, error: "not_healthy" }));
      else ctx.sink.error("daemon did not become healthy in time.");
      return EXIT_ERROR;
    }
    started = true;
    if (!json) ctx.sink.write(`daemon listening at ${host}:${port}`);
  }

  if (!json) return printPairing(ctx, home, opts.host);
  const pairing = resolvePairing(home, opts.host);
  if (!pairing) {
    ctx.sink.write(JSON.stringify({ up: true, started, host, port, error: "no_keypair" }));
    return EXIT_ERROR;
  }
  ctx.sink.write(
    JSON.stringify({
      up: true,
      started,
      host,
      port,
      pairingUrl: pairing.url,
      relay: pairing.relay?.endpoint ?? null,
    }),
  );
  return EXIT_OK;
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
      setExit(await ensureLocalDaemonAndPair(ctx, g(), { json: g().json }));
    });

  daemon
    .command("stop")
    .description("stop the local daemon and wait for it to exit")
    .action(async () => {
      const { stopped, error } = await stopDaemon(resolveCtxHome(ctx, g()), runtimeOf(ctx));
      if (g().json) ctx.sink.write(JSON.stringify(error ? { stopped, error } : { stopped }));
      else if (error) ctx.sink.error(STILL_RUNNING_MESSAGE);
      else ctx.sink.write(stopped ? "daemon stopped" : "no running daemon found");
      setExit(stopped ? EXIT_OK : EXIT_ERROR);
    });

  daemon
    .command("restart")
    .description("restart the local daemon")
    .action(async () => {
      const home = resolveCtxHome(ctx, g());
      // A damaged config.json refuses the start: say so before the running daemon is stopped.
      const unusable = await reportingConfigErrors(ctx, g().host, g().json, () => {
        loadConfig(daemonPaths(home).config);
        return EXIT_OK;
      });
      if (unusable !== EXIT_OK) {
        setExit(unusable);
        return;
      }
      const { error } = await stopDaemon(home, runtimeOf(ctx));
      if (error) {
        // Starting now would find the old daemon still answering and report it as running.
        const { host, port } = parseHost(g().host);
        if (g().json) ctx.sink.write(JSON.stringify({ up: false, host, port, error }));
        else ctx.sink.error(STILL_RUNNING_MESSAGE);
        setExit(EXIT_ERROR);
        return;
      }
      setExit(await ensureLocalDaemonAndPair(ctx, g(), { json: g().json }));
    });

  daemon
    .command("pair")
    .description("render the pairing QR code / link")
    .action(async () => {
      const home = resolveCtxHome(ctx, g());
      setExit(
        await reportingConfigErrors(ctx, g().host, g().json, () =>
          printPairing(ctx, home, g().host, g().json),
        ),
      );
    });

  daemon
    .command("set-password <password>")
    .description("set the daemon password (bcrypt-hashed into config.json)")
    .action(async (password: string) => {
      setExit(
        await reportingConfigErrors(ctx, g().host, g().json, () => {
          setDaemonPassword(resolveCtxHome(ctx, g()), password, runtimeOf(ctx));
          ctx.sink.write("password set; restart the daemon to enforce it.");
          return EXIT_OK;
        }),
      );
    });

  daemon
    .command("rotate-key")
    .description("replace the daemon's pairing keypair (revokes every existing pairing link)")
    .action(async () => {
      const home = resolveCtxHome(ctx, g());
      // Stop first: a live daemon holds the old key in memory and keeps answering on the old relay
      // session id, so deleting the file under it would revoke nothing until it exited anyway.
      const { error } = await stopDaemon(home, runtimeOf(ctx));
      if (error) {
        ctx.sink.error(STILL_RUNNING_MESSAGE);
        setExit(EXIT_ERROR);
        return;
      }
      const rotated = rotateDaemonKeypair(home);
      ctx.sink.write(
        rotated
          ? "keypair rotated — every previously-issued pairing link/QR is now invalid; re-pair all clients."
          : "no existing keypair found — a new one was created.",
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
