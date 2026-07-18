import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { Command } from "commander";

import type { CliContext } from "./cli-core.js";
import { connectDaemon } from "./connection.js";
import {
  DEFAULT_RELAY_PORT,
  RELAY_PID_FILE,
  type RelayRuntime,
  readRelayPid,
  relayStatus,
  stopRelay,
  waitForRelay,
} from "./relay-control.js";
import { parseRelayListen, registerRelayCommands, runRelayStart } from "./relay-commands.js";

function fakeRuntime(overrides: Partial<RelayRuntime> = {}): RelayRuntime {
  return {
    probe: async () => false,
    kill: () => true,
    start: async () => 5151,
    ...overrides,
  };
}

function ctxWith(home: string, relay: RelayRuntime): { ctx: CliContext; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const ctx: CliContext = {
    connect: (opts) => connectDaemon(opts),
    sink: { write: (l) => out.push(l), error: (l) => err.push(l) },
    relay,
    connectOverrides: { home },
  };
  return { ctx, out, err };
}

function tmpHome(): string {
  return mkdtempSync(join(tmpdir(), "pi-cli-relay-"));
}

const noSleep = () => Promise.resolve();

/** Build a program with just the `relay` group registered, and drive it programmatically. */
function buildRelayProgram(ctx: CliContext): { program: Command; exitCode: { value: number | undefined } } {
  const program = new Command();
  program
    .exitOverride()
    .option("-H, --host <host>")
    .option("--home <dir>")
    .option("--json", "", false);
  const exitCode: { value: number | undefined } = { value: undefined };
  registerRelayCommands(program, ctx, (code) => {
    exitCode.value = code;
  });
  return { program, exitCode };
}

async function runArgs(program: Command, args: string[]): Promise<void> {
  await program.parseAsync(["node", "pi-studio", ...args]);
}

// ─── parseRelayListen ──────────────────────────────────────────────────────────

describe("parseRelayListen", () => {
  it("defaults to 0.0.0.0:7000 when no value given", () => {
    expect(parseRelayListen(undefined)).toEqual({ host: "0.0.0.0", port: DEFAULT_RELAY_PORT });
  });
  it("parses host:port", () => {
    expect(parseRelayListen("192.168.1.39:7000")).toEqual({ host: "192.168.1.39", port: 7000 });
  });
  it("defaults the port when only a host is given", () => {
    expect(parseRelayListen("192.168.1.39")).toEqual({ host: "192.168.1.39", port: DEFAULT_RELAY_PORT });
  });
  it("defaults the host when the value starts with a bare port", () => {
    expect(parseRelayListen(":7500")).toEqual({ host: "0.0.0.0", port: 7500 });
  });
});

// ─── relayStatus ───────────────────────────────────────────────────────────────

describe("relayStatus", () => {
  it("reports up when the probe succeeds", async () => {
    const res = await relayStatus(fakeRuntime({ probe: async () => true }), "127.0.0.1", 7000);
    expect(res).toEqual({ up: true, host: "127.0.0.1", port: 7000 });
  });
  it("reports down when the probe fails", async () => {
    const res = await relayStatus(fakeRuntime({ probe: async () => false }), "h", 1);
    expect(res.up).toBe(false);
  });
});

// ─── stopRelay ─────────────────────────────────────────────────────────────────

describe("stopRelay", () => {
  it("returns false when no pid file exists", () => {
    expect(stopRelay(tmpHome(), fakeRuntime())).toBe(false);
  });
  it("kills the recorded pid and returns true", async () => {
    const home = tmpHome();
    let killedPid: number | undefined;
    const runtime = fakeRuntime({
      start: async ({ home: h }) => {
        // Mirror subprocessRelayStarter's own pid-writing side effect for this fake.
        writeFileSync(join(h, RELAY_PID_FILE), "9999", "utf8");
        return 9999;
      },
      kill: (pid) => {
        killedPid = pid;
        return true;
      },
    });
    await runtime.start({ home, listen: "0.0.0.0:7000" });
    expect(readRelayPid(home)).toBe(9999);
    expect(stopRelay(home, runtime)).toBe(true);
    expect(killedPid).toBe(9999);
  });
});

// ─── waitForRelay ──────────────────────────────────────────────────────────────

describe("waitForRelay", () => {
  it("resolves true as soon as the probe succeeds", async () => {
    let calls = 0;
    const runtime = fakeRuntime({
      probe: async () => {
        calls += 1;
        return calls >= 3;
      },
    });
    const ok = await waitForRelay(runtime, "h", 1, { sleep: noSleep, attempts: 10 });
    expect(ok).toBe(true);
    expect(calls).toBe(3);
  });

  it("resolves false after exhausting attempts", async () => {
    const runtime = fakeRuntime({ probe: async () => false });
    const ok = await waitForRelay(runtime, "h", 1, { sleep: noSleep, attempts: 3 });
    expect(ok).toBe(false);
  });
});

// ─── `relay status` command ────────────────────────────────────────────────────

describe("relay status command", () => {
  it("prints up/down and sets the matching exit code", async () => {
    const home = tmpHome();
    const { ctx, out } = ctxWith(home, fakeRuntime({ probe: async () => true }));
    const { program, exitCode } = buildRelayProgram(ctx);
    await runArgs(program, ["relay", "status", "--listen", "127.0.0.1:7000"]);
    expect(out).toEqual(["relay up at 127.0.0.1:7000"]);
    expect(exitCode.value).toBe(0);
  });

  it("reports down with a non-zero exit code", async () => {
    const home = tmpHome();
    const { ctx, out } = ctxWith(home, fakeRuntime({ probe: async () => false }));
    const { program, exitCode } = buildRelayProgram(ctx);
    await runArgs(program, ["relay", "status", "--listen", "127.0.0.1:7000"]);
    expect(out).toEqual(["relay down at 127.0.0.1:7000"]);
    expect(exitCode.value).toBe(1);
  });
});

// ─── `relay start` command ─────────────────────────────────────────────────────

describe("relay start command", () => {
  it("starts the relay and reports the listen URL once healthy", async () => {
    const home = tmpHome();
    let started = false;
    const runtime = fakeRuntime({
      probe: async () => started,
      start: async () => {
        started = true;
        return 4242;
      },
    });
    const { ctx, out } = ctxWith(home, runtime);
    const { program, exitCode } = buildRelayProgram(ctx);
    await runArgs(program, ["relay", "start", "--listen", "127.0.0.1:7000"]);
    expect(out).toEqual([
      "relay listening on ws://127.0.0.1:7000 (health: http://127.0.0.1:7000/health)",
    ]);
    expect(exitCode.value).toBe(0);
  });

  it("no-ops with a message if a relay is already running at that address", async () => {
    const home = tmpHome();
    let startCalls = 0;
    const runtime = fakeRuntime({
      probe: async () => true,
      start: async () => {
        startCalls += 1;
        return 4242;
      },
    });
    const { ctx, out } = ctxWith(home, runtime);
    const { program, exitCode } = buildRelayProgram(ctx);
    await runArgs(program, ["relay", "start", "--listen", "127.0.0.1:7000"]);
    expect(out).toEqual(["relay already running at ws://127.0.0.1:7000"]);
    expect(startCalls).toBe(0);
    expect(exitCode.value).toBe(0);
  });

  it("reports an error exit code when the relay never becomes healthy", async () => {
    const home = tmpHome();
    const runtime = fakeRuntime({ probe: async () => false, start: async () => 4242 });
    const { ctx, err } = ctxWith(home, runtime);
    const code = await runRelayStart(ctx, { home }, "127.0.0.1:7000", { sleep: () => Promise.resolve() });
    expect(err.some((l) => l.includes("did not become healthy"))).toBe(true);
    expect(code).toBe(1);
  });
});

// ─── `relay stop` command ──────────────────────────────────────────────────────

describe("relay stop command", () => {
  it("reports no running relay when there is no pid file", async () => {
    const home = tmpHome();
    const { ctx, out } = ctxWith(home, fakeRuntime());
    const { program, exitCode } = buildRelayProgram(ctx);
    await runArgs(program, ["relay", "stop"]);
    expect(out).toEqual(["no running relay found"]);
    expect(exitCode.value).toBe(1);
  });
});
