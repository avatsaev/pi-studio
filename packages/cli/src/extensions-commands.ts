import { join } from "node:path";

import type { DaemonClient } from "@av-pi-studio/client";
import {
  SERVER_FEATURES,
  type ExtensionPackInfo,
  type ExtensionPacksListResponse,
  type ExtensionPacksSetResponse,
} from "@av-pi-studio/protocol";
import {
  attachLastErrors,
  CURATED_PACKS,
  effectivePiHomeKey,
  loadConfig,
  loadExtensionsState,
  planSync,
  readPiSettingsPackages,
  toExtensionPackInfoList,
} from "@av-pi-studio/server";
import type { Command } from "commander";

import {
  type CliContext,
  type GlobalOptions,
  EXIT_ERROR,
  EXIT_OK,
  withDaemon,
} from "./cli-core.js";
import { resolveHome } from "./client-id.js";
import { renderJson, renderTable } from "./output.js";

/**
 * `extensions` command group (features/preinstalled-extensions.md § CLI surface): `list`,
 * `select`, `sync`, plus a daemon-free `list --local` mode mirroring the `auth` group's operation.
 */

/**
 * `select`/`sync` need a generous per-call timeout: the response arrives only after the daemon's
 * triggered sync completes, which can exceed the SDK's default 30s `rpcTimeoutMs` on a first-run
 * install of five packages. `runRpc` has no timeout slot, so these go through `withDaemon` +
 * `client.request` directly instead.
 */
export const EXTENSIONS_SYNC_TIMEOUT_MS = 600_000;

/** Resolve the effective `$PI_STUDIO_HOME` — mirrors `daemon-commands.ts`/`relay-commands.ts`. */
function resolveCtxHome(ctx: CliContext, opts: GlobalOptions): string {
  return ctx.connectOverrides?.home ?? opts.home ?? resolveHome();
}

const FEATURE_MISSING_MESSAGE = "this daemon does not support extension packs; update the host";

interface EntryRow extends Record<string, unknown> {
  pack: string;
  source: string;
  status: string;
  reason?: string;
  message?: string;
  attempts?: number;
}

const ENTRY_ROW_COLUMNS = ["pack", "source", "status", "reason", "message", "attempts"];

/** Truncates `message` to its first line, further capped at `max` chars (features/
 *  preinstalled-extensions.md § CLI commands: "the truncated first line of the message"). */
function truncateFirstLine(message: string, max = 100): string {
  const firstLine = message.split("\n")[0] ?? "";
  return firstLine.length > max ? `${firstLine.slice(0, max - 1)}…` : firstLine;
}

/** One row per curated entry, flattened out of the wire's pack-grouped shape — pure, so it's
 *  unit-testable without a client. `attempts` is shown only when > 1 (a single attempt is the
 *  ordinary case, not worth a column). */
export function buildEntryRows(packs: readonly ExtensionPackInfo[]): EntryRow[] {
  const rows: EntryRow[] = [];
  for (const pack of packs) {
    for (const entry of pack.packages) {
      rows.push({
        pack: pack.id,
        source: entry.source,
        status: entry.status,
        reason: entry.lastError?.reason,
        message: entry.lastError ? truncateFirstLine(entry.lastError.message) : undefined,
        attempts:
          entry.lastError && entry.lastError.attempts > 1 ? entry.lastError.attempts : undefined,
      });
    }
  }
  return rows;
}

/** Renders a `list`-response table (used by both the daemon path and `--local`). */
export function renderExtensionsList(payload: ExtensionPacksListResponse): string {
  return renderTable(buildEntryRows(payload.packs), ENTRY_ROW_COLUMNS);
}

interface SyncReportLike {
  installed: string[];
  failures: { source: string; pack: string; reason: string; message: string }[];
}

/**
 * Renders a triggered sync's report (features/preinstalled-extensions.md § CLI commands):
 * installed count, one line per failure, then the retry footer when any failed. Pure and
 * unit-testable without a client.
 */
export function renderSyncReport(report: SyncReportLike): string[] {
  const lines: string[] = [
    `installed ${report.installed.length} of ${report.installed.length + report.failures.length} recommended extensions`,
  ];
  for (const f of report.failures) {
    lines.push(`✗ ${f.source} (${f.pack}): ${f.reason} — ${truncateFirstLine(f.message)}`);
  }
  if (report.failures.length > 0) {
    lines.push(
      "these will be retried automatically on the next daemon start; run `pi-studio extensions sync` to retry now",
    );
  }
  return lines;
}

/** `0` on `ok`/`noop`; `EXIT_ERROR` otherwise (`partial`/`failed`/`skipped`, or a rejected `ok:
 *  false` request). Successful installs are always kept and reported regardless — no carve-out
 *  for "expected" failures. */
export function exitCodeForSetResponse(res: ExtensionPacksSetResponse): number {
  if (!res.ok) return EXIT_ERROR;
  const outcome = res.report?.outcome;
  return outcome === "ok" || outcome === "noop" ? EXIT_OK : EXIT_ERROR;
}

/** `extensions list` — talks to the daemon. Exit `0` always (reporting, not acting). */
export async function listExtensions(
  client: DaemonClient,
  ctx: CliContext,
  opts: GlobalOptions,
): Promise<number> {
  if (!client.hasFeature(SERVER_FEATURES.extensionPacks)) {
    ctx.sink.error(FEATURE_MISSING_MESSAGE);
    return EXIT_ERROR;
  }
  const payload = await client.request<ExtensionPacksListResponse>(
    "extension_packs_list_request",
    {},
  );
  ctx.sink.write(opts.json ? renderJson(payload) : renderExtensionsList(payload));
  return EXIT_OK;
}

/**
 * `extensions list --local` — no daemon: runs the same pure planner in-process against the
 * effective pi-home (resolved through the shared `effectivePiHomeKey`/`loadConfig` derivation, not
 * a hand-rolled path join), so it can never drift from what a connected daemon would report for
 * the same state. Read-only: never installs, never writes state.
 */
export async function listExtensionsLocal(ctx: CliContext, opts: GlobalOptions): Promise<number> {
  const home = resolveCtxHome(ctx, opts);
  const configPath = join(home, "config.json");
  const env = {
    ...process.env,
    ...(opts.piHome ? { PI_STUDIO_PI_HOME: opts.piHome } : {}),
  };
  const config = loadConfig(configPath, env);
  const piHomeKey = effectivePiHomeKey(config);

  const [state, settings] = await Promise.all([
    loadExtensionsState(home),
    readPiSettingsPackages(piHomeKey),
  ]);
  const piHomeState =
    state === "unreadable"
      ? "unreadable"
      : (state.piHomes[piHomeKey] ?? { offered: {}, failures: {} });
  const packs = config.daemon.extensions.packs;
  const { entries } = planSync({
    catalog: CURATED_PACKS,
    packs,
    state: piHomeState,
    settingsPackages: settings.packages,
  });
  const described = attachLastErrors(entries, piHomeState);
  const lastSync = state === "unreadable" ? undefined : state.piHomes[piHomeKey]?.lastSync;

  const payload: ExtensionPacksListResponse = {
    type: "extension_packs_list_response",
    requestId: "local",
    autoSync: config.daemon.extensions.autoSync,
    selected: [...packs],
    packs: toExtensionPackInfoList(CURATED_PACKS, described),
    ...(lastSync ? { lastSync } : {}),
  };
  ctx.sink.write(opts.json ? renderJson(payload) : renderExtensionsList(payload));
  return EXIT_OK;
}

/** Shared `select`/`sync` request + report rendering. `packs === undefined` ⇒ the manual-sync
 *  trigger (task-001's optional-field contract): no `packs` key at all on the wire. */
async function runSetRequest(
  client: DaemonClient,
  ctx: CliContext,
  opts: GlobalOptions,
  packs: string[] | undefined,
): Promise<number> {
  if (!client.hasFeature(SERVER_FEATURES.extensionPacks)) {
    ctx.sink.error(FEATURE_MISSING_MESSAGE);
    return EXIT_ERROR;
  }
  const params = packs === undefined ? {} : { packs };
  const res = await client.request<ExtensionPacksSetResponse>(
    "extension_packs_set_request",
    params,
    EXTENSIONS_SYNC_TIMEOUT_MS,
  );

  if (opts.json) {
    ctx.sink.write(renderJson(res));
    return exitCodeForSetResponse(res);
  }
  if (!res.ok) {
    ctx.sink.error(res.error ?? "request rejected");
    return exitCodeForSetResponse(res);
  }
  ctx.sink.write(renderSyncReport(res.report ?? { installed: [], failures: [] }).join("\n"));
  return exitCodeForSetResponse(res);
}

/** `extensions select <packs...>` — replaces the selection (`core` always implicit), then syncs. */
export function selectExtensions(
  client: DaemonClient,
  ctx: CliContext,
  packs: string[],
  opts: GlobalOptions,
): Promise<number> {
  return runSetRequest(client, ctx, opts, packs);
}

/** `extensions sync` — triggers a sync without changing the selection (no `packs` key at all): the
 *  ungated manual path, which keeps working even with `daemon.extensions.autoSync: false`. */
export function syncExtensions(
  client: DaemonClient,
  ctx: CliContext,
  opts: GlobalOptions,
): Promise<number> {
  return runSetRequest(client, ctx, opts, undefined);
}

export function registerExtensionsCommands(
  program: Command,
  ctx: CliContext,
  setExit: (code: number) => void,
): void {
  const g = (): GlobalOptions => program.opts<GlobalOptions>();
  const extensions = program.command("extensions").description("manage preinstalled extensions");

  extensions
    .command("list")
    .description("show recommended extensions and their install status")
    .option(
      "--local",
      "run the planner in-process against $PI_STUDIO_HOME / --pi-home, no daemon required " +
        "(--pi-home is a root option: pi-studio --pi-home <dir> extensions list --local)",
    )
    .action(async (o: { local?: boolean }) => {
      if (o.local) {
        setExit(await listExtensionsLocal(ctx, g()));
        return;
      }
      setExit(await withDaemon(ctx, g(), (client) => listExtensions(client, ctx, g())));
    });

  extensions
    .command("select [packs...]")
    .description(
      "set the selected extension packs (replaces the list; `core` is always implicit) and sync",
    )
    .action(async (packs: string[]) => {
      setExit(await withDaemon(ctx, g(), (client) => selectExtensions(client, ctx, packs, g())));
    });

  extensions
    .command("sync")
    .description("sync now without changing the selection (works even with autoSync disabled)")
    .action(async () => {
      setExit(await withDaemon(ctx, g(), (client) => syncExtensions(client, ctx, g())));
    });
}
