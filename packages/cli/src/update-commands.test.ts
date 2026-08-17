import { describe, expect, it } from "vitest";
import { Command } from "commander";

import type { CliContext } from "./cli-core.js";
import { connectDaemon } from "./connection.js";
import type { PiRuntime } from "./pi-commands.js";
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

function fakePiRuntime(overrides: Partial<PiRuntime> = {}): PiRuntime {
  return {
    spawn: async () => 0,
    resolveBundled: () => "/bundled/pi-coding-agent/dist/cli.js",
    onPath: () => false,
    ...overrides,
  };
}

function ctxWith(
  update: UpdateRuntime,
  pi: PiRuntime = fakePiRuntime(),
): { ctx: CliContext; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const ctx: CliContext = {
    connect: (opts) => connectDaemon(opts),
    sink: { write: (l) => out.push(l), error: (l) => err.push(l) },
    update,
    pi,
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
  it("reports up to date, installs nothing, and still updates pi extensions when already latest", async () => {
    let installCalls = 0;
    const runtime = fakeRuntime({
      getLatestVersion: async () => CURRENT_VERSION,
      installGlobal: async () => {
        installCalls += 1;
      },
    });
    let piCommand: string[] | undefined;
    const pi = fakePiRuntime({
      spawn: async (opts) => {
        piCommand = opts.command;
        return 0;
      },
    });
    const { ctx, out } = ctxWith(runtime, pi);
    const code = await runUpdate(ctx, {});
    expect(out).toEqual([
      `already up to date (${CURRENT_VERSION})`,
      "updating pi extensions: pi update --extensions ...",
    ]);
    expect(installCalls).toBe(0);
    expect(piCommand).toEqual([
      process.execPath,
      "/bundled/pi-coding-agent/dist/cli.js",
      "update",
      "--extensions",
    ]);
    expect(code).toBe(0);
  });

  it("installs the newer version when one is available, then updates pi extensions", async () => {
    let installedArgs: [string, string] | undefined;
    const runtime = fakeRuntime({
      getLatestVersion: async () => "99.0.0",
      installGlobal: async (pkg, version) => {
        installedArgs = [pkg, version];
      },
    });
    let piCalls = 0;
    const pi = fakePiRuntime({
      spawn: async () => {
        piCalls += 1;
        return 0;
      },
    });
    const { ctx, out } = ctxWith(runtime, pi);
    const code = await runUpdate(ctx, {});
    expect(installedArgs).toEqual(["@av-pi-studio/cli", "99.0.0"]);
    expect(out.some((l) => l.includes(`${CURRENT_VERSION} -> 99.0.0`))).toBe(true);
    expect(out.some((l) => l.includes("updated to 99.0.0"))).toBe(true);
    expect(out.some((l) => l.includes("pi update --extensions"))).toBe(true);
    expect(piCalls).toBe(1);
    expect(code).toBe(0);
  });

  it("--check reports availability without installing or touching pi extensions", async () => {
    let installCalls = 0;
    let piCalls = 0;
    const runtime = fakeRuntime({
      getLatestVersion: async () => "99.0.0",
      installGlobal: async () => {
        installCalls += 1;
      },
    });
    const pi = fakePiRuntime({
      spawn: async () => {
        piCalls += 1;
        return 0;
      },
    });
    const { ctx, out } = ctxWith(runtime, pi);
    const code = await runUpdate(ctx, { check: true });
    expect(out).toEqual([`update available: ${CURRENT_VERSION} -> 99.0.0`]);
    expect(installCalls).toBe(0);
    expect(piCalls).toBe(0);
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

  it("reports an error exit code when the pi extensions update fails, even if the CLI is up to date", async () => {
    const runtime = fakeRuntime({ getLatestVersion: async () => CURRENT_VERSION });
    const pi = fakePiRuntime({ spawn: async () => 1 });
    const { ctx, out } = ctxWith(runtime, pi);
    const code = await runUpdate(ctx, {});
    expect(out).toContain(`already up to date (${CURRENT_VERSION})`);
    expect(code).toBe(1);
  });

  it("reports an error exit code when no embedded/global pi CLI is found for the extensions step", async () => {
    const runtime = fakeRuntime({ getLatestVersion: async () => CURRENT_VERSION });
    const pi = fakePiRuntime({ resolveBundled: () => null, onPath: () => false });
    const { ctx, err } = ctxWith(runtime, pi);
    const code = await runUpdate(ctx, {});
    expect(err.some((l) => l.includes("embedded Pi CLI not found"))).toBe(true);
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
