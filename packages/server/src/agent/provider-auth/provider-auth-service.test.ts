import { afterEach, describe, expect, it, vi } from "vitest";

import type { Logger } from "../../logging/logger.js";
import { SessionSubscriptions } from "../../ws/session-subscriptions.js";
import type { Session } from "../../ws/session.js";
import type { AuthInteractionLike, AuthPromptLike, PiAuthRuntime } from "./pi-auth-runtime.js";
import { PROVIDER_AUTH_FLOW_KEY_PREFIX, ProviderAuthService } from "./provider-auth-service.js";

/**
 * `ProviderAuthService` tests (swe/features/provider-auth-rpc.md § Behavior & Algorithms). Every
 * test drives a fake `PiAuthRuntime` (scriptable `login` that calls `notify`/`prompt`) and fake
 * `Session` objects recording `send()` calls — no WebSocket, no Pi, no network.
 */

interface FlowEventEnvelope {
  type: "session";
  message: { type: "provider_auth_flow_event"; flowId: string; event: Record<string, unknown> };
}

interface FakeSession {
  send: (envelope: unknown) => void;
  sent: unknown[];
}

function fakeSession(): Session & FakeSession {
  const sent: unknown[] = [];
  const session: FakeSession = { send: (envelope) => sent.push(envelope), sent };
  return session as unknown as Session & FakeSession;
}

function flowEvents(
  session: Session & FakeSession,
): { flowId: string; event: Record<string, unknown> }[] {
  return session.sent
    .filter((e): e is FlowEventEnvelope => {
      const env = e as FlowEventEnvelope;
      return env.type === "session" && env.message?.type === "provider_auth_flow_event";
    })
    .map((e) => ({ flowId: e.message.flowId, event: e.message.event }));
}

function fakeLogger(): { logger: Logger; lines: unknown[] } {
  const lines: unknown[] = [];
  const record = (obj: unknown, msg?: unknown): void => {
    lines.push(obj);
    if (msg !== undefined) lines.push(msg);
  };
  const logger = {
    trace: record,
    debug: record,
    info: record,
    warn: record,
    error: record,
    fatal: record,
    child: () => logger,
  } as unknown as Logger;
  return { logger, lines };
}

function fakeRuntime(overrides: Partial<PiAuthRuntime> = {}): PiAuthRuntime {
  return {
    listProviders: async () => [
      { id: "openai", name: "OpenAI", authTypes: ["api_key"] },
      { id: "chatgpt", name: "ChatGPT", authTypes: ["oauth"], oauthLoginLabel: "Sign in" },
    ],
    checkAuth: async () => ({ configured: false }),
    login: async () => ({ type: "api_key" }),
    logout: async () => ({ stillConfigured: false }),
    authPathLabel: () => "/x/auth.json",
    ...overrides,
  };
}

/** Flushes the microtask queue AND any pending macrotasks (real timers only — never call this
 *  under `vi.useFakeTimers()`). */
function flush(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  return promise;
}

afterEach(() => {
  vi.useRealTimers();
});

// ─── api_key round trip ──────────────────────────────────────────────────────────────

describe("ProviderAuthService — api_key flow", () => {
  it("round-trips login -> prompt(secret) -> respond -> done ok:true, and the fake runtime receives the entered value", async () => {
    let capturedValue: string | undefined;
    const runtime = fakeRuntime({
      login: async (_id, _type, interaction: AuthInteractionLike) => {
        interaction.notify({ type: "info", message: "starting" });
        capturedValue = await interaction.prompt({ type: "secret", message: "API key" });
        return { type: "api_key" };
      },
    });
    const service = new ProviderAuthService({ runtime });
    const session = fakeSession();

    const loginResult = await service.login(session, "openai", "api_key");
    expect(loginResult.ok).toBe(true);
    const flowId = loginResult.flowId;
    expect(flowId).toBeDefined();

    const promptEvent = flowEvents(session).find((e) => e.event.kind === "prompt");
    expect(promptEvent).toBeDefined();
    const promptId = promptEvent!.event.promptId as string;
    expect(promptEvent!.event.promptKind).toBe("secret");

    const respondResult = service.respond(session, flowId!, promptId, "sk-test-123");
    expect(respondResult).toEqual({ ok: true });

    await flush();
    expect(capturedValue).toBe("sk-test-123");
    const doneEvent = flowEvents(session).find((e) => e.event.kind === "done");
    expect(doneEvent?.event).toEqual({ kind: "done", ok: true, error: undefined });
  });
});

// ─── OAuth-shaped flow ────────────────────────────────────────────────────────────────

describe("ProviderAuthService — oauth flow", () => {
  it("round-trips auth_url -> manual_code prompt -> respond -> done ok", async () => {
    let capturedCode: string | undefined;
    const runtime = fakeRuntime({
      login: async (_id, _type, interaction: AuthInteractionLike) => {
        interaction.notify({ type: "auth_url", url: "https://example.com/authorize" });
        capturedCode = await interaction.prompt({ type: "manual_code", message: "Paste the code" });
        return { type: "oauth" };
      },
    });
    const service = new ProviderAuthService({ runtime });
    const session = fakeSession();

    const { flowId } = await service.login(session, "chatgpt", "oauth");
    const authUrlEvent = flowEvents(session).find((e) => e.event.kind === "auth_url");
    expect(authUrlEvent?.event).toEqual({ kind: "auth_url", url: "https://example.com/authorize" });

    const promptEvent = flowEvents(session).find((e) => e.event.kind === "prompt");
    const promptId = promptEvent!.event.promptId as string;
    expect(promptEvent!.event.promptKind).toBe("manual_code");

    service.respond(session, flowId!, promptId, "ABC-123");
    await flush();
    expect(capturedCode).toBe("ABC-123");
    expect(flowEvents(session).find((e) => e.event.kind === "done")?.event).toEqual({
      kind: "done",
      ok: true,
      error: undefined,
    });
  });
});

// ─── per-prompt signal cancellation (out-of-band resolution) ─────────────────────────

describe("ProviderAuthService — per-prompt signal", () => {
  it("aborting a prompt's own signal pushes prompt_cancelled for that promptId, rejects only that prompt, and leaves the flow alive", async () => {
    const promptAbort = new AbortController();
    let secondPromptValue: string | undefined;
    const runtime = fakeRuntime({
      login: async (_id, _type, interaction: AuthInteractionLike) => {
        try {
          await interaction.prompt({
            type: "manual_code",
            message: "code",
            signal: promptAbort.signal,
          } as AuthPromptLike);
        } catch {
          // out-of-band resolution (e.g. an OAuth callback won the race) — the flow continues
        }
        secondPromptValue = await interaction.prompt({ type: "text", message: "confirm" });
        return { type: "oauth" };
      },
    });
    const service = new ProviderAuthService({ runtime });
    const session = fakeSession();

    const { flowId } = await service.login(session, "chatgpt", "oauth");
    const firstPromptId = flowEvents(session).find((e) => e.event.kind === "prompt")!.event
      .promptId as string;

    promptAbort.abort();
    expect(flowEvents(session).find((e) => e.event.kind === "prompt_cancelled")?.event).toEqual({
      kind: "prompt_cancelled",
      promptId: firstPromptId,
    });

    await flush();
    const secondPrompt = flowEvents(session).filter((e) => e.event.kind === "prompt")[1];
    expect(secondPrompt).toBeDefined();
    const secondPromptId = secondPrompt!.event.promptId as string;
    expect(secondPromptId).not.toBe(firstPromptId);

    const respondResult = service.respond(session, flowId!, secondPromptId, "confirmed");
    expect(respondResult).toEqual({ ok: true });
    await flush();
    expect(secondPromptValue).toBe("confirmed");
    expect(flowEvents(session).some((e) => e.event.kind === "done" && e.event.ok === true)).toBe(
      true,
    );
  });
});

// ─── cancel / TTL / disconnect-shaped termination ─────────────────────────────────────

describe("ProviderAuthService — cancel and timeout", () => {
  it("cancel() aborts the flow, rejects the pending prompt, and emits exactly one done ok:false 'cancelled'", async () => {
    const runtime = fakeRuntime({
      login: async (_id, _type, interaction: AuthInteractionLike) => {
        await interaction.prompt({ type: "text", message: "waiting" });
        return { type: "api_key" };
      },
    });
    const service = new ProviderAuthService({ runtime });
    const session = fakeSession();
    const { flowId } = await service.login(session, "openai", "api_key");

    const cancelResult = service.cancel(session, flowId!);
    expect(cancelResult).toEqual({ ok: true });
    await flush();

    const doneEvents = flowEvents(session).filter((e) => e.event.kind === "done");
    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0]!.event).toEqual({ kind: "done", ok: false, error: "cancelled" });
  });

  it("cancel() is idempotent for an unknown or already-gone flowId", () => {
    const service = new ProviderAuthService({ runtime: fakeRuntime() });
    const session = fakeSession();
    expect(service.cancel(session, "nonexistent-flow")).toEqual({ ok: true });
  });

  it("cancel() from a different session than the flow's owner is a silent no-op, still returning ok:true", async () => {
    const runtime = fakeRuntime({
      login: async (_id, _type, interaction: AuthInteractionLike) => {
        await interaction.prompt({ type: "text", message: "waiting" });
        return { type: "api_key" };
      },
    });
    const service = new ProviderAuthService({ runtime });
    const owner = fakeSession();
    const stranger = fakeSession();
    const { flowId } = await service.login(owner, "openai", "api_key");

    expect(service.cancel(stranger, flowId!)).toEqual({ ok: true });
    await flush();
    expect(flowEvents(owner).some((e) => e.event.kind === "done")).toBe(false);
  });

  it("TTL expiry aborts the flow and emits done ok:false 'timeout'", async () => {
    vi.useFakeTimers();
    const runtime = fakeRuntime({
      login: () => new Promise<never>(() => {}), // never settles on its own
    });
    const service = new ProviderAuthService({ runtime, ttlMs: 50 });
    const session = fakeSession();
    await service.login(session, "openai", "api_key");

    await vi.advanceTimersByTimeAsync(50);
    const doneEvents = flowEvents(session).filter((e) => e.event.kind === "done");
    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0]!.event).toEqual({ kind: "done", ok: false, error: "timeout" });
  });

  it("reports 'cancelled' even when the fake runtime's login() rejects with its own generic error after a cancel", async () => {
    const runtime = fakeRuntime({
      login: async (_id, _type, interaction: AuthInteractionLike) => {
        try {
          await interaction.prompt({ type: "manual_code", message: "code" });
        } catch {
          // Simulate Pi's own generic AbortError — deliberately a different error than whatever
          // the service's own prompt rejection carried, to prove the service never inspects it.
          throw new Error("AbortError");
        }
        return { type: "oauth" };
      },
    });
    const service = new ProviderAuthService({ runtime });
    const session = fakeSession();
    const { flowId } = await service.login(session, "chatgpt", "oauth");

    service.cancel(session, flowId!);
    await flush();

    const doneEvents = flowEvents(session).filter((e) => e.event.kind === "done");
    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0]!.event).toEqual({ kind: "done", ok: false, error: "cancelled" });
  });
});

// ─── second login cancels the first ────────────────────────────────────────────────

describe("ProviderAuthService — one flow per session", () => {
  it("a second login from the same session cancels the first and starts a new one", async () => {
    const runtime = fakeRuntime({
      login: async (_id, _type, interaction: AuthInteractionLike) => {
        await interaction.prompt({ type: "text", message: "waiting" });
        return { type: "api_key" };
      },
    });
    const service = new ProviderAuthService({ runtime });
    const session = fakeSession();

    const first = await service.login(session, "openai", "api_key");
    const second = await service.login(session, "openai", "api_key");

    expect(first.flowId).not.toBe(second.flowId);
    await flush();

    const firstFlowDone = flowEvents(session).find(
      (e) => e.flowId === first.flowId && e.event.kind === "done",
    );
    expect(firstFlowDone?.event).toEqual({ kind: "done", ok: false, error: "cancelled" });
    expect(
      flowEvents(session).some((e) => e.flowId === second.flowId && e.event.kind === "done"),
    ).toBe(false);
  });
});

// ─── respond edge cases ─────────────────────────────────────────────────────────────

describe("ProviderAuthService — respond edge cases", () => {
  it("respond with an unknown flowId returns not_found and leaves state untouched", () => {
    const service = new ProviderAuthService({ runtime: fakeRuntime() });
    const session = fakeSession();
    expect(service.respond(session, "nonexistent", "p1", "v")).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("respond with a stale promptId returns not_found without disturbing the live prompt", async () => {
    const runtime = fakeRuntime({
      login: async (_id, _type, interaction: AuthInteractionLike) => {
        await interaction.prompt({ type: "secret", message: "key" });
        return { type: "api_key" };
      },
    });
    const service = new ProviderAuthService({ runtime });
    const session = fakeSession();
    const { flowId } = await service.login(session, "openai", "api_key");

    expect(service.respond(session, flowId!, "not-the-real-promptId", "v")).toEqual({
      ok: false,
      error: "not_found",
    });
    // the real pending prompt is still answerable afterward
    const promptId = flowEvents(session).find((e) => e.event.kind === "prompt")!.event
      .promptId as string;
    expect(service.respond(session, flowId!, promptId, "sk-1")).toEqual({ ok: true });
  });

  it("respond from a different session than the flow's owner returns not_found", async () => {
    const runtime = fakeRuntime({
      login: async (_id, _type, interaction: AuthInteractionLike) => {
        await interaction.prompt({ type: "secret", message: "key" });
        return { type: "api_key" };
      },
    });
    const service = new ProviderAuthService({ runtime });
    const owner = fakeSession();
    const stranger = fakeSession();
    const { flowId } = await service.login(owner, "openai", "api_key");
    const promptId = flowEvents(owner).find((e) => e.event.kind === "prompt")!.event
      .promptId as string;

    expect(service.respond(stranger, flowId!, promptId, "sk-1")).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});

// ─── login validation ────────────────────────────────────────────────────────────────

describe("ProviderAuthService — login validation", () => {
  it("rejects an unknown provider before creating a flow", async () => {
    const service = new ProviderAuthService({ runtime: fakeRuntime() });
    const session = fakeSession();
    expect(await service.login(session, "does-not-exist", "api_key")).toEqual({
      ok: false,
      error: "unknown_provider",
    });
    expect(flowEvents(session)).toHaveLength(0);
  });

  it("rejects an unsupported auth type for a real provider before creating a flow", async () => {
    const service = new ProviderAuthService({ runtime: fakeRuntime() });
    const session = fakeSession();
    // "openai" only supports api_key in the fake provider list
    expect(await service.login(session, "openai", "oauth")).toEqual({
      ok: false,
      error: "unsupported_auth_type",
    });
    expect(flowEvents(session)).toHaveLength(0);
  });

  it("reports provider_auth_unavailable when the runtime cannot be constructed", async () => {
    const runtime = fakeRuntime({
      listProviders: async () => {
        throw new Error("ModelRuntime.create failed");
      },
    });
    const service = new ProviderAuthService({ runtime });
    const session = fakeSession();
    expect(await service.login(session, "openai", "api_key")).toEqual({
      ok: false,
      error: "provider_auth_unavailable",
    });
  });
});

// ─── ownership: events go only to the initiating session ──────────────────────────

describe("ProviderAuthService — session isolation", () => {
  it("flow events are sent only to the owning session; a second session receives nothing", async () => {
    const runtime = fakeRuntime({
      login: async (_id, _type, interaction: AuthInteractionLike) => {
        interaction.notify({ type: "info", message: "hi" });
        return { type: "api_key" };
      },
    });
    const service = new ProviderAuthService({ runtime });
    const owner = fakeSession();
    const bystander = fakeSession();
    await service.login(owner, "openai", "api_key");
    await flush();

    expect(flowEvents(owner).length).toBeGreaterThan(0);
    expect(bystander.sent).toHaveLength(0);
  });
});

// ─── no leaks ─────────────────────────────────────────────────────────────────────

describe("ProviderAuthService — no leaks", () => {
  it("after cancel, timeout, and normal completion the flow registry is empty", async () => {
    vi.useFakeTimers();
    const hungRuntime = fakeRuntime({ login: () => new Promise<never>(() => {}) });
    const serviceA = new ProviderAuthService({ runtime: hungRuntime, ttlMs: 20 });
    const sessionA = fakeSession();
    await serviceA.login(sessionA, "openai", "api_key");
    await vi.advanceTimersByTimeAsync(20);
    // A second login from the same session must not see a stale "existing flow" — proves the
    // registry was actually cleared, not just externally unobservable.
    const second = await serviceA.login(sessionA, "openai", "api_key");
    expect(second.ok).toBe(true);
    vi.useRealTimers();

    const completingRuntime = fakeRuntime({ login: async () => ({ type: "api_key" }) });
    const serviceB = new ProviderAuthService({ runtime: completingRuntime });
    const sessionB = fakeSession();
    await serviceB.login(sessionB, "openai", "api_key");
    await flush();
    // A cancel after natural completion must be a harmless no-op (nothing left to cancel).
    const flowIdB = flowEvents(sessionB)[0]!.flowId;
    expect(serviceB.cancel(sessionB, flowIdB)).toEqual({ ok: true });
    expect(flowEvents(sessionB).filter((e) => e.event.kind === "done")).toHaveLength(1);
  });
});

// ─── secrets never logged or echoed ────────────────────────────────────────────────

describe("ProviderAuthService — secret hygiene", () => {
  it("the entered secret value appears in no log line and no sent frame", async () => {
    const SECRET = "sk-super-secret-value-should-never-leak";
    const runtime = fakeRuntime({
      login: async (_id, _type, interaction: AuthInteractionLike) => {
        await interaction.prompt({ type: "secret", message: "API key" });
        return { type: "api_key" };
      },
    });
    const { logger, lines } = fakeLogger();
    const service = new ProviderAuthService({ runtime, logger });
    const session = fakeSession();
    const { flowId } = await service.login(session, "openai", "api_key");
    const promptId = flowEvents(session).find((e) => e.event.kind === "prompt")!.event
      .promptId as string;

    service.respond(session, flowId!, promptId, SECRET);
    await flush();

    const framesText = JSON.stringify(session.sent);
    expect(framesText).not.toContain(SECRET);
    const logText = JSON.stringify(lines);
    expect(logText).not.toContain(SECRET);
  });
});

// ─── listProviders ────────────────────────────────────────────────────────────────

describe("ProviderAuthService — listProviders", () => {
  it("composes provider metadata with a per-provider checkAuth result", async () => {
    const runtime = fakeRuntime({
      checkAuth: async (providerId: string) =>
        providerId === "openai"
          ? { configured: true, type: "api_key", source: "env:OPENAI_API_KEY" }
          : { configured: false },
    });
    const service = new ProviderAuthService({ runtime });
    const result = await service.listProviders();
    expect(result.ok).toBe(true);
    expect(result.providers).toEqual([
      {
        id: "openai",
        name: "OpenAI",
        authTypes: ["api_key"],
        oauthLoginLabel: undefined,
        oauthIsSubscription: undefined,
        configured: true,
        configuredType: "api_key",
        configuredSource: "env:OPENAI_API_KEY",
      },
      {
        id: "chatgpt",
        name: "ChatGPT",
        authTypes: ["oauth"],
        oauthLoginLabel: "Sign in",
        oauthIsSubscription: undefined,
        configured: false,
        configuredType: undefined,
        configuredSource: undefined,
      },
    ]);
  });

  it("degrades to ok:false when the runtime cannot be constructed, without throwing", async () => {
    const runtime = fakeRuntime({
      listProviders: async () => {
        throw new Error("ModelRuntime.create failed");
      },
    });
    const service = new ProviderAuthService({ runtime });
    expect(await service.listProviders()).toEqual({ ok: false, providers: [] });
  });
});

// ─── logout ───────────────────────────────────────────────────────────────────────

describe("ProviderAuthService — logout", () => {
  it("delegates to the runtime and forwards stillConfigured", async () => {
    const runtime = fakeRuntime({ logout: async () => ({ stillConfigured: true }) });
    const service = new ProviderAuthService({ runtime });
    expect(await service.logout("openai")).toEqual({ ok: true, stillConfigured: true });
  });

  it("reports ok:false with a sanitized error when the runtime rejects", async () => {
    const runtime = fakeRuntime({
      logout: async () => {
        throw new Error("boom");
      },
    });
    const service = new ProviderAuthService({ runtime });
    expect(await service.logout("openai")).toEqual({ ok: false, error: "boom" });
  });
});

// ─── SessionSubscriptions ownership (sprint-055/task-004) ──────────────────────────────

describe("ProviderAuthService — SessionSubscriptions ownership", () => {
  it("login registers the provider_auth_flow:<flowId> disposer while the flow is in flight", async () => {
    const hang = new Promise<never>(() => {});
    const runtime = fakeRuntime({ login: async () => hang });
    const subscriptions = new SessionSubscriptions();
    const service = new ProviderAuthService({ runtime, subscriptions });
    const session = fakeSession();

    const { flowId } = await service.login(session, "openai", "api_key");
    expect(subscriptions.keysOf(session)).toEqual([`${PROVIDER_AUTH_FLOW_KEY_PREFIX}${flowId}`]);
  });

  it("a fast-resolving runtime still leaves no stale entry: the flow can settle (removing it) before login()'s own promise even resolves — proving the add can never lose the race", async () => {
    // Nothing else pending after the microtask `runtime.login` needs — the shape that exposed the
    // RPC-layer-owns-subscriptions race this design avoids (see provider-auth-service.ts's class
    // doc comment): had the subscription been added by an *awaiting caller* instead of inside
    // `login()` itself, this runtime settles fast enough that the entry would sometimes be added
    // *after* the flow already ended — a disposer that's already stale the moment it's created.
    const runtime = fakeRuntime({ login: async () => ({ type: "api_key" }) });
    const subscriptions = new SessionSubscriptions();
    const service = new ProviderAuthService({ runtime, subscriptions });
    const session = fakeSession();

    await service.login(session, "openai", "api_key");
    // No flush() — by the time `login()`'s own promise resolves, its net effect (add, immediately
    // followed by remove, both inside this service's own synchronous/microtask chain — never a
    // caller-owned `await` boundary) has already fully played out.
    expect(subscriptions.keysOf(session)).toEqual([]);
    expect(flowEvents(session).find((e) => e.event.kind === "done")?.event.ok).toBe(true);
  });

  it("an explicit cancel() removes the subscription entry", async () => {
    const hang = new Promise<never>(() => {});
    const runtime = fakeRuntime({ login: async () => hang });
    const subscriptions = new SessionSubscriptions();
    const service = new ProviderAuthService({ runtime, subscriptions });
    const session = fakeSession();

    const { flowId } = await service.login(session, "openai", "api_key");
    expect(subscriptions.keysOf(session)).toEqual([`${PROVIDER_AUTH_FLOW_KEY_PREFIX}${flowId}`]);

    service.cancel(session, flowId!);
    expect(subscriptions.keysOf(session)).toEqual([]);
  });

  it("TTL expiry removes the subscription entry", async () => {
    vi.useFakeTimers();
    const hang = new Promise<never>(() => {});
    const runtime = fakeRuntime({ login: async () => hang });
    const subscriptions = new SessionSubscriptions();
    const service = new ProviderAuthService({ runtime, subscriptions, ttlMs: 50 });
    const session = fakeSession();

    const { flowId } = await service.login(session, "openai", "api_key");
    expect(subscriptions.keysOf(session)).toEqual([`${PROVIDER_AUTH_FLOW_KEY_PREFIX}${flowId}`]);

    await vi.advanceTimersByTimeAsync(50);
    expect(subscriptions.keysOf(session)).toEqual([]);
  });

  it("invoking the registered disposer directly (simulating SessionSubscriptions.disposeSession on socket close) cancels the flow", async () => {
    const hang = new Promise<never>(() => {});
    const runtime = fakeRuntime({ login: async () => hang });
    const subscriptions = new SessionSubscriptions();
    const service = new ProviderAuthService({ runtime, subscriptions });
    const session = fakeSession();

    await service.login(session, "openai", "api_key");
    subscriptions.disposeSession(session);

    const doneEvent = flowEvents(session).find((e) => e.event.kind === "done");
    expect(doneEvent?.event).toEqual({ kind: "done", ok: false, error: "cancelled" });
    expect(subscriptions.keysOf(session)).toEqual([]);
  });

  it("a second login superseding the first removes the first flow's subscription entry and registers a new one", async () => {
    const hang = new Promise<never>(() => {});
    const runtime = fakeRuntime({ login: async () => hang });
    const subscriptions = new SessionSubscriptions();
    const service = new ProviderAuthService({ runtime, subscriptions });
    const session = fakeSession();

    const first = await service.login(session, "openai", "api_key");
    const second = await service.login(session, "openai", "api_key");

    expect(subscriptions.keysOf(session)).toEqual([
      `${PROVIDER_AUTH_FLOW_KEY_PREFIX}${second.flowId}`,
    ]);
    expect(second.flowId).not.toBe(first.flowId);
  });

  it("works unchanged with no subscriptions dep configured (subscriptions is optional)", async () => {
    const runtime = fakeRuntime({ login: async () => ({ type: "api_key" }) });
    const service = new ProviderAuthService({ runtime });
    const session = fakeSession();

    const result = await service.login(session, "openai", "api_key");
    expect(result.ok).toBe(true);
    await flush();
    expect(flowEvents(session).find((e) => e.event.kind === "done")?.event.ok).toBe(true);
  });
});
