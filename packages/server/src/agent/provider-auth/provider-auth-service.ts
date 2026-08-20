import { randomUUID } from "node:crypto";

import type { ProviderAuthInfo, ProviderAuthType } from "@av-pi-studio/protocol";

import type { Logger } from "../../logging/logger.js";
import type { SessionSubscriptions } from "../../ws/session-subscriptions.js";
import type { Session } from "../../ws/session.js";
import type {
  AuthEventLike,
  AuthInteractionLike,
  AuthPromptLike,
  PiAuthRuntime,
} from "./pi-auth-runtime.js";

/**
 * Turns Pi's callback-style `AuthInteraction` into daemon-side flow state
 * (swe/features/provider-auth-rpc.md § Behavior & Algorithms). Pi drives login by *calling back* —
 * `notify(event)` (synchronous) and `prompt(p): Promise<string>` — and this service inverts that
 * into messages: emit a per-session push, park the promise, resolve it when
 * `provider_auth_respond_request` answers it later.
 *
 * Ownership model: one active flow per session (a second `login` cancels the first); flow events
 * go only to the initiating session; `respond` for a flowId/promptId not owned by the caller
 * returns the same opaque `not_found` as an unknown flowId (existence is never leaked). `cancel` is
 * unconditionally idempotent (`{ ok: true }`, no `error` field on the wire — see
 * `providerAuthCancelResponseSchema`) — a cross-session or already-gone flowId is a silent no-op,
 * never an error, so it cannot leak existence either.
 *
 * Owns its `SessionSubscriptions` entry too (task-004 deviation from the task's own pseudocode —
 * see that task's summary for why): `login` registers `provider_auth_flow:<flowId>` *synchronously*,
 * in the same tick the flow is created, and `settleFlow` removes it. Letting the RPC layer own the
 * add/remove instead (as originally specced) has a real race — Pi's `runtime.login()` can settle
 * before the awaited `service.login()` call even returns to the RPC handler when the underlying
 * provider resolves fast (trivially so with a synchronous fake in tests, but nothing rules it out
 * in production either), so the subscription would sometimes get added *after* the flow already
 * ended, and would then never be removed. Doing both inside one synchronous stretch of `login()`
 * removes the race by construction. RPC registration itself is still task-004's job — this class
 * still knows nothing about `HandlerRegistry`/routing, only `Session.send()` and (now)
 * `SessionSubscriptions`.
 */

// ---------------------------------------------------------------------------
// Flow record
// ---------------------------------------------------------------------------

interface PendingPrompt {
  promptId: string;
  resolve: (value: string) => void;
  reject: (reason: unknown) => void;
}

interface Flow {
  flowId: string;
  provider: string;
  session: Session;
  abort: AbortController;
  pendingPrompt?: PendingPrompt;
  timer: ReturnType<typeof setTimeout>;
  /** Compare-and-set guard: whichever of {abortFlow, the fire-and-forget login settling} reaches
   *  a terminal state first wins; the other becomes a no-op. This is what guarantees exactly one
   *  `done` event per flow even when a cancel races the runtime settling on its own. */
  terminal: boolean;
}

/** Namespaced like `file_watch:`/`checkout_status:` — `SessionSubscriptions` is domain-agnostic
 *  and shared across families. */
export const PROVIDER_AUTH_FLOW_KEY_PREFIX = "provider_auth_flow:";

export interface ProviderAuthServiceDeps {
  runtime: PiAuthRuntime;
  logger?: Logger;
  /** Flow time-to-live before an auto-cancel with `error: "timeout"`. Defaults to 10 minutes. */
  ttlMs?: number;
  /** Timer seams so tests use fake timers instead of wall-clock waits. */
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
  /** Per-session subscription registry. When provided, `login` registers a
   *  `provider_auth_flow:<flowId>` disposer (`() => this.cancel(session, flowId)`) synchronously
   *  in the same tick the flow is created, and `settleFlow` removes it — see the class doc comment
   *  for why both live here instead of split across this service and the RPC layer. Omit only in
   *  tests that don't care about disconnect-cancellation or subscription bookkeeping. */
  subscriptions?: SessionSubscriptions;
}

const DEFAULT_FLOW_TTL_MS = 600_000;

export class ProviderAuthService {
  private readonly runtime: PiAuthRuntime;
  private readonly logger: Logger | undefined;
  private readonly ttlMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (handle: ReturnType<typeof setTimeout>) => void;
  private readonly subscriptions: SessionSubscriptions | undefined;

  private readonly flows = new Map<string, Flow>();
  private readonly flowIdBySession = new WeakMap<Session, string>();

  constructor(deps: ProviderAuthServiceDeps) {
    this.runtime = deps.runtime;
    this.logger = deps.logger;
    this.ttlMs = deps.ttlMs ?? DEFAULT_FLOW_TTL_MS;
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle));
    this.subscriptions = deps.subscriptions;
  }

  /** `getProviders()` composed with a bounded per-provider `checkAuth()` (already bounded inside
   *  `PiAuthRuntime` — one bound suffices). A hung/failed single provider degrades that row to
   *  `configured: "unknown"`, never the whole list. */
  async listProviders(): Promise<{ ok: boolean; providers: ProviderAuthInfo[]; error?: string }> {
    let infos;
    try {
      infos = await this.runtime.listProviders();
    } catch {
      return { ok: false, providers: [] };
    }
    const providers = await Promise.all(
      infos.map(async (info): Promise<ProviderAuthInfo> => {
        const check = await this.runtime
          .checkAuth(info.id)
          .catch((): { configured: "unknown" } => ({ configured: "unknown" }));
        return {
          id: info.id,
          name: info.name,
          authTypes: info.authTypes,
          oauthLoginLabel: info.oauthLoginLabel,
          oauthIsSubscription: info.oauthIsSubscription,
          configured: check.configured,
          configuredType: "type" in check ? check.type : undefined,
          configuredSource: "source" in check ? check.source : undefined,
        };
      }),
    );
    return { ok: true, providers };
  }

  async login(
    session: Session,
    provider: string,
    authType: ProviderAuthType,
  ): Promise<{ ok: boolean; flowId?: string; error?: string }> {
    let infos;
    try {
      infos = await this.runtime.listProviders();
    } catch {
      return { ok: false, error: "provider_auth_unavailable" };
    }
    const info = infos.find((p) => p.id === provider);
    if (!info) return { ok: false, error: "unknown_provider" };
    if (!info.authTypes.includes(authType)) return { ok: false, error: "unsupported_auth_type" };

    // One active flow per session — a second login cancels the first (its own terminal `done`
    // fires from `abortFlow` below).
    const existingFlowId = this.flowIdBySession.get(session);
    if (existingFlowId) {
      const existing = this.flows.get(existingFlowId);
      if (existing) this.abortFlow(existing, "cancelled");
    }

    const flowId = randomUUID();
    const abort = new AbortController();
    const flow: Flow = {
      flowId,
      provider,
      session,
      abort,
      timer: this.setTimer(() => this.abortFlow(flow, "timeout"), this.ttlMs),
      terminal: false,
    };
    this.flows.set(flowId, flow);
    this.flowIdBySession.set(session, flowId);
    // Synchronous, same tick as flow creation — no window where `runFlow` (started right below)
    // could settle before this entry exists. See the class doc comment for why this can't safely
    // live one `await` away in the RPC layer instead.
    this.subscriptions?.add(session, `${PROVIDER_AUTH_FLOW_KEY_PREFIX}${flowId}`, () =>
      this.cancel(session, flowId),
    );

    this.logger?.debug({ flowId, provider, authType }, "provider-auth: flow started");
    void this.runFlow(flow, authType);
    return { ok: true, flowId };
  }

  respond(
    session: Session,
    flowId: string,
    promptId: string,
    value: string,
  ): { ok: boolean; error?: string } {
    const flow = this.flows.get(flowId);
    if (
      !flow ||
      flow.session !== session ||
      !flow.pendingPrompt ||
      flow.pendingPrompt.promptId !== promptId
    ) {
      return { ok: false, error: "not_found" };
    }
    const pending = flow.pendingPrompt;
    flow.pendingPrompt = undefined;
    this.logger?.debug(
      { flowId, provider: flow.provider, promptId },
      "provider-auth: prompt answered",
    );
    pending.resolve(value);
    return { ok: true };
  }

  /** Unconditionally idempotent — see the class doc comment on why this never reports `not_found`
   *  the way `respond` does. */
  cancel(session: Session, flowId: string): { ok: true } {
    const flow = this.flows.get(flowId);
    if (flow && flow.session === session) this.abortFlow(flow, "cancelled");
    return { ok: true };
  }

  async logout(
    provider: string,
  ): Promise<{ ok: boolean; stillConfigured?: boolean; error?: string }> {
    try {
      const result = await this.runtime.logout(provider);
      return { ok: true, stillConfigured: result.stillConfigured };
    } catch (err) {
      return { ok: false, error: sanitizeError(err) };
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async runFlow(flow: Flow, authType: ProviderAuthType): Promise<void> {
    try {
      await this.runtime.login(
        flow.provider,
        authType,
        this.buildInteraction(flow),
        flow.abort.signal,
      );
      this.settleFlow(flow, { ok: true });
    } catch (err) {
      // Pi's own `runtime.login()` races `interaction.signal` and rejects with its own generic
      // `AbortError` (sprint-054/task-004) — never infer cancellation from the error type. Our own
      // `abort.signal.aborted` is authoritative; in practice `abortFlow` has usually already
      // settled this flow by the time we get here (the compare-and-set in `settleFlow` makes this
      // call a no-op), but the check stays correct even if `runtime.login()` settles first.
      const error = flow.abort.signal.aborted ? "cancelled" : sanitizeError(err);
      this.settleFlow(flow, { ok: false, error });
    }
  }

  private buildInteraction(flow: Flow): AuthInteractionLike {
    return {
      signal: flow.abort.signal,
      notify: (event) => {
        // Must be synchronous and must never throw into Pi.
        try {
          this.sendFlowEvent(flow, toFlowEventPayload(event));
        } catch (err) {
          this.logger?.warn(
            { flowId: flow.flowId, provider: flow.provider, err: errorMessage(err) },
            "provider-auth: notify handler failed",
          );
        }
      },
      prompt: (p) => this.handlePrompt(flow, p),
    };
  }

  private handlePrompt(flow: Flow, p: AuthPromptLike): Promise<string> {
    if (flow.pendingPrompt) {
      // Pi is sequential — a second concurrent prompt is a protocol violation, not something to
      // silently drop. Fail the whole flow rather than guess which prompt the client meant.
      const reason = "provider_auth: concurrent prompt (protocol violation)";
      this.abortFlow(flow, "cancelled");
      return Promise.reject(new Error(reason));
    }

    const promptId = randomUUID();
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    const onPromptAbort = (): void => {
      if (flow.pendingPrompt?.promptId !== promptId) return;
      flow.pendingPrompt = undefined;
      this.sendFlowEvent(flow, { kind: "prompt_cancelled", promptId });
      reject(new Error("prompt_cancelled"));
    };
    p.signal?.addEventListener("abort", onPromptAbort, { once: true });
    flow.pendingPrompt = {
      promptId,
      resolve: (value) => {
        p.signal?.removeEventListener("abort", onPromptAbort);
        resolve(value);
      },
      reject: (reason) => {
        p.signal?.removeEventListener("abort", onPromptAbort);
        reject(reason);
      },
    };

    this.logger?.debug(
      { flowId: flow.flowId, provider: flow.provider, promptId, promptKind: p.type },
      "provider-auth: prompt",
    );
    this.sendFlowEvent(flow, {
      kind: "prompt",
      promptId,
      promptKind: p.type,
      message: p.message,
      placeholder: "placeholder" in p ? p.placeholder : undefined,
      options: "options" in p ? p.options : undefined,
    });
    return promise;
  }

  /** Abort the flow's controller and settle it with a terminal `done ok:false`. Used by explicit
   *  `cancel`, TTL expiry, and — via the `SessionSubscriptions` disposer `login` registers, which
   *  fires on socket disconnect — session close. A no-op if the flow already reached a terminal
   *  state. */
  private abortFlow(flow: Flow, reason: "cancelled" | "timeout"): void {
    if (flow.terminal) return;
    flow.abort.abort();
    this.settleFlow(flow, { ok: false, error: reason });
  }

  /** The single place a flow ends: compare-and-set on `terminal` (so exactly one `done` is ever
   *  emitted even when a cancel races the runtime settling), clears the TTL timer, rejects any
   *  pending prompt, unregisters the flow, emits the terminal event, and drops the
   *  `SessionSubscriptions` entry `login` registered. Removing it here — not just from an explicit
   *  `cancel` — is what guarantees a flow that completes or times out on its own leaves no stale
   *  disposer behind. `SessionSubscriptions.remove` re-invokes the disposer it finds (which calls
   *  `cancel()` again); that's a harmless no-op re-entry by this point, since `this.flows` no
   *  longer has an entry for `flow.flowId` (deleted a few lines above). */
  private settleFlow(flow: Flow, result: { ok: boolean; error?: string }): void {
    if (flow.terminal) return;
    flow.terminal = true;
    this.clearTimer(flow.timer);
    if (flow.pendingPrompt) {
      const pending = flow.pendingPrompt;
      flow.pendingPrompt = undefined;
      pending.reject(new Error(result.error ?? "flow_ended"));
    }
    this.flows.delete(flow.flowId);
    if (this.flowIdBySession.get(flow.session) === flow.flowId) {
      this.flowIdBySession.delete(flow.session);
    }
    this.logger?.debug(
      { flowId: flow.flowId, provider: flow.provider, ok: result.ok, error: result.error },
      "provider-auth: flow ended",
    );
    this.sendFlowEvent(flow, { kind: "done", ok: result.ok, error: result.error });
    this.subscriptions?.remove(flow.session, `${PROVIDER_AUTH_FLOW_KEY_PREFIX}${flow.flowId}`);
  }

  private sendFlowEvent(flow: Flow, event: Record<string, unknown>): void {
    try {
      flow.session.send({
        type: "session",
        message: { type: "provider_auth_flow_event", flowId: flow.flowId, event },
      });
    } catch (err) {
      this.logger?.warn(
        { flowId: flow.flowId, provider: flow.provider, err: errorMessage(err) },
        "provider-auth: failed to send flow event",
      );
    }
  }
}

/** `AuthEventLike`'s `type` discriminant maps 1:1 onto the flow event's `kind` — everything else
 *  (message/links, url/instructions, userCode/verificationUri/expiresInSeconds, message) forwards
 *  verbatim. Never a prompt value; events carry no secrets by construction. */
function toFlowEventPayload(event: AuthEventLike): Record<string, unknown> {
  const { type, ...rest } = event;
  return { kind: type, ...rest };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Provider messages are safe to relay verbatim; this exists so a future caller has one place to
 *  redact from, never to interpolate a prompt value into an error (callers never pass one in). */
function sanitizeError(err: unknown): string {
  return errorMessage(err);
}
