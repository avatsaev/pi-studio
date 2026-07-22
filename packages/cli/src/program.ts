import { createRequire } from "node:module";
import { Command } from "commander";

import { registerAgentCommands } from "./agent-commands.js";
import { registerDaemonCommands, ensureLocalDaemonAndPair } from "./daemon-commands.js";
import { registerFeatureCommands, runOpenProject } from "./feature-commands.js";
import { registerRelayCommands } from "./relay-commands.js";
import { registerWebCommands } from "./web-commands.js";
import { type CliContext, type GlobalOptions, defaultContext } from "./cli-core.js";

// Read our own package.json for the version, same relative layout in both `src/` (ts-node/tsx)
// and `dist/` (compiled — one level below the package root either way).
const { version }: { version: string } = createRequire(import.meta.url)("../package.json");

/**
 * Build the root Commander program (features/cli.md § Global options). Global options are attached
 * here; command groups register via `registerCommands` (added incrementally by later tasks). Each
 * command action reports its exit code through `setExit` because Commander actions cannot return
 * one directly.
 */
export function buildProgram(ctx: CliContext, setExit: (code: number) => void): Command {
  const program = new Command();
  program
    .name("pi-studio")
    .description("Pi-Studio terminal client — speaks the daemon WebSocket protocol")
    .version(version, "-v, --version")
    .option("-H, --host <host>", "daemon/host target (e.g. workstation.local:6767)")
    .option("--password <password>", "daemon password (for password-protected daemons)")
    .option("--home <dir>", "override $PI_STUDIO_HOME (client-id store)")
    .option("--json", "render output as JSON instead of a table", false)
    .enablePositionalOptions()
    .argument("[path]", "open a project at this path (bare `pi-studio <path>`)")
    .exitOverride();

  // Default action (no subcommand): `pi-studio <path>` opens a project; bare `pi-studio` starts a
  // local daemon (if needed) and shows a pairing QR.
  program.action(async (path: string | undefined) => {
    const opts = program.opts<GlobalOptions>();
    if (path) {
      setExit(await runOpenProject(ctx, opts, path));
      return;
    }
    setExit(await ensureLocalDaemonAndPair(ctx, opts));
  });

  registerCommands(program, ctx, setExit);
  return program;
}

/** Read the resolved global options off the root program. */
export function globalOptions(program: Command): GlobalOptions {
  return program.opts<GlobalOptions>();
}

/**
 * Register command groups. Each task in this sprint adds its groups here. Kept as a single seam so
 * the program assembly stays declarative.
 */
function registerCommands(
  program: Command,
  ctx: CliContext,
  setExit: (code: number) => void,
): void {
  registerAgentCommands(program, ctx, setExit);
  registerDaemonCommands(program, ctx, setExit);
  registerFeatureCommands(program, ctx, setExit);
  registerRelayCommands(program, ctx, setExit);
  registerWebCommands(program, ctx, setExit);
}

/**
 * Parse argv and run. Returns the process exit code. Commander's help/version short-circuits are
 * treated as success; usage errors as failure.
 */
export async function run(argv: string[], ctx: CliContext = defaultContext()): Promise<number> {
  let exitCode = 0;
  const program = buildProgram(ctx, (code) => {
    exitCode = code;
  });

  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (error) {
    const err = error as { code?: string; exitCode?: number };
    // Help/version requested → success; everything else → that code (or 1).
    if (err.code === "commander.helpDisplayed" || err.code === "commander.version") {
      return 0;
    }
    if (err.code === "commander.help") return 0;
    return typeof err.exitCode === "number" ? err.exitCode : 1;
  }
  return exitCode;
}
