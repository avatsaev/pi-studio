import { describe, expect, it, vi } from "vitest";

import { DaemonClient } from "./daemon-client.js";
import * as clientIndex from "./index.js";
import {
  AgentUiError,
  isAgentArchived,
  isAgentDeleted,
  isAgentUiRequest,
  isAgentUiResolved,
  PiStudioClient,
} from "./pistudio-client.js";
import { makeFacade, makeScriptedDaemon } from "./test-support/scripted-daemon.js";

describe("PiStudioClient — agent create + stream", () => {
  it("creates an agent and returns its agentId", async () => {
    const { client } = await makeFacade();
    const created = await client.createAgent({
      config: { provider: "mock", cwd: "/work" },
      initialPrompt: "hi",
      labels: {},
    });
    expect(created.agentId).toBe("agent-1");
  });

  it("timeline.subscribe only delivers events for its own agent", async () => {
    const { client, fake } = await makeFacade();
    const created = await client.createAgent({
      config: { provider: "mock", cwd: "/w" },
      labels: {},
    });
    const mine: string[] = [];
    client.agent(created.agentId).timeline.subscribe((e) => mine.push(e.kind));
    // Push a stream event for a DIFFERENT agent — must be ignored.
    fake.push({ type: "agent_stream", agentId: "other", event: { kind: "assistant_message" } });
    // Push one for ours.
    fake.push({ type: "agent_stream", agentId: created.agentId, event: { kind: "reasoning" } });
    await new Promise((r) => setTimeout(r, 5));
    expect(mine).toEqual(["reasoning"]);
  });

  it("timeline.subscribe forwards the daemon-stamped timestamp/seq as meta", async () => {
    const { client, fake } = await makeFacade();
    const created = await client.createAgent({
      config: { provider: "mock", cwd: "/w" },
      labels: {},
    });
    const metas: unknown[] = [];
    client.agent(created.agentId).timeline.subscribe((_e, meta) => metas.push(meta));
    fake.push({
      type: "agent_stream",
      agentId: created.agentId,
      event: { kind: "reasoning" },
      timestamp: "2026-08-17T13:08:00.000Z",
      seq: 3,
    });
    await Promise.resolve();
    expect(metas).toEqual([{ timestamp: "2026-08-17T13:08:00.000Z", seq: 3 }]);
  });

  it("delivers stream events when subscribed before the burst", async () => {
    const { client, daemon } = await makeFacade();
    const events: string[] = [];
    // Subscribe to ALL agent_stream at the daemon level to catch the create burst.
    daemon.onSessionMessage((m) => {
      const msg = m as unknown as { type?: string; agentId?: string; event?: { kind: string } };
      if (msg.type === "agent_stream" && msg.event) events.push(msg.event.kind);
    });
    const created = await client.createAgent({
      config: { provider: "mock", cwd: "/w" },
      initialPrompt: "go",
      labels: {},
    });
    expect(created.agentId).toBeTruthy();
    // Allow the streamed burst microtasks to flush.
    await new Promise((r) => setTimeout(r, 5));
    expect(events).toContain("turn_started");
    expect(events).toContain("assistant_message");
    expect(events).toContain("turn_completed");
  });
});

describe("PiStudioClient — timeline handle", () => {
  it("fetches paged history", async () => {
    const { client } = await makeFacade();
    const created = await client.createAgent({
      config: { provider: "mock", cwd: "/w" },
      labels: {},
    });
    const page = await client.agent(created.agentId).timeline.fetch({ limit: 50 });
    expect(page.items).toHaveLength(1);
    expect(page.hasNewer).toBe(false);
    expect(page.endCursor).toBe("c1");
  });
});

describe("PiStudioClient — update handlers", () => {
  it("fires onAgentUpdate when an agent_update arrives", async () => {
    const { client } = await makeFacade();
    const created = await client.createAgent({
      config: { provider: "mock", cwd: "/w" },
      labels: {},
    });
    const updates: unknown[] = [];
    client.agent(created.agentId).onUpdate((u) => updates.push(u));
    await client.agent(created.agentId).update({ title: "Renamed" });
    await new Promise((r) => setTimeout(r, 5));
    expect(updates).toHaveLength(1);
    expect((updates[0] as Record<string, unknown>).title).toBe("Renamed");
  });

  it("fires onWorkspaceUpdate when a workspace_update arrives", async () => {
    const { client, fake } = await makeFacade();
    const updates: unknown[] = [];
    client.workspace("ws-1").onUpdate((u) => updates.push(u));
    fake.push({ type: "workspace_update", workspaceId: "ws-1", name: "Proj" });
    await new Promise((r) => setTimeout(r, 5));
    expect(updates).toHaveLength(1);
  });
});

describe("PiStudioClient — provider actions", () => {
  it("lists models and modes and triggers a snapshot refresh", async () => {
    const { client } = await makeFacade();
    const models = (await client.providers.listModels("mock")) as { models: { id: string }[] };
    const modes = (await client.providers.listModes("mock")) as { modes: { id: string }[] };
    const refresh = (await client.providers.refreshSnapshot()) as { refreshed: boolean };
    expect(models.models.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(modes.modes.map((m) => m.id)).toEqual(["plan", "default"]);
    expect(refresh.refreshed).toBe(true);
  });

  it("resolveDefaultModel issues resolve_default_model and returns the resolved model/provider", async () => {
    const { client, fake } = await makeFacade();
    const resolved = await client.providers.resolveDefaultModel("pi", "/work");
    expect(resolved.type).toBe("resolve_default_model_response");
    expect(resolved.model).toBe("claude-sonnet-5");
    expect(resolved.modelProvider).toBe("anthropic");
    const req = fake.sent.find((m) => m.type === "resolve_default_model");
    expect(req?.provider).toBe("pi");
    expect(req?.cwd).toBe("/work");
  });
});

describe("PiStudioClient — slash-command operations (sprint-037)", () => {
  it("sessionStats issues agent_session_stats_request and returns the mapped payload", async () => {
    const { client, fake } = await makeFacade();
    const created = await client.createAgent({
      config: { provider: "mock", cwd: "/w" },
      labels: {},
    });
    const stats = await client.agent(created.agentId).sessionStats();
    expect(stats).toEqual({ sessionId: "s1", totalMessages: 3 });
    expect(fake.sent.find((m) => m.type === "agent_session_stats_request")?.agentId).toBe(
      created.agentId,
    );
  });

  it("compact forwards customInstructions and returns the mapped payload", async () => {
    const { client, fake } = await makeFacade();
    const created = await client.createAgent({
      config: { provider: "mock", cwd: "/w" },
      labels: {},
    });
    const result = await client.agent(created.agentId).compact("focus on code");
    expect(result).toEqual({ summary: "compacted", tokensBefore: 1000 });
    const req = fake.sent.find((m) => m.type === "agent_compact_request");
    expect(req?.customInstructions).toBe("focus on code");
  });

  it("newSession, switchSession, fork, forkMessages, clone, setSessionName, exportHtml, setModel, cycleModel, lastAssistantText all issue their correlated RPC with agentId", async () => {
    const { client, fake } = await makeFacade();
    const created = await client.createAgent({
      config: { provider: "mock", cwd: "/w" },
      labels: {},
    });
    const handle = client.agent(created.agentId);

    await handle.newSession();
    await handle.switchSession("/tmp/other.jsonl");
    await handle.fork("e1");
    await handle.forkMessages();
    await handle.clone();
    await handle.setSessionName("my-feature");
    await handle.exportHtml("/tmp/out.html");
    await handle.setModel("anthropic", "claude-sonnet-4-20250514");
    await handle.cycleModel();
    await handle.lastAssistantText();

    const types = fake.sent.map((m) => m.type);
    expect(types).toEqual(
      expect.arrayContaining([
        "agent_new_session_request",
        "agent_switch_session_request",
        "agent_fork_request",
        "agent_fork_messages_request",
        "agent_clone_request",
        "agent_set_session_name_request",
        "agent_export_html_request",
        "agent_set_model_request",
        "agent_cycle_model_request",
        "agent_last_assistant_text_request",
      ]),
    );
    for (const m of fake.sent) {
      if (m.type?.toString().startsWith("agent_") && m.type !== "create_agent_request") {
        expect(m.agentId, `${m.type} carries agentId`).toBe(created.agentId);
      }
    }
    expect(fake.sent.find((m) => m.type === "agent_switch_session_request")?.sessionPath).toBe(
      "/tmp/other.jsonl",
    );
    expect(fake.sent.find((m) => m.type === "agent_fork_request")?.entryId).toBe("e1");
    expect(fake.sent.find((m) => m.type === "agent_set_session_name_request")?.name).toBe(
      "my-feature",
    );
    expect(fake.sent.find((m) => m.type === "agent_export_html_request")?.outputPath).toBe(
      "/tmp/out.html",
    );
    const setModelReq = fake.sent.find((m) => m.type === "agent_set_model_request");
    expect(setModelReq?.provider).toBe("anthropic");
    expect(setModelReq?.modelId).toBe("claude-sonnet-4-20250514");
  });
});

describe("PiStudioClient — command discovery (sprint-040)", () => {
  it("listCommands issues agent_list_commands_request with agentId and returns the commands payload", async () => {
    const { client, fake } = await makeFacade();
    const created = await client.createAgent({
      config: { provider: "mock", cwd: "/w" },
      labels: {},
    });
    const payload = await client.agent(created.agentId).listCommands();
    expect(payload.commands.map((c) => c.name)).toEqual(["fix-tests", "skill:brave-search"]);
    expect(payload.commands[0]?.source).toBe("prompt");
    expect(payload.commands[0]?.scope).toBe("project");
    expect(fake.sent.find((m) => m.type === "agent_list_commands_request")?.agentId).toBe(
      created.agentId,
    );
  });
});
describe("PiStudioClient — extension pack actions (sprint-057)", () => {
  it("listExtensionPacks sends extension_packs_list_request and returns the parsed response payload unchanged", async () => {
    const { client, fake } = await makeFacade();
    const payload = await client.listExtensionPacks();
    expect(payload.autoSync).toBe(true);
    expect(payload.selected).toEqual(["swe"]);
    expect(payload.packs).toHaveLength(2);
    const sent = fake.sent.find((m) => m.type === "extension_packs_list_request");
    expect(sent).toBeDefined();
    expect(sent).toEqual({ type: "extension_packs_list_request", requestId: expect.any(String) });
  });

  it("setExtensionPacks sends extension_packs_set_request with packs array", async () => {
    const { client, fake } = await makeFacade();
    const payload = await client.setExtensionPacks(["swe"]);
    expect(payload.ok).toBe(true);
    const sent = fake.sent.find((m) => m.type === "extension_packs_set_request");
    expect(sent).toBeDefined();
    expect(sent).toEqual({
      type: "extension_packs_set_request",
      requestId: expect.any(String),
      packs: ["swe"],
    });
  });

  it("syncExtensionPacks sends extension_packs_set_request with no packs key at all (not packs: [])", async () => {
    const { client, fake } = await makeFacade();
    const payload = await client.syncExtensionPacks();
    expect(payload.ok).toBe(true);
    const sent = fake.sent.find((m) => m.type === "extension_packs_set_request");
    expect(sent).toBeDefined();
    expect(sent).not.toHaveProperty("packs");
    expect(sent).toEqual({
      type: "extension_packs_set_request",
      requestId: expect.any(String),
    });
  });

  it("opts.timeoutMs reaches request()'s third parameter; omitting it leaves the client default", async () => {
    const { client, daemon } = await makeFacade();
    const spy = vi.spyOn(daemon, "request");

    await client.setExtensionPacks(["swe"], { timeoutMs: 90_000 });
    expect(spy).toHaveBeenLastCalledWith(
      "extension_packs_set_request",
      expect.objectContaining({ packs: ["swe"] }),
      90_000,
    );

    await client.syncExtensionPacks({ timeoutMs: 120_000 });
    expect(spy).toHaveBeenLastCalledWith(
      "extension_packs_set_request",
      expect.objectContaining({}),
      120_000,
    );

    await client.setExtensionPacks(["swe"]);
    expect(spy).toHaveBeenLastCalledWith(
      "extension_packs_set_request",
      expect.objectContaining({ packs: ["swe"] }),
      undefined,
    );
  });

  it("an ok:false response (unknown slug) resolves as data, never throws — a UI can render error", async () => {
    const { client } = await makeFacade();
    const payload = await client.setExtensionPacks(["unknown"]);
    expect(payload.ok).toBe(false);
    expect(payload.error).toBe("unknown pack: unknown");
    expect(payload.report).toBeUndefined();
  });
});

// Deterministic microtask drain — no real wall-clock wait. The scripted daemon delivers every
// message via `queueMicrotask`, and the SDK's own event handling is synchronous once a message is
// delivered; a handful of chained ticks comfortably drains any nesting this harness produces.
async function flushProviderAuthMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe("PiStudioClient — provider auth remote login (sprint-065/task-001)", () => {
  const flush = flushProviderAuthMicrotasks;

  it("hasProviderAuthCapability reflects the daemon's providerAuth flag; nothing is sent when it is false", async () => {
    const { client: withFlag } = await makeFacade();
    expect(withFlag.hasProviderAuthCapability()).toBe(true);

    const { client: withoutFlag, fake } = await makeFacade({
      features: { providersSnapshot: true },
    });
    expect(withoutFlag.hasProviderAuthCapability()).toBe(false);
    expect(fake.sent.some((m) => String(m.type).startsWith("provider_auth_"))).toBe(false);
  });

  it("listProviderAuth returns the provider list on ok:true", async () => {
    const { client, fake } = await makeFacade();
    const listPromise = client.listProviderAuth();
    await flush();
    const req = fake.sent.find((m) => m.type === "provider_auth_list_request");
    expect(req).toBeDefined();
    fake.push({
      type: "provider_auth_list_response",
      requestId: req?.requestId,
      payload: {
        ok: true,
        providers: [{ id: "openai", name: "OpenAI", authTypes: ["api_key"], configured: false }],
      },
    });
    const providers = await listPromise;
    expect(providers).toHaveLength(1);
    expect(providers[0]?.id).toBe("openai");
  });

  it("listProviderAuth throws ProviderAuthError on a payload-level ok:false (never a silent empty list)", async () => {
    const { client, fake } = await makeFacade();
    const listPromise = client.listProviderAuth();
    await flush();
    const req = fake.sent.find((m) => m.type === "provider_auth_list_request");
    fake.push({
      type: "provider_auth_list_response",
      requestId: req?.requestId,
      payload: { ok: false, error: "boom" },
    });
    await expect(listPromise).rejects.toThrow("boom");
  });

  it("logoutProvider reports stillConfigured", async () => {
    const { client, fake } = await makeFacade();
    const logoutPromise = client.logoutProvider("openai");
    await flush();
    const req = fake.sent.find((m) => m.type === "provider_auth_logout_request");
    expect(req?.provider).toBe("openai");
    fake.push({
      type: "provider_auth_logout_response",
      requestId: req?.requestId,
      payload: { ok: true, stillConfigured: true },
    });
    expect(await logoutPromise).toEqual({ stillConfigured: true });
  });

  it("secret-prompt round-trip: prompt resolves, respond is sent, done ok:true settles the promise", async () => {
    const { client, fake } = await makeFacade();
    const seen: unknown[] = [];
    const loginPromise = client.loginProvider(
      "openai",
      "api_key",
      {
        prompt: async (p) => {
          seen.push(p);
          return "sk-test-123";
        },
      },
      undefined,
    );
    await flush();
    const loginReq = fake.sent.find((m) => m.type === "provider_auth_login_request");
    expect(loginReq).toMatchObject({ provider: "openai", authType: "api_key" });
    fake.push({
      type: "provider_auth_login_response",
      requestId: loginReq?.requestId,
      payload: { ok: true, flowId: "flow-1" },
    });
    await flush();
    fake.push({
      type: "provider_auth_flow_event",
      flowId: "flow-1",
      event: { kind: "prompt", promptId: "p1", promptKind: "secret", message: "Enter API key" },
    });
    await flush();
    expect(seen).toEqual([
      {
        promptId: "p1",
        promptKind: "secret",
        message: "Enter API key",
        placeholder: undefined,
        options: undefined,
        // Every prompt carries the per-prompt cancellation signal a view needs to retire its input
        // when `prompt_cancelled` arrives out of band (see `ProviderAuthPromptUi.signal`).
        signal: expect.any(AbortSignal),
      },
    ]);
    expect(seen[0]?.signal?.aborted).toBe(false);
    const respondReq = fake.sent.find((m) => m.type === "provider_auth_respond_request");
    expect(respondReq).toMatchObject({ flowId: "flow-1", promptId: "p1", value: "sk-test-123" });
    fake.push({
      type: "provider_auth_respond_response",
      requestId: respondReq?.requestId,
      payload: { ok: true },
    });
    fake.push({
      type: "provider_auth_flow_event",
      flowId: "flow-1",
      event: { kind: "done", ok: true },
    });
    expect(await loginPromise).toEqual({ ok: true });
    // Never let a secret value leak into a presentation event.
    expect(JSON.stringify(seen)).not.toContain("sk-test-123");
  });

  it("a flow event delivered before the login response is buffered and still reaches the caller", async () => {
    const { client, fake } = await makeFacade();
    const promptsSeen: string[] = [];
    const loginPromise = client.loginProvider("openai", "api_key", {
      prompt: async (p) => {
        promptsSeen.push(p.promptId);
        return "value";
      },
    });
    await flush();
    const loginReq = fake.sent.find((m) => m.type === "provider_auth_login_request");
    // The daemon starts the flow the instant it handles the login RPC — push the flow event
    // BEFORE the login response, simulating that race.
    fake.push({
      type: "provider_auth_flow_event",
      flowId: "flow-2",
      event: { kind: "prompt", promptId: "p-early", promptKind: "text", message: "early" },
    });
    await flush();
    expect(promptsSeen).toEqual([]); // buffered — flowId not yet known
    fake.push({
      type: "provider_auth_login_response",
      requestId: loginReq?.requestId,
      payload: { ok: true, flowId: "flow-2" },
    });
    await flush();
    expect(promptsSeen).toEqual(["p-early"]); // drained the instant flowId is learned
    const respondReq = fake.sent.find((m) => m.type === "provider_auth_respond_request");
    fake.push({
      type: "provider_auth_respond_response",
      requestId: respondReq?.requestId,
      payload: { ok: true },
    });
    fake.push({
      type: "provider_auth_flow_event",
      flowId: "flow-2",
      event: { kind: "done", ok: true },
    });
    await loginPromise;
  });

  it("prompt_cancelled retires the pending prompt out of band; the flow continues and a later done settles the call", async () => {
    const { client, fake } = await makeFacade();
    const seenSignals: AbortSignal[] = [];
    const loginPromise = client.loginProvider("openai", "oauth", {
      // Never resolves on its own — only the daemon's out-of-band `prompt_cancelled` retires it
      // (an OAuth callback answered it a different way). The view's notice is the prompt's own
      // signal, which is why it is captured here.
      prompt: (prompt) => {
        if (prompt.signal) seenSignals.push(prompt.signal);
        return new Promise<string>(() => {});
      },
    });
    await flush();
    const loginReq = fake.sent.find((m) => m.type === "provider_auth_login_request");
    fake.push({
      type: "provider_auth_login_response",
      requestId: loginReq?.requestId,
      payload: { ok: true, flowId: "flow-3" },
    });
    await flush();
    fake.push({
      type: "provider_auth_flow_event",
      flowId: "flow-3",
      event: { kind: "prompt", promptId: "p-manual", promptKind: "manual_code", message: "code?" },
    });
    await flush();
    expect(seenSignals).toHaveLength(1);
    expect(seenSignals[0]?.aborted).toBe(false);
    // A stale/non-matching id is a no-op.
    fake.push({
      type: "provider_auth_flow_event",
      flowId: "flow-3",
      event: { kind: "prompt_cancelled", promptId: "stale-id" },
    });
    await flush();
    expect(seenSignals[0]?.aborted).toBe(false);
    fake.push({
      type: "provider_auth_flow_event",
      flowId: "flow-3",
      event: { kind: "prompt_cancelled", promptId: "p-manual" },
    });
    await flush();
    // The view's only notice that its input is dead — without it a `manual_code` field stays on
    // screen after the OAuth callback already won the race.
    expect(seenSignals[0]?.aborted).toBe(true);
    // Cancelling the SPECIFIC prompt must not cancel the whole flow.
    expect(fake.sent.some((m) => m.type === "provider_auth_cancel_request")).toBe(false);
    fake.push({
      type: "provider_auth_flow_event",
      flowId: "flow-3",
      event: { kind: "done", ok: true },
    });
    expect(await loginPromise).toEqual({ ok: true });
  });

  it("opts.signal abort sends provider_auth_cancel_request; the promise still settles from done ok:false", async () => {
    const { client, fake } = await makeFacade();
    const controller = new AbortController();
    const loginPromise = client.loginProvider(
      "openai",
      "api_key",
      { prompt: async () => "unused" },
      { signal: controller.signal },
    );
    await flush();
    const loginReq = fake.sent.find((m) => m.type === "provider_auth_login_request");
    fake.push({
      type: "provider_auth_login_response",
      requestId: loginReq?.requestId,
      payload: { ok: true, flowId: "flow-4" },
    });
    await flush();
    controller.abort();
    await flush();
    const cancelReq = fake.sent.find((m) => m.type === "provider_auth_cancel_request");
    expect(cancelReq?.flowId).toBe("flow-4");
    fake.push({
      type: "provider_auth_flow_event",
      flowId: "flow-4",
      event: { kind: "done", ok: false, error: "cancelled" },
    });
    expect(await loginPromise).toEqual({ ok: false, error: "cancelled" });
  });

  it("a socket drop mid-flow settles ok:false connection_lost — no hang, no unhandled rejection", async () => {
    const { client, fake } = await makeFacade();
    const loginPromise = client.loginProvider("openai", "api_key", { prompt: async () => "x" });
    await flush();
    const loginReq = fake.sent.find((m) => m.type === "provider_auth_login_request");
    fake.push({
      type: "provider_auth_login_response",
      requestId: loginReq?.requestId,
      payload: { ok: true, flowId: "flow-5" },
    });
    await flush();
    fake.drop();
    expect(await loginPromise).toEqual({ ok: false, error: "connection_lost" });
  });

  it(
    "a respond RPC that times out (peer unreachable but the socket itself stays open — e.g. a " +
      "relay-mediated daemon death) settles ok:false connection_lost — no hang (sprint-065/task-007, " +
      "found live: the daemon's own WS to the relay had died, but the browser's WS to the relay had " +
      "not, so no `onStateChange('closed')` ever fired; only a genuine RPC timeout can detect this)",
    async () => {
      const { client, fake } = await makeFacade();
      const loginPromise = client.loginProvider("openai", "api_key", {
        prompt: async () => "typed-value",
      });
      await flush();
      const loginReq = fake.sent.find((m) => m.type === "provider_auth_login_request");
      fake.push({
        type: "provider_auth_login_response",
        requestId: loginReq?.requestId,
        payload: { ok: true, flowId: "flow-timeout" },
      });
      await flush();
      fake.push({
        type: "provider_auth_flow_event",
        flowId: "flow-timeout",
        event: { kind: "prompt", promptId: "p-timeout", promptKind: "api_key", message: "key?" },
      });
      await flush();
      // Never reply to provider_auth_respond_request — the daemon is unreachable, but nothing closes
      // the transport (`fake.drop()` is deliberately NOT called here; that is the other test above).
      // rpcTimeoutMs is 1000 in this harness; wait past it for the real setTimeout to fire.
      await new Promise((resolve) => setTimeout(resolve, 1100));
      expect(await loginPromise).toEqual({ ok: false, error: "connection_lost" });
      // The best-effort cancel still fires — it just must not be what the flow's own promise waits on.
      expect(fake.sent.some((m) => m.type === "provider_auth_cancel_request")).toBe(true);
    },
  );

  it("events for an unknown/stale flowId are dropped with no callback invocation", async () => {
    const { client, fake } = await makeFacade();
    const seen: unknown[] = [];
    const loginPromise = client.loginProvider("openai", "api_key", {
      prompt: async () => "x",
      onEvent: (e) => seen.push(e),
    });
    await flush();
    const loginReq = fake.sent.find((m) => m.type === "provider_auth_login_request");
    fake.push({
      type: "provider_auth_login_response",
      requestId: loginReq?.requestId,
      payload: { ok: true, flowId: "flow-6" },
    });
    await flush();
    fake.push({
      type: "provider_auth_flow_event",
      flowId: "some-other-flow",
      event: { kind: "info", message: "not mine" },
    });
    await flush();
    expect(seen).toEqual([]);
    fake.push({
      type: "provider_auth_flow_event",
      flowId: "flow-6",
      event: { kind: "done", ok: true },
    });
    await loginPromise;
  });

  it("a second concurrent loginProvider rejects locally without sending a second login request", async () => {
    const { client, fake } = await makeFacade();
    const first = client.loginProvider("openai", "api_key", { prompt: async () => "x" });
    await flush();
    await expect(
      client.loginProvider("anthropic", "api_key", { prompt: async () => "y" }),
    ).rejects.toThrow(/already in progress/);
    const loginReqs = fake.sent.filter((m) => m.type === "provider_auth_login_request");
    expect(loginReqs).toHaveLength(1);
    const loginReq = loginReqs[0];
    fake.push({
      type: "provider_auth_login_response",
      requestId: loginReq?.requestId,
      payload: { ok: true, flowId: "flow-7" },
    });
    await flush();
    fake.push({
      type: "provider_auth_flow_event",
      flowId: "flow-7",
      event: { kind: "done", ok: true },
    });
    await first;
  });

  it("every subscription is released once the flow settles", async () => {
    const { client, daemon, fake } = await makeFacade();
    const internals = daemon as unknown as {
      sessionHandlers: Set<unknown>;
      stateHandlers: Set<unknown>;
    };
    const sessionHandlersBefore = internals.sessionHandlers.size;
    const stateHandlersBefore = internals.stateHandlers.size;

    const loginPromise = client.loginProvider("openai", "api_key", { prompt: async () => "x" });
    await flush();
    expect(internals.sessionHandlers.size).toBe(sessionHandlersBefore + 1);
    expect(internals.stateHandlers.size).toBe(stateHandlersBefore + 1);

    const loginReq = fake.sent.find((m) => m.type === "provider_auth_login_request");
    fake.push({
      type: "provider_auth_login_response",
      requestId: loginReq?.requestId,
      payload: { ok: true, flowId: "flow-8" },
    });
    await flush();
    fake.push({
      type: "provider_auth_flow_event",
      flowId: "flow-8",
      event: { kind: "done", ok: true },
    });
    await loginPromise;

    expect(internals.sessionHandlers.size).toBe(sessionHandlersBefore);
    expect(internals.stateHandlers.size).toBe(stateHandlersBefore);
  });
});

describe("PiStudioClient — extension UI SDK surface (sprint-067/task-001)", () => {
  const flush = flushProviderAuthMicrotasks;

  it("all five facade members and the four guards/error class are reachable from the package root", () => {
    const client = new PiStudioClient(
      new DaemonClient({
        url: "ws://mock/ws",
        clientId: "c1",
        clientType: "cli",
        transport: makeScriptedDaemon().transport,
      }),
    );
    expect(typeof client.onAgentUiRequest).toBe("function");
    expect(typeof client.onAgentUiResolved).toBe("function");
    expect(typeof client.respondToUi).toBe("function");
    expect(typeof client.listAgentUi).toBe("function");
    expect(typeof client.extensionUiAvailable).toBe("function");
    expect(clientIndex.isAgentUiRequest).toBe(isAgentUiRequest);
    expect(clientIndex.isAgentUiResolved).toBe(isAgentUiResolved);
    expect(clientIndex.isAgentArchived).toBe(isAgentArchived);
    expect(clientIndex.isAgentDeleted).toBe(isAgentDeleted);
    expect(clientIndex.AgentUiError).toBe(AgentUiError);
  });

  it("extensionUiAvailable() reflects the daemon's extensionUi flag in both directions", async () => {
    const { client: withFlag } = await makeFacade({ features: { extensionUi: true } });
    const { client: withoutFlag } = await makeFacade({ features: {} });
    expect(withFlag.extensionUiAvailable()).toBe(true);
    expect(withoutFlag.extensionUiAvailable()).toBe(false);
  });

  it("onAgentUiRequest fires once per matching push with a finite local receivedAt, ignores non-matching messages, and stops after unsubscribe", async () => {
    const { client, fake } = await makeFacade({ features: { extensionUi: true } });
    const events: Array<{ requestId: string }> = [];
    const metas: Array<{ receivedAt: number }> = [];
    const unsubscribe = client.onAgentUiRequest((event, meta) => {
      events.push(event as unknown as { requestId: string });
      metas.push(meta);
    });
    fake.push({
      type: "agent_ui_request",
      requestId: "req-1",
      agentId: "agent-1",
      method: "confirm",
      expectsResponse: true,
      payload: { message: "Proceed?" },
      createdAt: Date.now(),
    });
    // Non-matching: missing agentId, and an unrelated type — neither should fire the handler.
    fake.push({ type: "agent_ui_request", requestId: "req-2" });
    fake.push({ type: "agent_update", agentId: "agent-1", status: "idle" });
    await flush();
    expect(events).toHaveLength(1);
    expect(events[0]?.requestId).toBe("req-1");
    expect(metas[0]?.receivedAt).toBeTypeOf("number");
    expect(Number.isFinite(metas[0]?.receivedAt)).toBe(true);

    unsubscribe();
    fake.push({
      type: "agent_ui_request",
      requestId: "req-3",
      agentId: "agent-1",
      method: "confirm",
      expectsResponse: true,
      payload: {},
      createdAt: Date.now(),
    });
    await flush();
    expect(events).toHaveLength(1);
  });

  it("onAgentUiResolved fires only for agent_ui_resolved pushes", async () => {
    const { client, fake } = await makeFacade({ features: { extensionUi: true } });
    const events: unknown[] = [];
    client.onAgentUiResolved((event) => events.push(event));
    fake.push({
      type: "agent_ui_resolved",
      requestId: "req-1",
      agentId: "agent-1",
      reason: "answered",
    });
    fake.push({ type: "agent_update", agentId: "agent-1", status: "idle" });
    await flush();
    expect(events).toHaveLength(1);
  });

  it("respondToUi resolves { ok: true } on { ok: true }", async () => {
    const { client, fake } = await makeFacade({ features: { extensionUi: true } });
    const resultPromise = client.respondToUi("req-1", { confirmed: true });
    await flush();
    const req = fake.sent.find((m) => m.type === "agent_ui_respond_request");
    expect(req?.uiRequestId).toBe("req-1");
    fake.push({
      type: "agent_ui_respond_response",
      requestId: req?.requestId,
      payload: { ok: true },
    });
    await expect(resultPromise).resolves.toEqual({ ok: true });
  });

  it('respondToUi resolves { ok: false, reason: "not_found" } without throwing', async () => {
    const { client, fake } = await makeFacade({ features: { extensionUi: true } });
    const resultPromise = client.respondToUi("req-1", { confirmed: true });
    await flush();
    const req = fake.sent.find((m) => m.type === "agent_ui_respond_request");
    fake.push({
      type: "agent_ui_respond_response",
      requestId: req?.requestId,
      payload: { ok: false, error: "not_found" },
    });
    await expect(resultPromise).resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it("respondToUi forwards an undocumented error string verbatim", async () => {
    const { client, fake } = await makeFacade({ features: { extensionUi: true } });
    const resultPromise = client.respondToUi("req-1", { confirmed: true });
    await flush();
    const req = fake.sent.find((m) => m.type === "agent_ui_respond_request");
    fake.push({
      type: "agent_ui_respond_response",
      requestId: req?.requestId,
      payload: { ok: false, error: "surface_gone_mid_flight" },
    });
    await expect(resultPromise).resolves.toEqual({ ok: false, reason: "surface_gone_mid_flight" });
  });

  it("respondToUi rejects on a transport-level RpcError (domain vs. transport failure stay distinguishable)", async () => {
    const { client, fake } = await makeFacade({ features: { extensionUi: true } });
    const resultPromise = client.respondToUi("req-1", { confirmed: true });
    await flush();
    const req = fake.sent.find((m) => m.type === "agent_ui_respond_request");
    fake.push({ type: "rpc_error", requestId: req?.requestId, message: "boom" });
    await expect(resultPromise).rejects.toThrow("boom");
  });

  it("listAgentUi() throws AgentUiError carrying the daemon's message on payload.ok === false", async () => {
    const { client, fake } = await makeFacade({ features: { extensionUi: true } });
    const listPromise = client.listAgentUi();
    await flush();
    const req = fake.sent.find((m) => m.type === "agent_ui_list_request");
    fake.push({
      type: "agent_ui_list_response",
      requestId: req?.requestId,
      payload: { ok: false, error: "daemon unreachable" },
    });
    await expect(listPromise).rejects.toThrow("daemon unreachable");
    await expect(listPromise).rejects.toBeInstanceOf(AgentUiError);
  });

  it("listAgentUi(agentId) sends agentId; listAgentUi() omits the key entirely", async () => {
    const { client, fake } = await makeFacade({ features: { extensionUi: true } });

    const scoped = client.listAgentUi("agent-1");
    await flush();
    const scopedReq = fake.sent.find((m) => m.type === "agent_ui_list_request");
    expect(scopedReq?.agentId).toBe("agent-1");
    fake.push({
      type: "agent_ui_list_response",
      requestId: scopedReq?.requestId,
      payload: { ok: true, pending: [], surfaces: [] },
    });
    await scoped;

    const all = client.listAgentUi();
    await flush();
    const allReq = fake.sent.filter((m) => m.type === "agent_ui_list_request")[1];
    expect("agentId" in (allReq ?? {})).toBe(false);
    fake.push({
      type: "agent_ui_list_response",
      requestId: allReq?.requestId,
      payload: { ok: true, pending: [], surfaces: [] },
    });
    await all;
  });

  it("isAgentUiRequest / isAgentUiResolved reject a same-type message missing requestId or agentId", () => {
    expect(isAgentUiRequest({ type: "agent_ui_request", requestId: "r1", agentId: "a1" })).toBe(
      true,
    );
    expect(isAgentUiRequest({ type: "agent_ui_request", agentId: "a1" })).toBe(false);
    expect(isAgentUiRequest({ type: "agent_ui_request", requestId: "r1" })).toBe(false);
    expect(isAgentUiResolved({ type: "agent_ui_resolved", requestId: "r1", agentId: "a1" })).toBe(
      true,
    );
    expect(isAgentUiResolved({ type: "agent_ui_resolved", agentId: "a1" })).toBe(false);
    expect(isAgentUiResolved({ type: "agent_ui_resolved", requestId: "r1" })).toBe(false);
  });

  it("isAgentArchived / isAgentDeleted accept their real shapes, reject each other's type, and reject agent_update", () => {
    expect(
      isAgentArchived({
        type: "agent_archived",
        agentId: "a1",
        archivedAt: "2026-08-21T00:00:00Z",
      }),
    ).toBe(true);
    expect(isAgentArchived({ type: "agent_archived", agentId: "a1" })).toBe(true);
    expect(isAgentArchived({ type: "agent_archived" })).toBe(false);
    expect(isAgentDeleted({ type: "agent_deleted", agentId: "a1" })).toBe(true);
    expect(isAgentDeleted({ type: "agent_deleted" })).toBe(false);

    expect(isAgentArchived({ type: "agent_deleted", agentId: "a1" })).toBe(false);
    expect(isAgentDeleted({ type: "agent_archived", agentId: "a1" })).toBe(false);
    expect(isAgentArchived({ type: "agent_update", agentId: "a1", status: "idle" })).toBe(false);
    expect(isAgentDeleted({ type: "agent_update", agentId: "a1", status: "idle" })).toBe(false);
  });
});
