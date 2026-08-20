import { describe, expect, it } from "vitest";

import { MockAgentClient, MockAgentSession } from "../providers/mock/mock-provider.js";
import { HandlerRegistry, routeTextFrame } from "../../ws/router.js";
import type { Session } from "../../ws/session.js";
import { registerAgentUiHandlers } from "./agent-ui-rpc.js";
import { AgentUiService } from "./agent-ui-service.js";

/**
 * `registerAgentUiHandlers` tests (swe/features/extension-ui-rpc.md § Public contract;
 * sprint-066/task-004). Drives a *real* `AgentUiService` (task-003 already covers its internals in
 * depth) through the actual `routeTextFrame` dispatch path, proving: the router stamps `requestId`
 * (handlers never do), a domain failure (`not_found`) travels in `payload` rather than becoming an
 * `rpc_error` frame, and `agent_ui_list_request` scoping works end to end.
 */

interface FakeSession {
  send: (envelope: unknown) => void;
  sent: unknown[];
}

function fakeSession(): Session & FakeSession {
  const sent: unknown[] = [];
  const session: FakeSession = { send: (envelope) => sent.push(envelope), sent };
  return session as unknown as Session & FakeSession;
}

async function dispatch(
  session: Session,
  registry: HandlerRegistry,
  message: Record<string, unknown>,
): Promise<void> {
  await routeTextFrame(session, JSON.stringify({ type: "session", message }), registry);
}

function lastMessage(session: Session & FakeSession): Record<string, unknown> {
  const envelope = session.sent.at(-1) as { message: Record<string, unknown> };
  return envelope.message;
}

// The service always hands `broadcast` a full `{ type: "session", message }` envelope (same
// convention as `PermissionService`/`bootstrap.ts`'s real `broadcast`) — forward it verbatim,
// never re-wrap it.
function broadcast(sessions: Iterable<Session>, envelope: unknown): void {
  for (const s of sessions) s.send(envelope);
}

async function wire(): Promise<{
  registry: HandlerRegistry;
  service: AgentUiService;
  client: Session & FakeSession;
  agentSession: MockAgentSession;
}> {
  const client = fakeSession();
  const service = new AgentUiService({ broadcast, getActiveSessions: () => [client] });
  const registry = new HandlerRegistry();
  registerAgentUiHandlers(registry, { service });

  const mockClient = new MockAgentClient();
  const agentSession = (await mockClient.createSession({
    provider: "mock",
    cwd: "/tmp",
  })) as MockAgentSession;
  service.attach("a1", agentSession);

  return { registry, service, client, agentSession };
}

describe("agent_ui_respond_request", () => {
  it("a live dialog resolves: payload.ok === true and the provider receives the answer", async () => {
    const { registry, client, agentSession } = await wire();
    const req = agentSession.emitUiRequest({ method: "confirm" });
    const uiRequestId = (lastMessage(client).requestId as string) ?? "";

    await dispatch(client, registry, {
      type: "agent_ui_respond_request",
      requestId: "r1",
      uiRequestId,
      response: { confirmed: true },
    });

    const response = lastMessage(client);
    expect(response).toMatchObject({
      type: "agent_ui_respond_response",
      requestId: "r1",
      payload: { ok: true },
    });
    expect(agentSession.uiResponses).toEqual([
      { providerRequestId: req.requestId, response: { confirmed: true } },
    ]);
  });

  it("a stale id returns not_found without producing an rpc_error frame", async () => {
    const { registry, client } = await wire();

    await dispatch(client, registry, {
      type: "agent_ui_respond_request",
      requestId: "r1",
      uiRequestId: "does-not-exist",
      response: { confirmed: true },
    });

    const response = lastMessage(client);
    expect(response).toEqual({
      type: "agent_ui_respond_response",
      requestId: "r1",
      payload: { ok: false, error: "not_found" },
    });
    expect(
      client.sent.some((e) => (e as { message: { type: string } }).message.type === "rpc_error"),
    ).toBe(false);
  });
});

describe("agent_ui_list_request", () => {
  it("returns pending dialogs and live surfaces, scoped by agentId when given", async () => {
    const { registry, client, service, agentSession } = await wire();

    const mockClient2 = new MockAgentClient();
    const agentSession2 = (await mockClient2.createSession({
      provider: "mock",
      cwd: "/tmp",
    })) as MockAgentSession;
    service.attach("a2", agentSession2);

    agentSession.emitUiRequest({ method: "confirm" });
    agentSession.emitUiRequest({
      method: "setStatus",
      expectsResponse: false,
      surfaceKey: "status:x",
      payload: { statusText: "running" },
    });
    agentSession2.emitUiRequest({ method: "select" });

    await dispatch(client, registry, {
      type: "agent_ui_list_request",
      requestId: "r1",
      agentId: "a1",
    });
    const scoped = lastMessage(client);
    expect(scoped).toMatchObject({ type: "agent_ui_list_response", requestId: "r1" });
    const scopedPayload = scoped.payload as {
      ok: boolean;
      pending: unknown[];
      surfaces: unknown[];
    };
    expect(scopedPayload.ok).toBe(true);
    expect(scopedPayload.pending).toHaveLength(1);
    expect(scopedPayload.surfaces).toHaveLength(1);

    await dispatch(client, registry, { type: "agent_ui_list_request", requestId: "r2" });
    const all = lastMessage(client);
    const allPayload = all.payload as { pending: unknown[]; surfaces: unknown[] };
    expect(allPayload.pending).toHaveLength(2);
    expect(allPayload.surfaces).toHaveLength(1);
  });
});
