import type { Command } from "commander";

import { type CliContext, type GlobalOptions, EXIT_ERROR, EXIT_OK } from "./cli-core.js";
import { parseHost, hostToUrl } from "./connection.js";
import { resolveWebClientDist, startWebServer, type WebServerHandle } from "./web-server.js";

/**
 * `ui` command group (features/cli.md § Command tree — `ui`): serves the prebuilt
 * `@av-pi-studio/web-client` SPA as a static site. Serving is intentionally decoupled from daemon
 * lifecycle — `pi-studio ui` never starts/probes a daemon; `--daemon-host` only pre-fills the
 * printed URL's `?host=&connect=1` query params so the browser tab auto-connects, mirroring the
 * POC's `chat.html` quick-launch params.
 */

export interface UiCommandOptions {
  host?: string;
  port?: string;
  daemonHost?: string;
}

export const DEFAULT_UI_HOST = "127.0.0.1";
export const DEFAULT_UI_PORT = 4173;

/** Build the browser-facing URL, optionally pre-filled with daemon connection query params. */
export function buildServeUrl(baseUrl: string, daemonHostArg?: string): string {
  if (!daemonHostArg) return baseUrl;
  const parsed = parseHost(daemonHostArg);
  const wsUrl = hostToUrl(parsed);
  const url = new URL(baseUrl);
  url.searchParams.set("host", wsUrl);
  url.searchParams.set("connect", "1");
  return url.toString();
}

/** Serve the web-client UI; returns an exit code and (on success) the running server handle. */
export async function runServeUi(
  ctx: CliContext,
  opts: UiCommandOptions,
): Promise<{ code: number; handle?: WebServerHandle }> {
  let dir: string;
  try {
    dir = resolveWebClientDist();
  } catch (err) {
    ctx.sink.error(err instanceof Error ? err.message : String(err));
    return { code: EXIT_ERROR };
  }

  const host = opts.host ?? DEFAULT_UI_HOST;
  const port = Number(opts.port ?? DEFAULT_UI_PORT);

  let handle: WebServerHandle;
  try {
    handle = await startWebServer({ dir, host, port });
  } catch (err) {
    ctx.sink.error(
      `failed to start web server: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { code: EXIT_ERROR };
  }

  ctx.sink.write(`serving Pi-Studio web UI at ${buildServeUrl(handle.url, opts.daemonHost)}`);
  return { code: EXIT_OK, handle };
}

export function registerUiCommands(
  program: Command,
  ctx: CliContext,
  setExit: (code: number) => void,
): void {
  const g = (): GlobalOptions => program.opts<GlobalOptions>();

  program
    .command("ui")
    .description("serve the Pi-Studio web UI (prebuilt static build)")
    .option("--ui-host <host>", "interface to bind", DEFAULT_UI_HOST)
    .option("--ui-port <port>", "port to bind", String(DEFAULT_UI_PORT))
    .option(
      "--daemon-host <host>",
      "daemon to auto-connect the served UI to (fills ?host=&connect=1)",
    )
    .action(async (cmdOpts: { uiHost?: string; uiPort?: string; daemonHost?: string }) => {
      const { code, handle } = await runServeUi(ctx, {
        host: cmdOpts.uiHost,
        port: cmdOpts.uiPort,
        daemonHost: cmdOpts.daemonHost ?? g().host,
      });
      if (!handle) {
        setExit(code);
        return;
      }

      const interrupted = new Promise<void>((resolveInterrupted) => {
        const shutdown = (): void => {
          void handle.close().then(resolveInterrupted);
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
      });

      // Keep the process alive until interrupted; the server itself holds the event loop open.
      await interrupted;
      setExit(EXIT_OK);
    });
}
