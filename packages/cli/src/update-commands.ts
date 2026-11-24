import { join } from "node:path";

import type { Command } from "commander";

import { resolveHome } from "./client-id.js";
import { type CliContext, type GlobalOptions, EXIT_ERROR, EXIT_OK } from "./cli-core.js";
import { parseHost } from "./connection.js";
import {
  type DaemonRuntime,
  type DaemonStarter,
  defaultDaemonRuntime,
  stopDaemon,
  waitForDaemon,
} from "./daemon-control.js";
import { runPiProxy } from "./pi-commands.js";
import {
  CURRENT_VERSION,
  PACKAGE_NAME,
  RELEASES_PAGE,
  compareVersions,
  defaultUpdateRuntime,
  type BinaryUpdateRuntime,
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
 * On the compiled binary (`UpdateRuntime.binary`) the same command works on `bin/versions` instead
 * of npm (`runBinaryUpdate`).
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

/** What `restartLocalDaemon` did: the exit code, and whether a daemon was restarted and answers. */
interface RestartOutcome {
  code: number;
  restarted: boolean;
}

function homeOf(ctx: CliContext, opts: GlobalOptions): string {
  return ctx.connectOverrides?.home ?? opts.home ?? resolveHome();
}

/**
 * After a successful install, restart a local daemon that answers health at `--host`: stop it
 * (waiting for the exit), start it on the same host:port (with `start` when given: the binary's
 * new version), and print the version that answers. No answering daemon means nothing to do.
 * Returns an exit code; the install is never undone.
 */
async function restartLocalDaemon(
  ctx: CliContext,
  opts: GlobalOptions,
  start?: DaemonStarter,
): Promise<RestartOutcome> {
  const runtime: DaemonRuntime = ctx.daemon ?? defaultDaemonRuntime();
  const { host, port } = parseHost(opts.host);
  if (!(await runtime.probe(host, port))) return { code: EXIT_OK, restarted: false };

  const home = homeOf(ctx, opts);
  ctx.sink.write(`restarting local daemon at ${host}:${port} ...`);
  try {
    const { stopped, error } = await stopDaemon(home, runtime);
    if (!stopped) {
      ctx.sink.error(
        error
          ? "daemon restart failed: the daemon did not exit in time; it is still running."
          : "daemon restart failed: the running daemon was not started by this CLI home and cannot be stopped.",
      );
      return { code: EXIT_ERROR, restarted: false };
    }
    await (start ?? runtime.start)({ home, listen: `${host}:${port}`, piHome: opts.piHome });
    if (!(await waitForDaemon(runtime, host, port))) {
      ctx.sink.error("daemon restart failed: the daemon did not become healthy in time.");
      return { code: EXIT_ERROR, restarted: false };
    }
    const version = await runtime.readVersion(host, port);
    ctx.sink.write(`daemon restarted: ${version ?? "unknown version"}`);
    return { code: EXIT_OK, restarted: true };
  } catch (err) {
    ctx.sink.error(`daemon restart failed: ${(err as Error)?.message ?? String(err)}`);
    return { code: EXIT_ERROR, restarted: false };
  }
}

/** Why a binary may not install over itself, with the way out. */
function binaryBlockerMessage(
  reason: "unmanaged_binary" | "not_writable",
  home: string,
  latest: string,
): string {
  const where =
    reason === "unmanaged_binary"
      ? `this pi-studio is not installed under ${join(home, "bin", "versions")}`
      : `${join(home, "bin")} is not writable`;
  return `update failed: ${where}, so it cannot update itself; download ${latest} from ${RELEASES_PAGE}`;
}

/**
 * `update` on the compiled binary: reads `daemon-updates/latest.json`, installs the newer version
 * into `bin/versions/<version>`, switches `bin/current`, runs `pi update --extensions`, and
 * restarts a running local daemon from the new version; once that daemon answers, the version
 * folders other than the new and the previous one are removed.
 */
async function runBinaryUpdate(
  ctx: CliContext,
  opts: GlobalOptions & { check?: boolean },
  binary: BinaryUpdateRuntime,
): Promise<number> {
  const release = await binary.lookup();
  if (release.kind !== "ok") {
    ctx.sink.error(
      release.kind === "offline"
        ? "could not read latest.json to check the latest version of pi-studio"
        : "latest.json is not a valid release manifest",
    );
    return EXIT_ERROR;
  }
  const latest = release.version;
  const updateAvailable = compareVersions(latest, CURRENT_VERSION) > 0;

  if (opts.check) {
    ctx.sink.write(
      updateAvailable
        ? `update available: ${CURRENT_VERSION} -> ${latest}`
        : `already up to date (${CURRENT_VERSION})`,
    );
    return EXIT_OK;
  }

  const home = homeOf(ctx, opts);
  let cliExit = EXIT_OK;
  let installed = false;
  if (!updateAvailable) {
    ctx.sink.write(`already up to date (${CURRENT_VERSION})`);
  } else {
    const blocker = await binary.blocker(home);
    if (blocker !== null) {
      ctx.sink.error(binaryBlockerMessage(blocker, home, latest));
      cliExit = EXIT_ERROR;
    } else if (release.asset === null) {
      ctx.sink.error("update failed: latest.json has no pi-studio build for this system");
      cliExit = EXIT_ERROR;
    } else {
      ctx.sink.write(`updating pi-studio: ${CURRENT_VERSION} -> ${latest} ...`);
      try {
        await binary.install(home, latest);
        await binary.switchCurrent(home, latest);
        ctx.sink.write(`updated to ${latest}`);
        installed = true;
      } catch (err) {
        ctx.sink.error(`update failed: ${(err as Error)?.message ?? String(err)}`);
        cliExit = EXIT_ERROR;
      }
    }
  }

  const extensionsExit = await updatePiExtensions(ctx, opts);
  const restart = installed
    ? await restartLocalDaemon(ctx, opts, binary.startDaemon)
    : { code: EXIT_OK, restarted: false };
  if (restart.restarted && restart.code === EXIT_OK) {
    try {
      await binary.prune(home, [latest, CURRENT_VERSION]);
    } catch (err) {
      ctx.sink.error(`old versions not removed: ${(err as Error)?.message ?? String(err)}`);
    }
  }
  if (cliExit !== EXIT_OK) return cliExit;
  return extensionsExit !== EXIT_OK ? extensionsExit : restart.code;
}

/** Check for and optionally apply an update. Returns an exit code. */
export async function runUpdate(
  ctx: CliContext,
  opts: GlobalOptions & { check?: boolean },
): Promise<number> {
  const runtime = runtimeOf(ctx);
  if (runtime.binary) return runBinaryUpdate(ctx, opts, runtime.binary);

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
  let installed = false;
  if (!updateAvailable) {
    ctx.sink.write(`already up to date (${CURRENT_VERSION})`);
  } else {
    ctx.sink.write(`updating ${PACKAGE_NAME}: ${CURRENT_VERSION} -> ${latest} ...`);
    try {
      await runtime.installGlobal(PACKAGE_NAME, latest);
      ctx.sink.write(`updated to ${latest}`);
      installed = true;
    } catch (err) {
      ctx.sink.error(`update failed: ${(err as Error)?.message ?? String(err)}`);
      cliExit = EXIT_ERROR;
    }
  }

  const extensionsExit = await updatePiExtensions(ctx, opts);
  const restartExit = installed ? (await restartLocalDaemon(ctx, opts)).code : EXIT_OK;
  if (cliExit !== EXIT_OK) return cliExit;
  return extensionsExit !== EXIT_OK ? extensionsExit : restartExit;
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
