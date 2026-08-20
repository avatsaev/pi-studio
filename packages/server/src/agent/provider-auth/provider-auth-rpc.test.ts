import { describe, expect, it, vi } from "vitest";

import { HandlerRegistry, routeTextFrame } from "../../ws/router.js";
import { SessionSubscriptions } from "../../ws/session-subscriptions.js";
import type { Session } from "../../ws/session.js";
import type { PiAuthRuntime } from "./pi-auth-runtime.js";
import { registerProviderAuthHandlers } from "./provider-auth-rpc.js";
import { PROVIDER_AUTH_FLOW_KEY_PREFIX, ProviderAuthService } from "./provider-auth-service.js";

/**
 * `registerProviderAuthHandlers` tests (swe/features/provider-auth-rpc.md § Public Contract;
 * sprint-055/task-004). Two layers:
 *
 * - "handler wiring" drives `routeTextFrame` against a *fake* `ProviderAuthService` — pure
 *   adapter behavior: registration, response envelopes, and defensive input coercion. This module
 *   deliberately owns no `SessionSubscriptions` state of its own (see `provider-auth-rpc.ts`'s
 *   header comment for why), so there is nothing subscription-shaped to assert here.
 * - "end-to-end via the router" drives it against a *real* `ProviderAuthService` (fake
 *   `PiAuthRuntime`, real `SessionSubscriptions` passed to the service's own constructor — exactly
 *   how `bootstrap.ts` wires it) to prove the disconnect-cancellation acceptance criterion holds
 *   through the actual `routeTextFrame` dispatch path, not just through direct service calls
 *   (which `provider-auth-service.test.ts`'s own "SessionSubscriptions ownership" suite already
 *   covers in detail).
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

function flowEvents(
  session: Session & FakeSession,
): { flowId: string; event: Record<string, unknown> }[] {
  return session.sent
    .map((e) => e as { type: string; message: Record<string, unknown> })
    .filter((e) => e.type === "session" && e.message?.type === "provider_auth_flow_event")
    .map((e) => ({
      flowId: e.message.flowId as string,
      event: e.message.event as Record<string, unknown>,
    }));
}

// ---------------------------------------------------------------------------
// Handler wiring (fake service)
// ---------------------------------------------------------------------------

interface FakeProviderAuthService {
  listProviders: ReturnType<typeof vi.fn>;
  login: ReturnType<typeof vi.fn>;
  respond: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  logout: ReturnType<typeof vi.fn>;
}

function fakeProviderAuthService(
  overrides: Partial<FakeProviderAuthService> = {},
): FakeProviderAuthService & ProviderAuthService {
  const service: FakeProviderAuthService = {
    listProviders: vi.fn(async () => ({ ok: true, providers: [] })),
    login: vi.fn(async () => ({ ok: true, flowId: "flow-1" })),
    respond: vi.fn(() => ({ ok: true })),
    cancel: vi.fn(() => ({ ok: true })),
    logout: vi.fn(async () => ({ ok: true, stillConfigured: false })),
    ...overrides,
  };
  return service as unknown as FakeProviderAuthService & ProviderAuthService;
}

function wireFake(service: FakeProviderAuthService & ProviderAuthService): HandlerRegistry {
  const registry = new HandlerRegistry();
  registerProviderAuthHandlers(registry, { providerAuthService: service });
  return registry;
}

describe("registerProviderAuthHandlers — handler wiring", () => {
  it("registers all five types, each returning its documented response shape correlated by the router", async () => {
    const service = fakeProviderAuthService();
    const registry = wireFake(service);
    const session = fakeSession();

    await dispatch(session, registry, {
      type: "provider_auth_list_request",
      requestId: "r1",
    });
    await dispatch(session, registry, {
      type: "provider_auth_login_request",
      requestId: "r2",
      provider: "openai",
      authType: "api_key",
    });
    await dispatch(session, registry, {
      type: "provider_auth_respond_request",
      requestId: "r3",
      flowId: "flow-1",
      promptId: "p1",
      value: "sk-test",
    });
    await dispatch(session, registry, {
      type: "provider_auth_cancel_request",
      requestId: "r4",
      flowId: "flow-1",
    });
    await dispatch(session, registry, {
      type: "provider_auth_logout_request",
      requestId: "r5",
      provider: "openai",
    });

    expect(session.sent).toEqual([
      {
        type: "session",
        message: {
          type: "provider_auth_list_response",
          payload: { ok: true, providers: [] },
          requestId: "r1",
        },
      },
      {
        type: "session",
        message: {
          type: "provider_auth_login_response",
          payload: { ok: true, flowId: "flow-1" },
          requestId: "r2",
        },
      },
      {
        type: "session",
        message: {
          type: "provider_auth_respond_response",
          payload: { ok: true },
          requestId: "r3",
        },
      },
      {
        type: "session",
        message: {
          type: "provider_auth_cancel_response",
          payload: { ok: true },
          requestId: "r4",
        },
      },
      {
        type: "session",
        message: {
          type: "provider_auth_logout_response",
          payload: { ok: true, stillConfigured: false },
          requestId: "r5",
        },
      },
    ]);
    expect(service.login).toHaveBeenCalledWith(session, "openai", "api_key");
    expect(service.respond).toHaveBeenCalledWith(session, "flow-1", "p1", "sk-test");
    expect(service.cancel).toHaveBeenCalledWith(session, "flow-1");
    expect(service.logout).toHaveBeenCalledWith("openai");
  });

  it("rejects an unsupported authType without ever calling the service, adds no policy of its own", async () => {
    const service = fakeProviderAuthService();
    const registry = wireFake(service);
    const session = fakeSession();

    await dispatch(session, registry, {
      type: "provider_auth_login_request",
      requestId: "r1",
      provider: "openai",
      authType: "sms",
    });

    expect(lastMessage(session)).toEqual({
      type: "provider_auth_login_response",
      payload: { ok: false, error: "unsupported_auth_type" },
      requestId: "r1",
    });
    expect(service.login).not.toHaveBeenCalled();
  });

  it("a missing authType is treated the same as an unsupported one — never thrown, never reaches the service", async () => {
    const service = fakeProviderAuthService();
    const registry = wireFake(service);
    const session = fakeSession();

    await dispatch(session, registry, {
      type: "provider_auth_login_request",
      requestId: "r1",
      provider: "openai",
    });

    expect(lastMessage(session).payload).toEqual({ ok: false, error: "unsupported_auth_type" });
    expect(service.login).not.toHaveBeenCalled();
  });

  it("lets the service decide unknown_provider — an empty/missing provider is coerced, not special-cased", async () => {
    const service = fakeProviderAuthService({
      login: vi.fn(async () => ({ ok: false, error: "unknown_provider" })),
    });
    const registry = wireFake(service);
    const session = fakeSession();

    await dispatch(session, registry, {
      type: "provider_auth_login_request",
      requestId: "r1",
      authType: "api_key",
    });

    expect(service.login).toHaveBeenCalledWith(session, "", "api_key");
    expect(lastMessage(session).payload).toEqual({ ok: false, error: "unknown_provider" });
  });

  it("respond/cancel coerce missing flowId/promptId/value to empty strings rather than throwing", async () => {
    const service = fakeProviderAuthService({
      respond: vi.fn(() => ({ ok: false, error: "not_found" })),
      cancel: vi.fn(() => ({ ok: true })),
    });
    const registry = wireFake(service);
    const session = fakeSession();

    await dispatch(session, registry, { type: "provider_auth_respond_request", requestId: "r1" });
    expect(service.respond).toHaveBeenCalledWith(session, "", "", "");
    expect(lastMessage(session).payload).toEqual({ ok: false, error: "not_found" });

    await dispatch(session, registry, { type: "provider_auth_cancel_request", requestId: "r2" });
    expect(service.cancel).toHaveBeenCalledWith(session, "");
    expect(lastMessage(session).payload).toEqual({ ok: true });

    // Never a thrown handler_error for malformed input.
    const hasRpcError = session.sent.some((e) => {
      const envelope = e as { message?: { type?: string } };
      return envelope.message?.type === "rpc_error";
    });
    expect(hasRpcError).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// End-to-end via the router (real ProviderAuthService, fake PiAuthRuntime)
// ---------------------------------------------------------------------------

function fakeRuntime(overrides: Partial<PiAuthRuntime> = {}): PiAuthRuntime {
  return {
    listProviders: async () => [{ id: "openai", name: "OpenAI", authTypes: ["api_key"] }],
    checkAuth: async () => ({ configured: false }),
    login: async () => ({ type: "api_key" }),
    logout: async () => ({ stillConfigured: false }),
    authPathLabel: () => "/x/auth.json",
    ...overrides,
  };
}

/** Boots a real `ProviderAuthService` wired exactly like `bootstrap.ts`: `subscriptions` is passed
 *  to the service's own constructor (task-004's SessionSubscriptions-ownership deviation — see
 *  `provider-auth-service.ts`'s class doc comment), not to `registerProviderAuthHandlers`. */
function wireReal(runtime: PiAuthRuntime): {
  registry: HandlerRegistry;
  subscriptions: SessionSubscriptions;
} {
  const subscriptions = new SessionSubscriptions();
  const service = new ProviderAuthService({ runtime, subscriptions });
  const registry = new HandlerRegistry();
  registerProviderAuthHandlers(registry, { providerAuthService: service });
  return { registry, subscriptions };
}

describe("registerProviderAuthHandlers — end-to-end via the router", () => {
  it("a login flow started over the router, then session close (disposeSession), cancels the flow", async () => {
    const hang = new Promise<never>(() => {});
    const { registry, subscriptions } = wireReal(fakeRuntime({ login: async () => hang }));
    const session = fakeSession();

    await dispatch(session, registry, {
      type: "provider_auth_login_request",
      requestId: "r1",
      provider: "openai",
      authType: "api_key",
    });
    const flowId = lastMessage(session).payload as { flowId: string };
    expect(subscriptions.keysOf(session)).toEqual([
      `${PROVIDER_AUTH_FLOW_KEY_PREFIX}${flowId.flowId}`,
    ]);

    subscriptions.disposeSession(session);

    const events = flowEvents(session);
    expect(events.at(-1)?.event).toEqual({ kind: "done", ok: false, error: "cancelled" });
    expect(subscriptions.keysOf(session)).toEqual([]);
  });

  it("an explicit provider_auth_cancel_request removes the subscription key — no stale disposer remains", async () => {
    const hang = new Promise<never>(() => {});
    const { registry, subscriptions } = wireReal(fakeRuntime({ login: async () => hang }));
    const session = fakeSession();

    await dispatch(session, registry, {
      type: "provider_auth_login_request",
      requestId: "r1",
      provider: "openai",
      authType: "api_key",
    });
    const flowId = lastMessage(session).payload as { flowId: string };

    await dispatch(session, registry, {
      type: "provider_auth_cancel_request",
      requestId: "r2",
      flowId: flowId.flowId,
    });

    expect(subscriptions.keysOf(session)).toEqual([]);
    const events = flowEvents(session);
    expect(events.at(-1)?.event).toEqual({ kind: "done", ok: false, error: "cancelled" });
  });

  it("a flow that completes normally also leaves no subscription key behind", async () => {
    const { registry, subscriptions } = wireReal(
      fakeRuntime({ login: async () => ({ type: "api_key" }) }),
    );
    const session = fakeSession();

    await dispatch(session, registry, {
      type: "provider_auth_login_request",
      requestId: "r1",
      provider: "openai",
      authType: "api_key",
    });

    expect(subscriptions.keysOf(session)).toEqual([]);
    const events = flowEvents(session);
    expect(events.at(-1)?.event).toEqual({ kind: "done", ok: true, error: undefined });
  });
});
