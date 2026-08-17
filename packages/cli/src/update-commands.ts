import type { Command } from "commander";

import { type CliContext, type GlobalOptions, EXIT_ERROR, EXIT_OK } from "./cli-core.js";
import { runPiProxy } from "./pi-commands.js";
import {
  CURRENT_VERSION,
  PACKAGE_NAME,
  compareVersions,
  defaultUpdateRuntime,
  type UpdateRuntime,
} from "./update-control.js";

/**
 * `update` command (features/cli.md § Command tree — top-level `update`). Self-updates the
 * globally installed CLI to the latest version published on npm, via the same `npm install -g`
 * path the user originally installed it with (README.md § Install) — pure local/npm process
 * control, same shape as `relay`/`daemon` commands — and then always also runs `pi update
 * --extensions` against the same embedded/global Pi CLI `pi-studio pi` proxies to, so a single
 * `pi-studio update` closes both update loops: the CLI itself, and whatever curated (deliberately
 * unpinned — see extensions-service.ts) extensions are already installed. The extensions step
 * runs unconditionally whenever the CLI step isn't skipped by `--check`, independent of whether
 * the CLI itself had a new version — extensions can have upstream updates on their own schedule.
 */

function runtimeOf(ctx: CliContext): UpdateRuntime {
  return ctx.update ?? defaultUpdateRuntime();
}

/** Run `pi update --extensions`, reusing `runPiProxy` verbatim — same bundled/global CLI
 *  resolution, `--pi-home` env derivation, and exit-code mapping `pi-studio pi update
 *  --extensions` would produce standalone. */
function updatePiExtensions(ctx: CliContext, opts: GlobalOptions): Promise<number> {
  ctx.sink.write("updating pi extensions: pi update --extensions ...");
  return runPiProxy(ctx, opts, ["update", "--extensions"]);
}

/** Check for and optionally apply an update. Returns an exit code. */
export async function runUpdate(
  ctx: CliContext,
  opts: GlobalOptions & { check?: boolean },
): Promise<number> {
  const runtime = runtimeOf(ctx);

  const latest = await runtime.getLatestVersion(PACKAGE_NAME);
  if (latest === null) {
    ctx.sink.error(`could not reach npm to check the latest version of ${PACKAGE_NAME}`);
    return EXIT_ERROR;
  }

  const updateAvailable = compareVersions(latest, CURRENT_VERSION) > 0;

  if (opts.check) {
    ctx.sink.write(
      updateAvailable
        ? `update available: ${CURRENT_VERSION} -> ${latest}`
        : `already up to date (${CURRENT_VERSION})`,
    );
    return EXIT_OK;
  }

  let cliExit = EXIT_OK;
  if (!updateAvailable) {
    ctx.sink.write(`already up to date (${CURRENT_VERSION})`);
  } else {
    ctx.sink.write(`updating ${PACKAGE_NAME}: ${CURRENT_VERSION} -> ${latest} ...`);
    try {
      await runtime.installGlobal(PACKAGE_NAME, latest);
      ctx.sink.write(`updated to ${latest}`);
    } catch (err) {
      ctx.sink.error(`update failed: ${(err as Error)?.message ?? String(err)}`);
      cliExit = EXIT_ERROR;
    }
  }

  const extensionsExit = await updatePiExtensions(ctx, opts);
  return cliExit !== EXIT_OK ? cliExit : extensionsExit;
}

export function registerUpdateCommands(
  program: Command,
  ctx: CliContext,
  setExit: (code: number) => void,
): void {
  const g = (): GlobalOptions => program.opts<GlobalOptions>();

  program
    .command("update")
    .description(
      `update the CLI to the latest ${PACKAGE_NAME} version published on npm, then run ` +
        `\`pi update --extensions\` to update already-installed pi extensions`,
    )
    .option("--check", "only report whether an update is available, without installing it", false)
    .action(async (cmdOpts: { check?: boolean }) => {
      setExit(await runUpdate(ctx, { ...g(), check: cmdOpts.check }));
    });
}
