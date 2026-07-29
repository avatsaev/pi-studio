import { describe, expect, it } from "vitest";
import { Command } from "commander";

import type { CliContext } from "./cli-core.js";
import { EXIT_ERROR } from "./cli-core.js";
import {
  type PiRuntime,
  piProxyCommand,
  piProxyEnv,
  registerPiCommands,
  runPiProxy,
} from "./pi-commands.js";

/**
 * `pi` pass-through command tests (features/cli.md § Command tree). Covers the observable
 * contract: bundled-CLI-first / global-fallback resolution, `--pi-home` env derivation, argv
 * forwarded verbatim, and the child's exit code surfaced unchanged — never the actual `pi` binary
 * behavior (that belongs to `@earendil-works/pi-coding-agent`'s own test suite).
 */

function fakeRuntime(overrides: Partial<PiRuntime> = {}): PiRuntime {
  return {
    spawn: async () => 0,
    resolveBundled: () => "/bundled/pi-coding-agent/dist/cli.js",
    onPath: () => false,
    ...overrides,
  };
}

function ctxWith(pi: PiRuntime): { ctx: CliContext; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const ctx: CliContext = {
    connect: () => {
      throw new Error("not used");
    },
    sink: { write: (l) => out.push(l), error: (l) => err.push(l) },
    pi,
  };
  return { ctx, out, err };
}

/** Build a program with just the `pi` command registered, and drive it programmatically. */
function buildPiProgram(ctx: CliContext): {
  program: Command;
  exitCode: { value: number | undefined };
} {
  const program = new Command();
  program.exitOverride().option("--pi-home <dir>").enablePositionalOptions();
  const exitCode: { value: number | undefined } = { value: undefined };
  registerPiCommands(program, ctx, (code) => {
    exitCode.value = code;
  });
  return { program, exitCode };
}

async function runArgs(program: Command, args: string[]): Promise<void> {
  await program.parseAsync(["node", "pi-studio", ...args]);
}

// ─── piProxyCommand ─────────────────────────────────────────────────────────────

describe("piProxyCommand", () => {
  it("prefers the bundled CLI, launched via the current node binary", () => {
    const cmd = piProxyCommand(fakeRuntime(), ["--model", "x"]);
    expect(cmd).toEqual([process.execPath, "/bundled/pi-coding-agent/dist/cli.js", "--model", "x"]);
  });

  it("falls back to a global `pi` on $PATH when the bundled package is absent", () => {
    const runtime = fakeRuntime({ resolveBundled: () => null, onPath: (bin) => bin === "pi" });
    expect(piProxyCommand(runtime, ["-p", "hi"])).toEqual(["pi", "-p", "hi"]);
  });

  it("returns null when neither the bundled CLI nor a global `pi` is available", () => {
    const runtime = fakeRuntime({ resolveBundled: () => null, onPath: () => false });
    expect(piProxyCommand(runtime, [])).toBeNull();
  });
});

// ─── piProxyEnv ──────────────────────────────────────────────────────────────────

describe("piProxyEnv", () => {
  it("derives PI_CODING_AGENT_DIR/SESSION_DIR from --pi-home", () => {
    expect(piProxyEnv({ piHome: "/custom/.pi" }, {})).toEqual({
      PI_CODING_AGENT_DIR: "/custom/.pi/agent",
      PI_CODING_AGENT_SESSION_DIR: "/custom/.pi/agent/sessions",
    });
  });

  it("falls back to $PI_STUDIO_PI_HOME when --pi-home is not given", () => {
    expect(piProxyEnv({}, { PI_STUDIO_PI_HOME: "/env/.pi" })).toEqual({
      PI_CODING_AGENT_DIR: "/env/.pi/agent",
      PI_CODING_AGENT_SESSION_DIR: "/env/.pi/agent/sessions",
    });
  });

  it("is empty when neither is set", () => {
    expect(piProxyEnv({}, {})).toEqual({});
  });

  it("--pi-home takes precedence over $PI_STUDIO_PI_HOME", () => {
    expect(piProxyEnv({ piHome: "/flag/.pi" }, { PI_STUDIO_PI_HOME: "/env/.pi" })).toEqual({
      PI_CODING_AGENT_DIR: "/flag/.pi/agent",
      PI_CODING_AGENT_SESSION_DIR: "/flag/.pi/agent/sessions",
    });
  });
});

// ─── runPiProxy ──────────────────────────────────────────────────────────────────

describe("runPiProxy", () => {
  it("spawns the resolved command with derived env and returns the child's exit code", async () => {
    const calls: Array<{ command: string[]; env: Record<string, string> }> = [];
    const { ctx } = ctxWith(fakeRuntime({ spawn: async (opts) => (calls.push(opts), 7) }));
    const code = await runPiProxy(ctx, { piHome: "/custom/.pi" }, ["-p", "hi"]);
    expect(code).toBe(7);
    expect(calls).toEqual([
      {
        command: [process.execPath, "/bundled/pi-coding-agent/dist/cli.js", "-p", "hi"],
        env: {
          PI_CODING_AGENT_DIR: "/custom/.pi/agent",
          PI_CODING_AGENT_SESSION_DIR: "/custom/.pi/agent/sessions",
        },
      },
    ]);
  });

  it("reports EXIT_ERROR and writes to stderr when no pi binary can be found", async () => {
    const { ctx, err } = ctxWith(fakeRuntime({ resolveBundled: () => null, onPath: () => false }));
    const code = await runPiProxy(ctx, {}, []);
    expect(code).toBe(EXIT_ERROR);
    expect(err[0]).toMatch(/embedded Pi CLI not found/);
  });

  it("reports EXIT_ERROR when spawning itself throws", async () => {
    const { ctx, err } = ctxWith(
      fakeRuntime({
        spawn: async () => {
          throw new Error("ENOENT");
        },
      }),
    );
    const code = await runPiProxy(ctx, {}, []);
    expect(code).toBe(EXIT_ERROR);
    expect(err[0]).toMatch(/failed to launch pi/);
  });
});

// ─── `pi` command (argv wiring) ──────────────────────────────────────────────────

describe("pi command", () => {
  it("forwards every argument after `pi` verbatim, in order", async () => {
    const calls: Array<{ command: string[]; env: Record<string, string> }> = [];
    const { ctx } = ctxWith(fakeRuntime({ spawn: async (opts) => (calls.push(opts), 0) }));
    const { program, exitCode } = buildPiProgram(ctx);
    await runArgs(program, ["pi", "--model", "x", "-p", "say hi", "--no-tools"]);
    expect(exitCode.value).toBe(0);
    expect(calls[0]?.command.slice(2)).toEqual(["--model", "x", "-p", "say hi", "--no-tools"]);
  });

  it("forwards --pi-home given before the `pi` subcommand into the child env", async () => {
    const calls: Array<{ command: string[]; env: Record<string, string> }> = [];
    const { ctx } = ctxWith(fakeRuntime({ spawn: async (opts) => (calls.push(opts), 0) }));
    const { program } = buildPiProgram(ctx);
    await runArgs(program, ["--pi-home", "/custom/.pi", "pi", "-p", "hi"]);
    expect(calls[0]?.env).toEqual({
      PI_CODING_AGENT_DIR: "/custom/.pi/agent",
      PI_CODING_AGENT_SESSION_DIR: "/custom/.pi/agent/sessions",
    });
  });

  it("runs with no arguments (bare `pi-studio pi` launches the interactive TUI)", async () => {
    const calls: Array<{ command: string[]; env: Record<string, string> }> = [];
    const { ctx } = ctxWith(fakeRuntime({ spawn: async (opts) => (calls.push(opts), 0) }));
    const { program } = buildPiProgram(ctx);
    await runArgs(program, ["pi"]);
    expect(calls[0]?.command.slice(2)).toEqual([]);
  });

  it("surfaces the exit code the resolved pi binary exits with", async () => {
    const { ctx } = ctxWith(fakeRuntime({ spawn: async () => 3 }));
    const { program, exitCode } = buildPiProgram(ctx);
    await runArgs(program, ["pi", "bad-flag"]);
    expect(exitCode.value).toBe(3);
  });

  it("does not intercept --help/-h — they pass through to the pi binary itself", async () => {
    const calls: Array<{ command: string[]; env: Record<string, string> }> = [];
    const { ctx } = ctxWith(fakeRuntime({ spawn: async (opts) => (calls.push(opts), 0) }));
    const { program } = buildPiProgram(ctx);
    await runArgs(program, ["pi", "--help"]);
    expect(calls[0]?.command.slice(2)).toEqual(["--help"]);
  });
});
