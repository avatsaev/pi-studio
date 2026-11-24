/**
 * Entry of the compiled single binary (`bun build --compile`, `scripts/build-binary.mjs`; A2 of
 * `swe/architecture/single-binary-daemon.md`). One executable is every program: the first argument
 * is a hidden sub-command the runtime seam emits (`__daemon`, `__relay`, `__pi`, `__skills`,
 * `__update-helper`) or the start of a normal `pi-studio` command line. What each argument means is
 * `binary-dispatch.ts`; this file only runs it.
 */
import { createRelayLogger, startRelayServer } from "@av-pi-studio/relay/server";
import {
  isBinary,
  prepareBinaryDaemon,
  preparePiRuntime,
  runBinaryHelperMain,
  runBundledPiCli,
  runBundledSkillsCli,
  runDaemon,
  type RelayOpts,
} from "@av-pi-studio/server";

import { parseBinaryCommand } from "./binary-dispatch.js";
import { defaultContext } from "./cli-core.js";
import { run } from "./program.js";

/** `__relay`: what `packages/relay/src/relay-main.ts` does, with the listen address given. */
async function runRelay(opts: RelayOpts): Promise<void> {
  const logger = createRelayLogger({ logDir: opts.logDir });
  const handle = await startRelayServer({ host: opts.host, port: opts.port, logger });
  const shutdown = (): void => {
    logger.info("shutting down");
    void handle.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/** Drop the sub-command so the program that takes over sees only its own arguments. */
function stripSubcommand(): void {
  process.argv.splice(2, 1);
}

async function main(args: readonly string[]): Promise<void> {
  const command = parseBinaryCommand(args);
  switch (command.kind) {
    case "daemon":
      await prepareBinaryDaemon();
      runDaemon(command.opts);
      return;
    case "relay":
      await runRelay(command.opts);
      return;
    case "pi":
      stripSubcommand();
      await runBundledPiCli();
      return;
    case "skills":
      stripSubcommand();
      await runBundledSkillsCli();
      return;
    case "update-helper":
      // Detached from the old daemon: exit explicitly, the daemon it started is its own process
      // and a kept-alive health connection must not hold the helper open.
      process.exit(await runBinaryHelperMain(command.json));
    case "cli":
      // `auth login` runs Pi's auth engine in this process; an OAuth login needs Pi's Bun runtime
      // setup first. It renames the process and silences warnings, so it runs on first use of the
      // auth engine only (`CliContext.prepareAuth`), not for every command.
      process.exitCode = await run(command.args, {
        ...defaultContext(),
        prepareAuth: preparePiRuntime,
      });
      return;
  }
}

if (!isBinary) {
  process.stderr.write(
    "binary-main is the entry of the compiled binary; run `pi-studio` instead\n",
  );
  process.exitCode = 1;
} else {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`fatal: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
