import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentStreamEvent } from "@av-pi-studio/protocol";
import { describe, expect, it, vi } from "vitest";

import { PiAgentClient } from "./agent.js";
import { createPiEventMapper, mapPiEvent, mapToolCall } from "./event-mapper.js";
import type { PiRpcTransport, PiTransportSpawnArgs } from "./rpc-transport.js";

/**
 * A fake transport: records commands and scripts real Pi RPC events on `prompt`.
 *
 * `sessionFile` models Pi's real rebinding behaviour (verified against a live `pi --mode rpc`):
 * `switch_session` moves the process onto the requested file, `new_session`/`fork`/`clone` onto a
 * freshly created one, and `get_state` reports whichever file the process is writing to NOW.
 */
class FakeTransport implements PiRpcTransport {
  readonly requests: string[] = [];
  readonly notifies: string[] = [];
  sessionFile = "/tmp/fake-pi-session.jsonl";
  private readonly eventCbs = new Set<(e: unknown) => void>();

  constructor(public readonly spawnArgs: PiTransportSpawnArgs) {}

  request(command: string, params?: Record<string, unknown>): Promise<unknown> {
    this.requests.push(command);
    this.rebind(command, params);
    switch (command) {
      case "get_state":
        return Promise.resolve({
          sessionFile: this.sessionFile,
          model: { id: "claude-opus-4", name: "Opus 4" },
        });
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
      case "get_commands":
        return Promise.resolve({
          commands: [
            {
              name: "session-name",
              description: "Set or clear session name",
              source: "extension",
              sourceInfo: { path: "/home/user/.pi/agent/extensions/session.ts" },
            },
            {
              name: "fix-tests",
              description: "Fix failing tests",
              source: "prompt",
              sourceInfo: {
                scope: "project",
                path: "/home/user/myproject/.pi/agent/prompts/fix-tests.md",
              },
            },
            {
              name: "skill:brave-search",
              description: "Web search via Brave API",
              source: "skill",
              sourceInfo: {
                scope: "user",
                path: "/home/user/.pi/agent/skills/brave-search/SKILL.md",
              },
            },
          ],
        });
      default:
        return Promise.resolve({});
    }
  }

  /** Move the "process" onto whichever session file the command rebinds it to. */
  private rebind(command: string, params?: Record<string, unknown>): void {
    if (command === "switch_session" && typeof params?.sessionPath === "string") {
      this.sessionFile = params.sessionPath;
    } else if (command === "new_session" || command === "fork" || command === "clone") {
      this.sessionFile = `/tmp/rebound-${command}.jsonl`;
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
      this.fire({ type: "agent_settled" });
    }
    if (command === "abort") {
      this.fire({
        type: "agent_end",
        messages: [{ role: "assistant", content: [], stopReason: "aborted" }],
      });
      this.fire({ type: "agent_settled" });
    }
    if (command === "steer")
      this.fire({ type: "queue_update", steering: ["steered"], followUp: [] });
    if (command === "follow_up") {
      this.fire({ type: "queue_update", steering: [], followUp: ["later"] });
    }
  }

  protected fire(event: unknown): void {
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

/**
 * Regression fixture for sprint-041 (agent-turn-settlement): scripts Pi's real retry sequence —
 * an `agent_end{willRetry:true}` for a transient failure, then a SECOND low-level run (fired on a
 * later macrotask, mirroring the real subprocess's `agent.continue()` running after the current
 * script finishes) that succeeds, followed by the true terminal `agent_settled`
 * (docs/rpc.md § agent_end / § agent_settled).
 */
class RetryFakeTransport extends FakeTransport {
  override notify(command: string): void {
    this.notifies.push(command);
    if (command === "prompt") {
      this.fire({ type: "agent_start" });
      this.fire({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "attempt 1" },
      });
      // Retryable failure — Pi auto-retries instead of ending the turn.
      this.fire({
        type: "agent_end",
        willRetry: true,
        messages: [
          { role: "assistant", content: [], stopReason: "error", errorMessage: "transient 500" },
        ],
      });
      setTimeout(() => {
        this.fire({ type: "agent_start" });
        this.fire({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "attempt 2 ok" },
        });
        this.fire({
          type: "agent_end",
          willRetry: false,
          messages: [
            { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop" },
          ],
        });
        this.fire({ type: "agent_settled" });
      }, 0);
    }
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
    expect(mapPiEvent({ type: "agent_end" })).toBeNull(); // non-terminal; see agent_settled tests below
    expect(
      mapPiEvent({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "hello" },
      }),
    ).toEqual({ kind: "assistant_message", text: "hello" });
    expect(mapPiEvent({ type: "noise" })).toBeNull();
    expect(mapPiEvent({ type: "turn_end" })).toBeNull();
  });

  it("maps text_end/thinking_end to textless final block-close markers", () => {
    // These used to fall through to `null`, so the only signal a message was finished was
    // `agent_end` — an entire tool loop later. Clients render markdown off `final`.
    expect(
      mapPiEvent({
        type: "message_update",
        assistantMessageEvent: { type: "text_end", contentIndex: 0, content: "Hello world" },
      }),
    ).toEqual({ kind: "assistant_message", final: true });
    expect(
      mapPiEvent({
        type: "message_update",
        assistantMessageEvent: { type: "thinking_end", contentIndex: 0 },
      }),
    ).toEqual({ kind: "reasoning", final: true });
  });

  it("latches a failed final assistant message and emits turn_failed on settle (real repro: provider 429)", () => {
    // Regression: `agent_end` used to unconditionally report `turn_completed`, so a live turn
    // that failed with an immediate provider error (e.g. a 429 quota-exceeded rejection) was
    // silently reported as a success — no `turn_failed`/error ever reached the live stream, and
    // the daemon's own `newStatus` computation (which trusts this mapping) never learned the
    // turn failed either. Restore-from-JSONL (`session-hydration.ts`) already handled this
    // correctly by reading the same `stopReason`/`errorMessage` fields; this mirrors it live —
    // now latched at `agent_end` and reported at `agent_settled`, the true terminal.
    const mapper = createPiEventMapper();
    expect(
      mapper.map({
        type: "agent_end",
        messages: [
          { role: "user", content: [{ type: "text", text: "hi" }] },
          {
            role: "assistant",
            content: [],
            stopReason: "error",
            errorMessage: "OpenAI API error (429): 429 quota exceeded\n",
          },
        ],
      }),
    ).toBeNull();
    expect(mapper.map({ type: "agent_settled" })).toEqual({
      kind: "turn_failed",
      error: "OpenAI API error (429): 429 quota exceeded\n",
    });
  });

  it("latches an aborted final assistant message and emits turn_canceled on settle", () => {
    const mapper = createPiEventMapper();
    expect(
      mapper.map({
        type: "agent_end",
        messages: [{ role: "assistant", content: [], stopReason: "aborted" }],
      }),
    ).toBeNull();
    expect(mapper.map({ type: "agent_settled" })).toEqual({ kind: "turn_canceled" });
  });

  it("latches a clean final assistant message and emits turn_completed on settle", () => {
    const mapper = createPiEventMapper();
    expect(
      mapper.map({
        type: "agent_end",
        messages: [
          { role: "assistant", content: [{ type: "text", text: "hi" }], stopReason: "stop" },
        ],
      }),
    ).toBeNull();
    expect(mapper.map({ type: "agent_settled" })).toEqual({ kind: "turn_completed" });
  });

  it("a retry sequence (willRetry:true, then a clean retried run) yields exactly one turn_completed", () => {
    // Pi's real event sequence for an auto-retried run: agent_end{willRetry:true} → another
    // run's rows → agent_end{willRetry:false} → agent_settled (docs/rpc.md § agent_end /
    // § agent_settled). Only agent_settled is the true terminal.
    const mapper = createPiEventMapper();
    expect(mapper.map({ type: "agent_start" })).toEqual({ kind: "turn_started" });
    expect(
      mapper.map({
        type: "agent_end",
        willRetry: true,
        messages: [
          { role: "assistant", content: [], stopReason: "error", errorMessage: "transient 500" },
        ],
      }),
    ).toBeNull();
    expect(mapper.map({ type: "agent_start" })).toEqual({ kind: "turn_started" });
    expect(
      mapper.map({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "retried ok" },
      }),
    ).toEqual({ kind: "assistant_message", text: "retried ok" });
    expect(
      mapper.map({
        type: "agent_end",
        willRetry: false,
        messages: [
          { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop" },
        ],
      }),
    ).toBeNull();
    expect(mapper.map({ type: "agent_settled" })).toEqual({ kind: "turn_completed" });
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

  it("discovers sessionFile and model via get_state on createSession (sprint-042)", async () => {
    const { client, spawns } = clientWithFake();
    const session = await client.createSession({ provider: "pi", cwd: "/work" });
    expect(spawns[0]?.requests).toContain("get_state");
    expect(session.getRuntimeInfo().model).toBe("claude-opus-4");
    expect(session.describePersistence()?.nativeHandle).toBe("/tmp/fake-pi-session.jsonl");
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

  it("resolveDefaultModel spawns --no-session and asks get_state, not a scratch prompt", async () => {
    const { client, spawns } = clientWithFake();
    const resolved = await client.resolveDefaultModel();
    expect(resolved).toEqual({ provider: undefined, model: "claude-opus-4" });
    expect(spawns).toHaveLength(1);
    expect(spawns[0]?.spawnArgs.args).toContain("--no-session");
    expect(spawns[0]?.requests).toEqual(["get_state"]);
    expect(spawns[0]?.notifies).not.toContain("prompt");
  });

  it("resolveDefaultModel's --no-session spawn never touches listModels' plain top-level spawn", async () => {
    const { client, spawns } = clientWithFake();
    await client.listModels();
    await client.resolveDefaultModel();
    expect(spawns[0]?.spawnArgs.args).not.toContain("--no-session");
    expect(spawns[1]?.spawnArgs.args).toContain("--no-session");
  });

  it("interrupt aborts the active turn", async () => {
    const { client } = clientWithFake();
    const session = await client.createSession({ provider: "pi", cwd: "/work" });
    const events: AgentStreamEvent[] = [];
    session.subscribe((e) => events.push(e));
    await session.interrupt();
    expect(events.map((e) => e.kind)).toEqual(["turn_canceled"]);
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

describe("sprint-041 regression: agent turn settlement (agent_settled / willRetry)", () => {
  it("a non-final agent_end (willRetry:true) must map to null, not a terminal event", () => {
    // Pi's real event sequence for an auto-retried run: agent_end{willRetry:true} → another run →
    // agent_end{willRetry:false} → agent_settled. Only agent_settled is the true terminal; the
    // mapper currently ignores `willRetry` entirely and reports every agent_end as terminal.
    expect(
      mapPiEvent({
        type: "agent_end",
        willRetry: true,
        messages: [
          { role: "assistant", content: [], stopReason: "error", errorMessage: "transient 500" },
        ],
      }),
    ).toBeNull();
  });

  it("PiAgentSession.run() must wait for agent_settled, not resolve on an interim retried agent_end", async () => {
    vi.useFakeTimers();
    try {
      const spawns: RetryFakeTransport[] = [];
      const client = new PiAgentClient({
        command: ["pi", "--mode", "rpc"],
        transportFactory: (args) => {
          const t = new RetryFakeTransport(args);
          spawns.push(t);
          return t;
        },
        binaryResolver: () => true,
      });
      const session = await client.createSession({ provider: "pi", cwd: "/work" });
      const events: AgentStreamEvent[] = [];
      session.subscribe((e) => events.push(e));

      let resolved = false;
      void session.run("do it").then(() => {
        resolved = true;
      });

      // Flush the microtasks from the synchronous first agent_end — the retry (scheduled via
      // `setTimeout` in the fake transport, mirroring the real subprocess's async continuation
      // after the current script finishes) has NOT fired yet.
      await Promise.resolve();
      await Promise.resolve();

      // Bug: `run()` resolves on the first agent_end (willRetry:true) before the retry ever
      // streams — a caller that unsubscribes right after `await run()` (agent-service.ts's
      // runTurn) would miss attempt 2 and `agent_settled` entirely, and record the turn failed
      // even though it ultimately succeeds.
      expect(resolved).toBe(false);

      await vi.runAllTimersAsync();

      // And even ignoring timing: the turn must yield exactly one terminal event, not one per
      // agent_end (which would wrongly report `turn_failed` for a turn that ultimately succeeded).
      expect(events.map((e) => e.kind)).toEqual([
        "turn_started",
        "assistant_message",
        "turn_started",
        "assistant_message",
        "turn_completed",
      ]);
    } finally {
      vi.useRealTimers();
    }
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
    // discoverState (sprint-042) also runs for a resumed session — a fresh `pi --mode rpc`
    // process has no local model state until asked, resume included.
    expect(session.getRuntimeInfo().model).toBe("claude-opus-4");
  });

  it("resumeSession honors per-session systemPrompt from overrides (task-005)", async () => {
    const { client, spawns } = clientWithFake();
    await client.resumeSession(
      { provider: "pi", sessionId: "s1", nativeHandle: "/tmp/prior-conversation.jsonl" },
      { cwd: "/work", systemPrompt: "be concise" },
      { cwd: "/work" },
    );
    const args = spawns[0]?.spawnArgs.args ?? [];
    expect(args).toContain("--append-system-prompt");
    expect(args).toContain("be concise");
  });

  it("resumeSession falls back to deps.appendSystemPrompt when overrides has no systemPrompt (task-005)", async () => {
    const { client, spawns } = clientWithFake({
      appendSystemPrompt: "default behavior",
    });
    await client.resumeSession(
      { provider: "pi", sessionId: "s1", nativeHandle: "/tmp/prior-conversation.jsonl" },
      { cwd: "/work" },
      { cwd: "/work" },
    );
    const args = spawns[0]?.spawnArgs.args ?? [];
    expect(args).toContain("--append-system-prompt");
    expect(args).toContain("default behavior");
  });

  it("resumeSession passes no --append-system-prompt when neither overrides nor deps has systemPrompt (task-005)", async () => {
    const { client, spawns } = clientWithFake();
    await client.resumeSession(
      { provider: "pi", sessionId: "s1", nativeHandle: "/tmp/prior-conversation.jsonl" },
      { cwd: "/work" },
      { cwd: "/work" },
    );
    const args = spawns[0]?.spawnArgs.args ?? [];
    // When both are falsy, buildPiArgs should not include --append-system-prompt at all
    const appendIdx = args.indexOf("--append-system-prompt");
    expect(appendIdx).toBe(-1);
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

  /**
   * Pi's `new_session`/`switch_session`/`fork`/`clone` rebind the process to a DIFFERENT JSONL
   * session file (`agent-session-runtime.js` builds a fresh `SessionManager` for each). The handle
   * has to follow, or a restarted daemon rehydrates the timeline from — and resumes into — the
   * pre-operation conversation while the live agent is on the new one.
   */
  it.each([
    ["newSession", "/tmp/rebound-new_session.jsonl"],
    ["clone", "/tmp/rebound-clone.jsonl"],
  ] as const)(
    "%s re-reads the rebound session file into the persistence handle",
    async (op, file) => {
      const { client } = clientWithFake();
      const session = await client.createSession({ provider: "pi", cwd: "/work" });
      expect(session.describePersistence()?.nativeHandle).toBe("/tmp/fake-pi-session.jsonl");
      await session[op]?.();
      expect(session.describePersistence()?.nativeHandle).toBe(file);
    },
  );

  it("switchSession points the persistence handle at the loaded session file", async () => {
    const { client } = clientWithFake();
    const session = await client.createSession({ provider: "pi", cwd: "/work" });
    await session.switchSession?.("/tmp/other.jsonl");
    expect(session.describePersistence()?.nativeHandle).toBe("/tmp/other.jsonl");
  });

  it("fork points the persistence handle at the branched session file", async () => {
    const { client } = clientWithFake();
    const session = await client.createSession({ provider: "pi", cwd: "/work" });
    await session.fork?.("e1");
    expect(session.describePersistence()?.nativeHandle).toBe("/tmp/rebound-fork.jsonl");
  });

  it("keeps the previous handle when a rebinding op is cancelled", async () => {
    const spawns: FakeTransport[] = [];
    class CancellingTransport extends FakeTransport {
      override request(command: string, params?: Record<string, unknown>): Promise<unknown> {
        // Cancelled ops never rebind, so `get_state` would still report the old file anyway; the
        // point is that no re-read happens at all.
        if (command === "new_session") return Promise.resolve({ cancelled: true });
        return super.request(command, params);
      }
    }
    const client = new PiAgentClient({
      command: ["pi", "--mode", "rpc"],
      transportFactory: (args) => {
        const t = new CancellingTransport(args);
        spawns.push(t);
        return t;
      },
      binaryResolver: () => true,
    });
    const session = await client.createSession({ provider: "pi", cwd: "/work" });
    expect(await session.newSession?.()).toEqual({ cancelled: true });
    expect(session.describePersistence()?.nativeHandle).toBe("/tmp/fake-pi-session.jsonl");
    // Only `createSession`'s own spawn-time probe — none for an op that changed nothing.
    expect(spawns[0]?.requests.filter((r) => r === "get_state")).toHaveLength(1);
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

  it("setProviderModel issues set_model with provider+modelId; cycleModel maps the response; both update getRuntimeInfo().model (sprint-042)", async () => {
    const { client, spawns } = clientWithFake();
    const session = await client.createSession({ provider: "pi", cwd: "/work" });
    expect(session.getRuntimeInfo().model).toBe("claude-opus-4"); // from get_state on create
    await session.setProviderModel?.("anthropic", "claude-sonnet-4-20250514");
    expect(spawns[0]?.requests).toContain("set_model");
    expect(session.getRuntimeInfo().model).toBe("claude-sonnet-4-20250514");
    const cycled = await session.cycleModel?.();
    expect(cycled).toEqual({ model: { id: "next-model" }, thinkingLevel: "medium" });
    expect(session.getRuntimeInfo().model).toBe("next-model");
  });

  it("getLastAssistantText returns the mapped text", async () => {
    const { client } = clientWithFake();
    const session = await client.createSession({ provider: "pi", cwd: "/work" });
    expect(await session.getLastAssistantText?.()).toBe("last reply");
  });

  it("listCommands issues get_commands and maps name/id/description/source/scope/path", async () => {
    const { client } = clientWithFake();
    const session = await client.createSession({ provider: "pi", cwd: "/work" });
    expect(await session.listCommands?.()).toEqual([
      {
        id: "session-name",
        name: "session-name",
        description: "Set or clear session name",
        source: "extension",
        scope: undefined,
        path: "/home/user/.pi/agent/extensions/session.ts",
      },
      {
        id: "fix-tests",
        name: "fix-tests",
        description: "Fix failing tests",
        source: "prompt",
        scope: "project",
        path: "/home/user/myproject/.pi/agent/prompts/fix-tests.md",
      },
      {
        id: "skill:brave-search",
        name: "skill:brave-search",
        description: "Web search via Brave API",
        source: "skill",
        scope: "user",
        path: "/home/user/.pi/agent/skills/brave-search/SKILL.md",
      },
    ]);
  });

  it("listCommands returns [] when the response has no commands array", async () => {
    class NoCommandsTransport extends FakeTransport {
      override request(command: string, params?: Record<string, unknown>): Promise<unknown> {
        if (command === "get_commands") return Promise.resolve({});
        return super.request(command, params);
      }
    }
    const client = new PiAgentClient({
      command: ["pi", "--mode", "rpc"],
      transportFactory: (args) => new NoCommandsTransport(args),
      binaryResolver: () => true,
    });
    const session = await client.createSession({ provider: "pi", cwd: "/work" });
    expect(await session.listCommands?.()).toEqual([]);
  });
});

describe("slash-prompt turn completion (web-client slash commands, step 1)", () => {
  /**
   * Extends {@link FakeTransport} for the slash-prompt correlation path (`PiAgentSession.run` now
   * routes a `/`-prefixed prompt through `transport.request("prompt", …)` instead of `notify`,
   * then probes `get_state` for `isStreaming` to know whether Pi ran an inline extension command
   * or started a real turn — see `agent.ts`'s `runSlashPrompt`). Overrides only `get_state`
   * (adding the post-ack streaming flag `discoverState()` doesn't need) and `prompt` (moving it
   * from `notify` to `request`); every other command still goes through the base fake unchanged.
   */
  class SlashTransport extends FakeTransport {
    private getStateCalls = 0;

    constructor(
      args: PiTransportSpawnArgs,
      private readonly streaming: boolean,
      private readonly rejectPrompt = false,
    ) {
      super(args);
    }

    override request(command: string, params?: Record<string, unknown>): Promise<unknown> {
      if (command === "get_state") {
        this.getStateCalls += 1;
        // The first get_state is `discoverState()`'s spawn-time probe — keep the base fake's
        // sessionFile/model payload so existing spawn-time expectations are untouched. Every
        // subsequent call is `runSlashPrompt`'s post-ack streaming probe.
        if (this.getStateCalls === 1) return super.request(command, params);
        this.requests.push(command);
        return Promise.resolve({ isStreaming: this.streaming });
      }
      if (command === "prompt") {
        this.requests.push(command);
        return this.rejectPrompt ? Promise.reject(new Error("ack rejected")) : Promise.resolve({});
      }
      return super.request(command, params);
    }

    /** Lets a test simulate the turn-terminal event `runSlashPrompt` awaits after a streaming ack. */
    fireEvent(event: unknown): void {
      this.fire(event);
    }
  }

  function clientWithSlashFake(
    streaming: boolean,
    opts?: { rejectPrompt?: boolean },
  ): { client: PiAgentClient; spawns: SlashTransport[] } {
    const spawns: SlashTransport[] = [];
    const client = new PiAgentClient({
      command: ["pi", "--mode", "rpc"],
      transportFactory: (args) => {
        const t = new SlashTransport(args, streaming, opts?.rejectPrompt ?? false);
        spawns.push(t);
        return t;
      },
      binaryResolver: () => true,
    });
    return { client, spawns };
  }

  it("an inline extension command (isStreaming: false) resolves run() with no turn-terminal event, via request not notify", async () => {
    const { client, spawns } = clientWithSlashFake(false);
    const session = await client.createSession({ provider: "pi", cwd: "/work" });
    const events: AgentStreamEvent[] = [];
    session.subscribe((e) => events.push(e));

    await session.run("/session-name x");

    expect(spawns[0]?.requests).toContain("prompt");
    expect(spawns[0]?.notifies).not.toContain("prompt");
    expect(events).toHaveLength(0);
  });

  it("a real turn (isStreaming: true) is awaited until turn_completed fires", async () => {
    const { client, spawns } = clientWithSlashFake(true);
    const session = await client.createSession({ provider: "pi", cwd: "/work" });
    const events: AgentStreamEvent[] = [];
    session.subscribe((e) => events.push(e));

    let resolved = false;
    const running = session.run("/fix-tests").then(() => {
      resolved = true;
    });
    // Flush the ack + get_state probe's two sequential `await`s deterministically (no wall-clock
    // wait): each is an already-resolved promise, so draining a few microtask ticks is enough to
    // reach the pending `await terminal` without racing a real timer.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(resolved).toBe(false);

    spawns[0]?.fireEvent({ type: "agent_end" });
    spawns[0]?.fireEvent({ type: "agent_settled" });
    await running;
    expect(resolved).toBe(true);
    expect(events.map((e) => e.kind)).toContain("turn_completed");
  });

  it("a rejected prompt ack propagates as a rejected run() (previously silently swallowed by notify)", async () => {
    const { client } = clientWithSlashFake(false, { rejectPrompt: true });
    const session = await client.createSession({ provider: "pi", cwd: "/work" });

    await expect(session.run("/bad")).rejects.toThrow("ack rejected");
  });

  it("a non-slash prompt still goes out via notify (untouched fast path)", async () => {
    const { client, spawns } = clientWithSlashFake(false);
    const session = await client.createSession({ provider: "pi", cwd: "/work" });
    const events: AgentStreamEvent[] = [];
    session.subscribe((e) => events.push(e));

    await session.run("do it");

    expect(spawns[0]?.notifies).toContain("prompt");
    expect(events.map((e) => e.kind)).toContain("turn_completed");
  });
});
