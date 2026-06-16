import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentStreamEvent } from "@av-pi-studio/protocol";
import { describe, expect, it } from "vitest";

import { PiAgentClient } from "./agent.js";
import { mapPiEvent, mapToolCall } from "./event-mapper.js";
import type { PiRpcTransport, PiTransportSpawnArgs } from "./rpc-transport.js";

/** A fake transport: records commands and scripts real Pi RPC events on `prompt`. */
class FakeTransport implements PiRpcTransport {
  readonly requests: string[] = [];
  readonly notifies: string[] = [];
  private readonly eventCbs = new Set<(e: unknown) => void>();

  constructor(public readonly spawnArgs: PiTransportSpawnArgs) {}

  request(command: string): Promise<unknown> {
    this.requests.push(command);
    if (command === "get_available_models") {
      return Promise.resolve({ models: [{ id: "pi-sonnet", name: "Sonnet" }] });
    }
    return Promise.resolve({});
  }

  notify(command: string): void {
    this.notifies.push(command);
    if (command === "prompt") {
      // Real Pi RPC event sequence (docs/rpc.md).
      this.fire({ type: "agent_start" });
      this.fire({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "hi from pi" },
      });
      this.fire({
        type: "tool_execution_start",
        toolCallId: "c1",
        toolName: "shell",
        args: { command: "ls" },
      });
      this.fire({
        type: "tool_execution_end",
        toolCallId: "c1",
        toolName: "shell",
        args: { command: "ls" },
        isError: false,
      });
      this.fire({ type: "agent_end" });
    }
    if (command === "abort") this.fire({ type: "agent_end" });
  }

  private fire(event: unknown): void {
    for (const cb of this.eventCbs) cb(event);
  }

  onEvent(cb: (e: unknown) => void): () => void {
    this.eventCbs.add(cb);
    return () => this.eventCbs.delete(cb);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

function clientWithFake(extra?: Record<string, unknown>): {
  client: PiAgentClient;
  spawns: FakeTransport[];
} {
  const spawns: FakeTransport[] = [];
  const client = new PiAgentClient({
    command: ["pi", "--mode", "rpc"], // pin so assertions don't depend on bundled-CLI resolution
    transportFactory: (args) => {
      const t = new FakeTransport(args);
      spawns.push(t);
      return t;
    },
    binaryResolver: () => true,
    ...extra,
  });
  return { client, spawns };
}

describe("event mapper", () => {
  it("maps tool names to ToolCallDetail kinds", () => {
    expect(mapToolCall({ name: "bash", input: { command: "ls" } })).toEqual({
      kind: "shell",
      command: "ls",
    });
    expect(mapToolCall({ name: "read_file", input: { path: "/x" } })).toEqual({
      kind: "read",
      path: "/x",
    });
    expect(mapToolCall({ name: "totally_unknown" })).toEqual({
      kind: "task",
      description: "totally_unknown",
    });
  });

  it("maps real Pi events and ignores unknown ones", () => {
    expect(mapPiEvent({ type: "agent_start" })).toEqual({ kind: "turn_started" });
    expect(mapPiEvent({ type: "agent_end" })).toEqual({ kind: "turn_completed" });
    expect(
      mapPiEvent({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "hello" },
      }),
    ).toEqual({ kind: "assistant_message", text: "hello" });
    expect(mapPiEvent({ type: "noise" })).toBeNull();
    expect(mapPiEvent({ type: "turn_end" })).toBeNull();
  });
});

describe("PiAgentClient", () => {
  it("createSession spawns the process and streams a mapped turn", async () => {
    const { client, spawns } = clientWithFake();
    const session = await client.createSession({ provider: "pi", cwd: "/work" });
    const events: AgentStreamEvent[] = [];
    session.subscribe((e) => events.push(e));
    await session.run("do it");

    expect(spawns).toHaveLength(1);
    expect(spawns[0]?.spawnArgs.cwd).toBe("/work");
    expect(spawns[0]?.notifies).toContain("prompt");
    expect(events.map((e) => e.kind)).toEqual([
      "turn_started",
      "assistant_message",
      "tool_call",
      "tool_call",
      "turn_completed",
    ]);
    const tool = events.find((e) => e.kind === "tool_call");
    expect(tool && tool.kind === "tool_call" ? tool.tool : null).toEqual({
      kind: "shell",
      command: "ls",
    });
  });

  it("passes system prompts via --append-system-prompt (not replacing Pi's prompt)", async () => {
    const { client, spawns } = clientWithFake();
    await client.createSession({ provider: "pi", cwd: "/work", systemPrompt: "be terse" });
    const args = spawns[0]?.spawnArgs.args ?? [];
    expect(args).toEqual(["pi", "--mode", "rpc", "--append-system-prompt", "be terse"]);
    expect(args).not.toContain("--system-prompt");
  });

  it("isAvailable() is false when pi is not resolvable", () => {
    const offline = new PiAgentClient({ binaryResolver: () => false });
    expect(offline.isAvailable()).toBe(false);
    const fakePathClient = new PiAgentClient({ command: ["definitely-not-a-real-binary-xyz"] });
    expect(fakePathClient.isAvailable()).toBe(false);
  });

  it("discovers models via get_available_models, not a scratch prompt", async () => {
    const { client, spawns } = clientWithFake();
    const models = await client.listModels();
    const modes = await client.listModes();
    expect(models).toEqual([{ id: "pi-sonnet", label: "Sonnet" }]);
    expect(modes).toEqual([]); // pi has no list_modes RPC
    for (const t of spawns) {
      expect(t.notifies).not.toContain("prompt");
    }
    expect(spawns.flatMap((t) => t.requests)).toEqual(["get_available_models"]);
  });

  it("interrupt aborts the active turn", async () => {
    const { client } = clientWithFake();
    const session = await client.createSession({ provider: "pi", cwd: "/work" });
    const events: AgentStreamEvent[] = [];
    session.subscribe((e) => events.push(e));
    await session.interrupt();
    expect(events.map((e) => e.kind)).toContain("turn_completed");
  });
});

describe("import & resume", () => {
  it("enumerates JSONL session files and resumes using the file as nativeHandle", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-sessions-"));
    const fileA = join(dir, "a.jsonl");
    writeFileSync(fileA, `${JSON.stringify({ cwd: "/work", title: "Session A", prompt: "hi" })}\n`);
    writeFileSync(join(dir, "b.jsonl"), `${JSON.stringify({ cwd: "/other" })}\n`);
    writeFileSync(join(dir, "ignore.txt"), "nope");

    const { client, spawns } = clientWithFake({ sessionDir: dir });
    const rows = await client.listImportableSessions();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.providerHandleId === fileA)?.title).toBe("Session A");

    const result = await client.importSession({ providerHandleId: fileA, cwd: "/work" });
    expect(result.persistence.nativeHandle).toBe(fileA);
    expect(spawns.at(-1)?.spawnArgs.sessionFile).toBe(fileA);
  });
});
