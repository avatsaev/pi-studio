import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Command } from "commander";

import type { CliContext } from "./cli-core.js";
import { connectDaemon } from "./connection.js";
import type { DaemonRuntime } from "./daemon-control.js";
import type { PiRuntime } from "./pi-commands.js";
import type { UpdateRuntime } from "./update-control.js";
import { CURRENT_VERSION } from "./update-control.js";
import { registerUpdateCommands, runUpdate } from "./update-commands.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "pi-studio-update-test-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

/** A daemon runtime that never touches a real process or port; `up` flips on start/kill. */
function fakeDaemon(
  state: { up: boolean; version: string },
  log: string[],
  overrides: Partial<DaemonRuntime> = {},
): DaemonRuntime {
  return {
    probe: async () => state.up,
    hash: (p) => p,
    kill: (pid) => (log.push(`kill:${pid}`), (state.up = false), true),
    start: async ({ listen }) => (log.push(`start:${listen}`), (state.up = true), 4242),
    waitForExit: async () => true,
    readVersion: async () => state.version,
    ...overrides,
  };
}

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
  daemon?: DaemonRuntime,
): { ctx: CliContext; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const ctx: CliContext = {
    connect: (opts) => connectDaemon(opts),
    sink: { write: (l) => out.push(l), error: (l) => err.push(l) },
    update,
    pi,
    daemon,
    connectOverrides: { home },
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
    const { ctx, out } = ctxWith(runtime, pi, fakeDaemon({ up: false, version: "99.0.0" }, []));
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

describe("runUpdate daemon restart", () => {
  const newer = fakeRuntime({ getLatestVersion: async () => "99.0.0" });

  it("restarts a running daemon on the same host and port and prints the answering version", async () => {
    writeFileSync(join(home, "pi-studio.pid"), "777", "utf8");
    const log: string[] = [];
    const state = { up: true, version: "99.0.0" };
    const { ctx, out } = ctxWith(newer, fakePiRuntime(), fakeDaemon(state, log));
    const code = await runUpdate(ctx, { host: "127.0.0.1:7001" });
    expect(log).toEqual(["kill:777", "start:127.0.0.1:7001"]);
    expect(out).toContain("daemon restarted: 99.0.0");
    expect(code).toBe(0);
  });

  it("does not start a daemon when none runs", async () => {
    const log: string[] = [];
    const { ctx, out } = ctxWith(
      newer,
      fakePiRuntime(),
      fakeDaemon({ up: false, version: "99.0.0" }, log),
    );
    const code = await runUpdate(ctx, {});
    expect(log).toEqual([]);
    expect(out.some((l) => l.includes("daemon restarted"))).toBe(false);
    expect(code).toBe(0);
  });

  it("does not restart when the install failed", async () => {
    const log: string[] = [];
    const failing = fakeRuntime({
      getLatestVersion: async () => "99.0.0",
      installGlobal: async () => {
        throw new Error("EACCES");
      },
    });
    const { ctx } = ctxWith(failing, fakePiRuntime(), fakeDaemon({ up: true, version: "1" }, log));
    const code = await runUpdate(ctx, {});
    expect(log).toEqual([]);
    expect(code).toBe(1);
  });

  it("exits non-zero with the reason when the daemon does not exit, keeping the install", async () => {
    writeFileSync(join(home, "pi-studio.pid"), "777", "utf8");
    const log: string[] = [];
    const { ctx, err, out } = ctxWith(
      newer,
      fakePiRuntime(),
      fakeDaemon({ up: true, version: "1" }, log, { waitForExit: async () => false }),
    );
    const code = await runUpdate(ctx, {});
    expect(out).toContain("updated to 99.0.0");
    expect(
      err.some((l) => l.includes("daemon restart failed") && l.includes("still running")),
    ).toBe(true);
    expect(log).toEqual(["kill:777"]);
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
