/**
 * Deferred-draft materialization + preselected default model — the client-side half of the
 * server's deferred-spawn draft creation (`agent-service.ts` `handleCreate`/
 * `spawnOrResumeSession`). Opening a "New chat" tab creates only a client-only `SessionEntry`
 * (`session-store.ts` `createSession`, `agentId: null`) — nothing is persisted or spawned
 * server-side until the user actually invests something in it (picks a model, starts typing, or
 * sends), at which point `ensureMaterialized` commits it into a real, restorable `AgentRecord`
 * without spawning a `pi` process (that stays deferred to the first send).
 */

import type { PiStudioClient } from "@av-pi-studio/client";
import { useSessionStore } from "./session-store.js";

export interface DefaultModel {
  model?: string;
  modelProvider?: string;
}

/**
 * Cached per connection (`WeakMap` keyed by the live `PiStudioClient` instance — a reconnect gets
 * a new client and therefore a fresh cache, exactly matching the daemon-side cache's "per
 * process" scope). The first call after a connection opens pays one transient `--no-session`
 * spawn (`resolve_default_model`, `providers/pi/agent.ts`); every subsequent "New chat" on the
 * same connection is instant. A failed lookup (e.g. the provider can't resolve one) is cached too
 * — an empty result just means the composer shows its placeholder, so retrying on every keystroke
 * would be pure waste.
 */
const defaultModelCache = new WeakMap<PiStudioClient, Promise<DefaultModel>>();

/** Resolve the model a brand-new chat would run on with no override — settings' configured
 * default, else the provider's built-in default — WITHOUT spawning anything. Seeds a new
 * session's displayed model (`tab-store.ts` `openNewChat`) purely for display: it is never itself
 * persisted or replayed until `ensureMaterialized` commits whatever model is showing at that
 * point (which may since have been overridden by an explicit pick). */
export function resolveDefaultModel(client: PiStudioClient, provider = "pi"): Promise<DefaultModel> {
  const cached = defaultModelCache.get(client);
  if (cached) return cached;
  const promise = client.providers
    .resolveDefaultModel(provider)
    .then((res) => ({ model: res.model, modelProvider: res.modelProvider }))
    .catch(() => ({}) as DefaultModel);
  defaultModelCache.set(client, promise);
  return promise;
}

/** In-flight materializations, keyed by `sessionId` — serializes concurrent callers (a model pick
 * racing a composer keystroke racing Send) onto the same `createAgent` call instead of each
 * firing its own and racing to `bindAgent`. */
const materializing = new Map<string, Promise<string>>();

/**
 * Ensure `sessionId` has a bound `agentId`, materializing a deferred draft if it doesn't yet.
 * Materializing means `createAgent` with NO `initialPrompt` — the server persists the record but
 * does not spawn a provider process (`agent-service.ts` `handleCreate`'s deferred-draft branch) —
 * carrying whatever model is CURRENTLY on the session entry (the preselected default from
 * `resolveDefaultModel`, or an explicit `/model` pick; either way, `config.model`/
 * `config.modelProvider` is what the server replays on first spawn, unconditionally, since
 * neither `createSession` nor `resumeSession` consult it themselves).
 *
 * Idempotent: returns the already-bound `agentId` immediately, or the same in-flight promise if
 * a materialize is already running for this session.
 */
export function ensureMaterialized(client: PiStudioClient, sessionId: string): Promise<string> {
  const entry = useSessionStore.getState().sessions[sessionId];
  if (!entry) return Promise.reject(new Error(`unknown session: ${sessionId}`));
  if (entry.agentId) return Promise.resolve(entry.agentId);

  const inFlight = materializing.get(sessionId);
  if (inFlight) return inFlight;

  const promise = (async () => {
    const config: { provider: string; cwd: string; model?: string; modelProvider?: string } = {
      provider: "pi",
      cwd: entry.cwd || "~",
    };
    if (entry.model) config.model = entry.model;
    if (entry.modelProvider) config.modelProvider = entry.modelProvider;
    const result = await client.createAgent({ config, labels: {} });
    useSessionStore.getState().bindAgent(sessionId, result.agentId);
    return result.agentId;
  })();

  materializing.set(sessionId, promise);
  void promise.finally(() => materializing.delete(sessionId));
  return promise;
}
