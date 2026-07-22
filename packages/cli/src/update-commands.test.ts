import { describe, expect, it } from "vitest";
import { Command } from "commander";

import type { CliContext } from "./cli-core.js";
import { connectDaemon } from "./connection.js";
import type { UpdateRuntime } from "./update-control.js";
import { CURRENT_VERSION } from "./update-control.js";
import { registerUpdateCommands, runUpdate } from "./update-commands.js";

function fakeRuntime(overrides: Partial<UpdateRuntime> = {}): UpdateRuntime {
  return {
    getLatestVersion: async () => CURRENT_VERSION,
    installGlobal: async () => {},
    ...overrides,
  };
}

function ctxWith(update: UpdateRuntime): { ctx: CliContext; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const ctx: CliContext = {
    connect: (opts) => connectDaemon(opts),
    sink: { write: (l) => out.push(l), error: (l) => err.push(l) },
    update,
  };
  return { ctx, out, err };
}

function buildUpdateProgram(ctx: CliContext): {
  program: Command;
  exitCode: { value: number | undefined };
} {
  const program = new Command();
  program.exitOverride().option("--home <dir>").option("--json", "", false);
  const exitCode: { value: number | undefined } = { value: undefined };
  registerUpdateCommands(program, ctx, (code) => {
    exitCode.value = code;
  });
  return { program, exitCode };
}

async function runArgs(program: Command, args: string[]): Promise<void> {
  await program.parseAsync(["node", "pi-studio", ...args]);
}

describe("runUpdate", () => {
  it("reports up to date and installs nothing when already on the latest version", async () => {
    let installCalls = 0;
    const runtime = fakeRuntime({
      getLatestVersion: async () => CURRENT_VERSION,
      installGlobal: async () => {
        installCalls += 1;
      },
    });
    const { ctx, out } = ctxWith(runtime);
    const code = await runUpdate(ctx, {});
    expect(out).toEqual([`already up to date (${CURRENT_VERSION})`]);
    expect(installCalls).toBe(0);
    expect(code).toBe(0);
  });

  it("installs the newer version when one is available", async () => {
    let installedArgs: [string, string] | undefined;
    const runtime = fakeRuntime({
      getLatestVersion: async () => "99.0.0",
      installGlobal: async (pkg, version) => {
        installedArgs = [pkg, version];
      },
    });
    const { ctx, out } = ctxWith(runtime);
    const code = await runUpdate(ctx, {});
    expect(installedArgs).toEqual(["@av-pi-studio/cli", "99.0.0"]);
    expect(out.some((l) => l.includes(`${CURRENT_VERSION} -> 99.0.0`))).toBe(true);
    expect(out.some((l) => l.includes("updated to 99.0.0"))).toBe(true);
    expect(code).toBe(0);
  });

  it("--check reports availability without installing", async () => {
    let installCalls = 0;
    const runtime = fakeRuntime({
      getLatestVersion: async () => "99.0.0",
      installGlobal: async () => {
        installCalls += 1;
      },
    });
    const { ctx, out } = ctxWith(runtime);
    const code = await runUpdate(ctx, { check: true });
    expect(out).toEqual([`update available: ${CURRENT_VERSION} -> 99.0.0`]);
    expect(installCalls).toBe(0);
    expect(code).toBe(0);
  });

  it("reports an error exit code when the registry is unreachable", async () => {
    const runtime = fakeRuntime({ getLatestVersion: async () => null });
    const { ctx, err } = ctxWith(runtime);
    const code = await runUpdate(ctx, {});
    expect(err.some((l) => l.includes("could not reach npm"))).toBe(true);
    expect(code).toBe(1);
  });

  it("reports an error exit code when the global install fails", async () => {
    const runtime = fakeRuntime({
      getLatestVersion: async () => "99.0.0",
      installGlobal: async () => {
        throw new Error("EACCES: permission denied");
      },
    });
    const { ctx, err } = ctxWith(runtime);
    const code = await runUpdate(ctx, {});
    expect(err.some((l) => l.includes("EACCES"))).toBe(true);
    expect(code).toBe(1);
  });
});

describe("`update` command", () => {
  it("dispatches to runUpdate and reports its exit code", async () => {
    const runtime = fakeRuntime({ getLatestVersion: async () => "99.0.0" });
    const { ctx, out } = ctxWith(runtime);
    const { program, exitCode } = buildUpdateProgram(ctx);
    await runArgs(program, ["update"]);
    expect(out.some((l) => l.includes("updated to 99.0.0"))).toBe(true);
    expect(exitCode.value).toBe(0);
  });

  it("passes --check through to runUpdate", async () => {
    let installCalls = 0;
    const runtime = fakeRuntime({
      getLatestVersion: async () => "99.0.0",
      installGlobal: async () => {
        installCalls += 1;
      },
    });
    const { ctx, out } = ctxWith(runtime);
    const { program, exitCode } = buildUpdateProgram(ctx);
    await runArgs(program, ["update", "--check"]);
    expect(out).toEqual([`update available: ${CURRENT_VERSION} -> 99.0.0`]);
    expect(installCalls).toBe(0);
    expect(exitCode.value).toBe(0);
  });
});
