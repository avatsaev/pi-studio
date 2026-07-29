import { spawn } from "node:child_process";
import { join } from "node:path";

import { resolveBinaryOnPath, resolveBundledPiCli } from "@av-pi-studio/server";
import type { Command } from "commander";

import { type CliContext, type GlobalOptions, EXIT_ERROR } from "./cli-core.js";

/**
 * `pi` pass-through command (features/cli.md § Command tree). Runs the Pi CLI **bundled inside the
 * `@earendil-works/pi-coding-agent` dependency** — the exact same binary the daemon spawns for
 * `pi --mode rpc` — with every argument forwarded verbatim. This makes `pi-studio pi ...` a drop-in
 * replacement for a globally-installed `pi`, so there is exactly one Pi on the system and no
 * separate install is required.
 *
 * The command is a pure local proxy: it never touches the daemon, the wire protocol, or RPC. It
 * inherits stdio so Pi's interactive TUI, spinners, and prompts behave exactly as native `pi`, and
 * it forwards the child's exit code and signals (Ctrl+C) unchanged.
 */

/** Injectable process-spawn side-effect; tests inject a fake. Mirrors the DaemonRuntime pattern. */
export type PiSpawner = (opts: {
  command: string[];
  env: Record<string, string>;
}) => Promise<number>;

export interface PiRuntime {
  spawn: PiSpawner;
  /** Resolve the bundled CLI path; tests override to simulate presence/absence. */
  resolveBundled: () => string | null;
  /** Probe a bare binary on $PATH; tests override. */
  onPath: (bin: string) => boolean;
}

/**
 * Default spawner: `spawn(process.execPath, [cli, ...args], { stdio: "inherit" })`, resolving with
 * the child's exit code. `stdio: "inherit"` is required for Pi's TUI; signals are left to Node's
 * default propagation (the child shares the process group, so Ctrl+C reaches it directly).
 */
export const subprocessPiSpawner: PiSpawner = ({ command, env }) =>
  new Promise<number>((resolve, reject) => {
    const child = spawn(command[0] as string, command.slice(1), {
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      // A signal-killed child reports code=null; mirror the conventional 128+signal exit status so
      // scripts see the same code as if they'd run `pi` directly.
      if (code !== null) resolve(code);
      else resolve(128 + (signal === "SIGINT" ? 2 : signal === "SIGTERM" ? 15 : 1));
    });
  });

export function defaultPiRuntime(): PiRuntime {
  return {
    spawn: subprocessPiSpawner,
    resolveBundled: resolveBundledPiCli,
    onPath: (bin) => resolveBinaryOnPath(bin),
  };
}

/**
 * Derive `PI_CODING_AGENT_DIR`/`PI_CODING_AGENT_SESSION_DIR` from `--pi-home` / `PI_STUDIO_PI_HOME`,
 * so `pi-studio pi` talks to the same Pi config tree the daemon's agents use. Mirrors
 * `piHomeEnv()` in the server's provider-registry (kept separate: the CLI has no daemon config
 * context when run standalone).
 */
export function piProxyEnv(opts: GlobalOptions, env = process.env): Record<string, string> {
  const piHome = opts.piHome ?? env.PI_STUDIO_PI_HOME;
  if (!piHome) return {};
  const agentDir = join(piHome, "agent");
  return {
    PI_CODING_AGENT_DIR: agentDir,
    PI_CODING_AGENT_SESSION_DIR: join(agentDir, "sessions"),
  };
}

/**
 * Build the launch command: prefer the bundled CLI (`node <pkg>/dist/cli.js`), fall back to a
 * global `pi` on `$PATH` when the dependency is absent (mirrors `defaultPiCommand()`).
 */
export function piProxyCommand(runtime: PiRuntime, args: string[]): string[] | null {
  const cli = runtime.resolveBundled();
  if (cli) return [process.execPath, cli, ...args];
  if (runtime.onPath("pi")) return ["pi", ...args];
  return null;
}

/** Run the Pi proxy. Returns the child's exit code (or EXIT_ERROR when no Pi binary is found). */
export async function runPiProxy(
  ctx: CliContext,
  opts: GlobalOptions,
  args: string[],
): Promise<number> {
  const runtime = ctx.pi ?? defaultPiRuntime();
  const command = piProxyCommand(runtime, args);
  if (!command) {
    ctx.sink.error(
      "embedded Pi CLI not found: @earendil-works/pi-coding-agent is not installed and no global `pi` is on $PATH",
    );
    return EXIT_ERROR;
  }
  try {
    return await runtime.spawn({ command, env: piProxyEnv(opts) });
  } catch (err) {
    ctx.sink.error(`failed to launch pi: ${(err as Error)?.message ?? String(err)}`);
    return EXIT_ERROR;
  }
}

export function registerPiCommands(
  program: Command,
  ctx: CliContext,
  setExit: (code: number) => void,
): void {
  const g = (): GlobalOptions => program.opts<GlobalOptions>();

  program
    .command("pi [args...]")
    .description("run the embedded Pi coding-agent CLI (pass-through; forwards every argument)")
    // Pi owns its entire flag surface (--model, -p, --session, subcommands, …); Commander must not
    // parse or reject any of it. Everything after `pi` is captured raw into `args`.
    .allowUnknownOption()
    .passThroughOptions()
    .allowExcessArguments()
    // Let `--help`/`-h` pass through to Pi (users want Pi's help, not pi-studio's). pi-studio's own
    // help for this command remains available via `pi-studio help pi`.
    .helpOption(false)
    .action(async (args: string[]) => {
      setExit(await runPiProxy(ctx, g(), args ?? []));
    });
}
