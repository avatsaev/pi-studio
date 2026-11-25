import type { AgentStreamEvent } from "@av-pi-studio/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PiAgentClient } from "./agent.js";
import { createProcessTransport } from "./rpc-transport.js";

import type { PiRpcTransport } from "./rpc-transport.js";

/** A child that stays up and never answers a request. */
const SILENT_PI = "setInterval(() => {}, 1000);";

/** Collects the pid the transport logs when it spawns, and every logged message. */
function recordingLogger() {
  const state = { pid: undefined as number | undefined, exits: [] as Record<string, unknown>[] };
  const logger = {
    info: (fields: unknown, message?: string) => {
      if (message === "pi process spawned") state.pid = (fields as { pid: number }).pid;
      if (message === "pi process exited") state.exits.push(fields as never);
    },
    warn: () => {},
    error: () => {},
  };
  return { state, logger };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const transports: PiRpcTransport[] = [];
function track(transport: PiRpcTransport): PiRpcTransport {
  transports.push(transport);
  return transport;
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(transports.splice(0).map((t) => t.close()));
});

describe("createProcessTransport — request timeouts", () => {
  it("rejects a request Pi never answers, naming the command, and leaves the process running", async () => {
    const { state, logger } = recordingLogger();
    const transport = track(
      createProcessTransport(
        { args: [process.execPath, "-e", SILENT_PI], cwd: ".", env: {}, logger },
        { requestTimeoutMs: 1_000, longRequestTimeoutMs: 5_000 },
      ),
    );
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const stateRequest = expect(transport.request("get_state")).rejects.toThrow(
      "pi request 'get_state' timed out after 1000 ms",
    );
    // `compact` gets the longer bound: it is still waiting when the default one has passed.
    let compactSettled = false;
    const compactRequest = transport.request("compact").then(
      () => (compactSettled = true),
      () => (compactSettled = true),
    );
    vi.advanceTimersByTime(1_000);
    await stateRequest;
    expect(compactSettled).toBe(false);

    vi.advanceTimersByTime(4_000);
    await compactRequest;
    expect(compactSettled).toBe(true);
    expect(alive(state.pid as number)).toBe(true);
  });
});

describe("createProcessTransport — close", () => {
  it("rejects pending requests and SIGKILLs a process that ignores SIGTERM after the grace period", async () => {
    const { state, logger } = recordingLogger();
    const transport = track(
      createProcessTransport(
        {
          args: [
            process.execPath,
            "-e",
            "process.on('SIGTERM', () => {}); " +
              'process.stdout.write(\'{"type":"ready"}\\n\'); ' +
              SILENT_PI,
          ],
          cwd: ".",
          env: {},
          logger,
        },
        { killGraceMs: 300 },
      ),
    );
    await new Promise<void>((resolve) => {
      transport.onEvent((e) => {
        if ((e as Record<string, unknown>).type === "ready") resolve();
      });
    });
    const pid = state.pid as number;
    const pendingRequest = expect(transport.request("get_state")).rejects.toThrow(/closed/);

    const startedAt = Date.now();
    await transport.close();

    await pendingRequest;
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(250);
    expect(alive(pid)).toBe(false);
    expect(state.exits).toHaveLength(1);
    expect(state.exits[0]).toMatchObject({ signal: "SIGKILL" });
    await expect(transport.request("get_state")).rejects.toThrow();
  });

  it("returns as soon as a process that honours SIGTERM has exited", async () => {
    const { state, logger } = recordingLogger();
    const transport = track(
      createProcessTransport(
        {
          args: [
            process.execPath,
            "-e",
            "process.on('SIGTERM', () => process.exit(0)); " +
              'process.stdout.write(\'{"type":"ready"}\\n\'); ' +
              SILENT_PI,
          ],
          cwd: ".",
          env: {},
          logger,
        },
        { killGraceMs: 30_000 },
      ),
    );
    await new Promise<void>((resolve) => {
      transport.onEvent(() => resolve());
    });
    await transport.close();
    expect(alive(state.pid as number)).toBe(false);
  });
});

describe("createProcessTransport — stdout decoding", () => {
  it("delivers a 4-byte UTF-8 character split across two chunks intact", async () => {
    // The emoji's four bytes are written two and two, 100 ms apart, so they arrive as two chunks.
    const script =
      "const b = Buffer.from(JSON.stringify({ type: 'text', text: '😀' }) + '\\n');" +
      "const at = b.indexOf(0xf0) + 2;" +
      "process.stdout.write(b.subarray(0, at));" +
      "setTimeout(() => process.stdout.write(b.subarray(at)), 100);" +
      SILENT_PI;
    const transport = track(
      createProcessTransport({ args: [process.execPath, "-e", script], cwd: ".", env: {} }),
    );
    const event = await new Promise<Record<string, unknown>>((resolve) => {
      transport.onEvent((e) => resolve(e as Record<string, unknown>));
    });
    expect(event.text).toBe("😀");
  });
});

describe("PiAgentClient — top-level process", () => {
  it("closes the process it started for model listing when the request times out", async () => {
    const { state, logger } = recordingLogger();
    const client = new PiAgentClient({
      command: [process.execPath, "-e", SILENT_PI],
      binaryResolver: () => true,
      logger,
      transportFactory: (spawnArgs) => createProcessTransport(spawnArgs, { requestTimeoutMs: 200 }),
    });

    await expect(client.listModels()).rejects.toThrow(
      "pi request 'get_available_models' timed out after 200 ms",
    );

    expect(state.pid).toBeDefined();
    expect(alive(state.pid as number)).toBe(false);
  });
});

describe("PiAgentClient — a prompt Pi refuses", () => {
  /**
   * Pi's rpc mode answers every request, and refuses a turn's `prompt` (a notify, so it carries no
   * id) with a failed response and no event at all: `src/modes/rpc/rpc-mode.js` `case "prompt"`.
   */
  const REFUSING_PI =
    "require('readline').createInterface({ input: process.stdin }).on('line', (line) => {" +
    "  const command = JSON.parse(line);" +
    "  const reply = command.id !== undefined" +
    "    ? { type: 'response', id: command.id, command: command.type, success: true, data: {} }" +
    "    : { type: 'response', command: command.type, success: false, error: 'No model selected' };" +
    "  process.stdout.write(JSON.stringify(reply) + '\\n');" +
    "});";

  it("ends the turn as turn_failed with Pi's reason instead of leaving it running", async () => {
    const client = new PiAgentClient({
      command: [process.execPath, "-e", REFUSING_PI],
      binaryResolver: () => true,
      transportFactory: (spawnArgs) => track(createProcessTransport(spawnArgs)),
    });
    const session = await client.createSession({ provider: "pi", cwd: "." });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    await session.run("hello");

    expect(events).toEqual([{ kind: "turn_failed", error: "No model selected" }]);
  });
});
