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

  request(command: string, params?: Record<string, unknown>): Promise<unknown> {
    this.requests.push(command);
    switch (command) {
      case "get_available_models":
        return Promise.resolve({ models: [{ id: "pi-sonnet", name: "Sonnet" }] });
      case "get_session_stats":
        return Promise.resolve({ sessionId: "s1", totalMessages: 4, tokens: { total: 100 } });
      case "compact":
        return Promise.resolve({
          summary: "compacted",
          firstKeptEntryId: "e1",
          tokensBefore: 1000,
          customInstructions: params?.customInstructions,
        });
      case "new_session":
        return Promise.resolve({ cancelled: false });
      case "switch_session":
        return Promise.resolve({ cancelled: false, sessionPath: params?.sessionPath });
      case "fork":
        return Promise.resolve({ text: "forked text", cancelled: false, entryId: params?.entryId });
      case "get_fork_messages":
        return Promise.resolve({ messages: [{ entryId: "e1", text: "first" }] });
      case "clone":
        return Promise.resolve({ cancelled: false });
      case "set_session_name":
        return Promise.resolve({});
      case "export_html":
        return Promise.resolve({ path: params?.outputPath ?? "/tmp/session.html" });
      case "set_model":
        return Promise.resolve({ id: params?.modelId, provider: params?.provider });
      case "cycle_model":
        return Promise.resolve({ model: { id: "next-model" }, thinkingLevel: "medium" });
      case "get_last_assistant_text":
        return Promise.resolve({ text: "last reply" });
      default:
        return Promise.resolve({});
    }
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
    if (command === "steer") this.fire({ type: "queue_update", steering: ["steered"], followUp: [] });
    if (command === "follow_up") {
      this.fire({ type: "queue_update", steering: [], followUp: ["later"] });
    }
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

  it("extracts the edit diff and output from a tool_execution_end result (real Pi shape: no args, patch in result.details)", () => {
    const endEvent = {
      type: "tool_execution_end",
      toolCallId: "c-edit",
      toolName: "edit",
      result: {
        content: [{ type: "text", text: "Successfully replaced 1 block(s) in demo.txt." }],
        details: {
          patch:
            "--- demo.txt\n+++ demo.txt\n@@ -1,3 +1,3 @@\n line1\n-CHANGED\n+CHANGED3\n line3\n",
        },
      },
      isError: false,
    };
    expect(mapPiEvent(endEvent)).toEqual({
      kind: "tool_call",
      callId: "c-edit",
      tool: {
        kind: "edit",
        path: undefined,
        diff: "--- demo.txt\n+++ demo.txt\n@@ -1,3 +1,3 @@\n line1\n-CHANGED\n+CHANGED3\n line3\n",
        output: "Successfully replaced 1 block(s) in demo.txt.",
      },
      status: "completed",
    });
  });

  it("extracts shell stdout from a tool_execution_end result", () => {
    const endEvent = {
      type: "tool_execution_end",
      toolCallId: "c-sh",
      toolName: "bash",
      result: { content: [{ type: "text", text: "total 48\ndrwxr-xr-x" }] },
      isError: false,
    };
    expect(mapPiEvent(endEvent)).toEqual({
      kind: "tool_call",
      callId: "c-sh",
      tool: { kind: "shell", command: undefined, output: "total 48\ndrwxr-xr-x" },
      status: "completed",
    });
  });

  it("leaves output undefined on tool_execution_start (no result yet)", () => {
    expect(
      mapPiEvent({ type: "tool_execution_start", toolCallId: "c1", toolName: "bash", args: {} }),
    ).toEqual({
      kind: "tool_call",
      callId: "c1",
      tool: { kind: "shell", command: undefined },
      status: "running",
    });
  });

  it("reads toolName + args from a tool_execution_start (real Pi shape)", () => {
    expect(
      mapPiEvent({
        type: "tool_execution_start",
        toolCallId: "c-sh",
        toolName: "bash",
        args: { command: "echo hi" },
      }),
    ).toEqual({
      kind: "tool_call",
      callId: "c-sh",
      tool: { kind: "shell", command: "echo hi" },
      status: "running",
    });
  });

  it("maps queue_update to a queue_update stream event with steering/followUp arrays", () => {
    expect(
      mapPiEvent({
        type: "queue_update",
        steering: ["Focus on error handling"],
        followUp: ["After that, summarize"],
      }),
    ).toEqual({
      kind: "queue_update",
      steering: ["Focus on error handling"],
      followUp: ["After that, summarize"],
    });
  });

  it("maps an empty queue_update to empty arrays", () => {
    expect(mapPiEvent({ type: "queue_update" })).toEqual({
      kind: "queue_update",
      steering: [],
      followUp: [],
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

  it("steer sends a `steer` notify and surfaces the mapped queue_update", async () => {
    const { client, spawns } = clientWithFake();
    const session = await client.createSession({ provider: "pi", cwd: "/work" });
    const events: AgentStreamEvent[] = [];
    session.subscribe((e) => events.push(e));
    await session.steer!("focus on error handling");
    expect(spawns[0]?.notifies).toContain("steer");
    expect(events).toContainEqual({ kind: "queue_update", steering: ["steered"], followUp: [] });
  });

  it("followUp sends a `follow_up` notify and surfaces the mapped queue_update", async () => {
    const { client, spawns } = clientWithFake();
    const session = await client.createSession({ provider: "pi", cwd: "/work" });
    const events: AgentStreamEvent[] = [];
    session.subscribe((e) => events.push(e));
    await session.followUp!("then summarize");
    expect(spawns[0]?.notifies).toContain("follow_up");
    expect(events).toContainEqual({ kind: "queue_update", steering: [], followUp: ["later"] });
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
    // The freshly spawned process must actually load that file's history — RPC mode has no CLI
    // flag to preload a session at spawn, only the `switch_session` command (docs/rpc.md).
    // Asserting just the sessionFile plumbing (above) previously let this regress silently: the
    // spawn args looked right while the live process never got a `switch_session` request at all.
    expect(spawns.at(-1)?.requests).toContain("switch_session");
  });

  it("resumeSession loads the persisted history into the freshly spawned process via switch_session", async () => {
    const { client, spawns } = clientWithFake();
    const session = await client.resumeSession(
      { provider: "pi", sessionId: "s1", nativeHandle: "/tmp/prior-conversation.jsonl" },
      { cwd: "/work" },
      { cwd: "/work" },
    );
    expect(spawns).toHaveLength(1);
    expect(spawns[0]?.requests).toContain("switch_session");
    expect(session.describePersistence()?.nativeHandle).toBe("/tmp/prior-conversation.jsonl");
  });

  it("createSession (a brand-new, non-resumed session) never sends switch_session", async () => {
    const { client, spawns } = clientWithFake();
    await client.createSession({ provider: "pi", cwd: "/work" });
    expect(spawns[0]?.requests).not.toContain("switch_session");
  });
});

describe("slash-command operations (sprint-037)", () => {
  it("getSessionStats issues get_session_stats and maps the response", async () => {
    const { client, spawns } = clientWithFake();
    const session = await client.createSession({ provider: "pi", cwd: "/work" });
    const stats = await session.getSessionStats?.();
    expect(stats).toEqual({ sessionId: "s1", totalMessages: 4, tokens: { total: 100 } });
    expect(spawns[0]?.requests).toContain("get_session_stats");
  });

  it("compact forwards customInstructions and maps the response", async () => {
    const { client } = clientWithFake();
    const session = await client.createSession({ provider: "pi", cwd: "/work" });
    const result = await session.compact?.("focus on code");
    expect(result?.summary).toBe("compacted");
    expect(result?.tokensBefore).toBe(1000);
  });

  it("newSession/clone/switchSession return {cancelled}", async () => {
    const { client } = clientWithFake();
    const session = await client.createSession({ provider: "pi", cwd: "/work" });
    expect(await session.newSession?.()).toEqual({ cancelled: false });
    expect(await session.clone?.()).toEqual({ cancelled: false });
    expect(await session.switchSession?.("/tmp/other.jsonl")).toEqual({ cancelled: false });
  });

  it("fork returns text+cancelled; getForkMessages lists entries", async () => {
    const { client } = clientWithFake();
    const session = await client.createSession({ provider: "pi", cwd: "/work" });
    expect(await session.fork?.("e1")).toEqual({ text: "forked text", cancelled: false });
    expect(await session.getForkMessages?.()).toEqual([{ entryId: "e1", text: "first" }]);
  });

  it("setSessionName issues set_session_name; exportHtml maps path", async () => {
    const { client, spawns } = clientWithFake();
    const session = await client.createSession({ provider: "pi", cwd: "/work" });
    await session.setSessionName?.("my-feature-work");
    expect(spawns[0]?.requests).toContain("set_session_name");
    const exported = await session.exportHtml?.();
    expect(exported).toEqual({ path: "/tmp/session.html" });
  });

  it("setProviderModel issues set_model with provider+modelId; cycleModel maps the response", async () => {
    const { client, spawns } = clientWithFake();
    const session = await client.createSession({ provider: "pi", cwd: "/work" });
    await session.setProviderModel?.("anthropic", "claude-sonnet-4-20250514");
    expect(spawns[0]?.requests).toContain("set_model");
    const cycled = await session.cycleModel?.();
    expect(cycled).toEqual({ model: { id: "next-model" }, thinkingLevel: "medium" });
  });

  it("getLastAssistantText returns the mapped text", async () => {
    const { client } = clientWithFake();
    const session = await client.createSession({ provider: "pi", cwd: "/work" });
    expect(await session.getLastAssistantText?.()).toBe("last reply");
  });
});
