import type { Command } from "commander";

import { type CliContext, type GlobalOptions, EXIT_ERROR, EXIT_OK } from "./cli-core.js";
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
 * path the user originally installed it with (README.md § Install). No daemon connection
 * involved — this is pure local/npm process control, same shape as `relay`/`daemon` commands.
 */

function runtimeOf(ctx: CliContext): UpdateRuntime {
  return ctx.update ?? defaultUpdateRuntime();
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

  if (compareVersions(latest, CURRENT_VERSION) <= 0) {
    ctx.sink.write(`already up to date (${CURRENT_VERSION})`);
    return EXIT_OK;
  }

  if (opts.check) {
    ctx.sink.write(`update available: ${CURRENT_VERSION} -> ${latest}`);
    return EXIT_OK;
  }

  ctx.sink.write(`updating ${PACKAGE_NAME}: ${CURRENT_VERSION} -> ${latest} ...`);
  try {
    await runtime.installGlobal(PACKAGE_NAME, latest);
  } catch (err) {
    ctx.sink.error(`update failed: ${(err as Error)?.message ?? String(err)}`);
    return EXIT_ERROR;
  }
  ctx.sink.write(`updated to ${latest}`);
  return EXIT_OK;
}

export function registerUpdateCommands(
  program: Command,
  ctx: CliContext,
  setExit: (code: number) => void,
): void {
  const g = (): GlobalOptions => program.opts<GlobalOptions>();

  program
    .command("update")
    .description(`update the CLI to the latest ${PACKAGE_NAME} version published on npm`)
    .option("--check", "only report whether an update is available, without installing it", false)
    .action(async (cmdOpts: { check?: boolean }) => {
      setExit(await runUpdate(ctx, { ...g(), check: cmdOpts.check }));
    });
}
