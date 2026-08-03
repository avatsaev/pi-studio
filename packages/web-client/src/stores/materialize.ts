/**
 * Deferred-draft materialization + preselected default model — the client-side half of the
 * server's deferred-spawn draft creation (`agent-service.ts` `handleCreate`/
 * `spawnOrResumeSession`). Opening a "New chat" tab creates only a client-only `SessionEntry`
 * (`session-store.ts` `createSession`, `agentId: null`) — nothing is persisted or spawned
 * server-side until `tab-store.ts` `openNewChat` eagerly calls `ensureMaterialized` the moment the
 * tab is created, which commits it into a real, restorable `AgentRecord` without spawning a `pi`
 * process (that stays deferred to the first send). `ensureMaterialized` also resolves the default
 * model itself when the entry doesn't have one yet, so callers never need a separate display-only
 * lookup before materializing.
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
 * default, else the provider's built-in default — WITHOUT spawning anything. Called by
 * `ensureMaterialized` itself when an entry has no model yet; exported separately only because
 * cache scope (per `PiStudioClient` instance) is useful to assert on directly in tests. */
export function resolveDefaultModel(
  client: PiStudioClient,
  provider = "pi",
): Promise<DefaultModel> {
  const cached = defaultModelCache.get(client);
  if (cached) return cached;
  const promise = client.providers
    .resolveDefaultModel(provider)
    .then((res) => ({ model: res.model, modelProvider: res.modelProvider }))
    .catch(() => ({}) as DefaultModel);
  defaultModelCache.set(client, promise);
  return promise;
}

/** In-flight materializations, keyed by `sessionId` — serializes concurrent callers (eager-open
 * racing an explicit model pick racing Send) onto the same `createAgent` call instead of each
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
    // Seed the default model before building `config` — `spawnOrResumeSession` reads
    // `record.config.model` at spawn time, so this must land in the SAME `createAgent` call
    // rather than a follow-up `setModel` (see module header). Skipped once the entry already has
    // a model, whether from an earlier preselect or an explicit pick — and re-checked against the
    // CURRENT entry (not the stale `entry` closure) after the lookup resolves, so an explicit
    // pick that lands while the lookup is in flight always wins over the resolved default.
    if (!entry.model) {
      const resolved = await resolveDefaultModel(client);
      const current = useSessionStore.getState().sessions[sessionId];
      if (resolved.model && current && !current.model) {
        useSessionStore.getState().setModel(sessionId, resolved.model, resolved.modelProvider);
      }
    }
    // Re-read: an explicit pick or a `remove` may have landed while the lookup above was in
    // flight (a no-op re-read when no await happened above, since nothing else runs between two
    // synchronous statements).
    const fresh = useSessionStore.getState().sessions[sessionId];
    if (!fresh) throw new Error(`unknown session: ${sessionId}`);

    const config: { provider: string; cwd: string; model?: string; modelProvider?: string } = {
      provider: "pi",
      cwd: fresh.cwd || "~",
    };
    if (fresh.model) config.model = fresh.model;
    if (fresh.modelProvider) config.modelProvider = fresh.modelProvider;
    const result = await client.createAgent({ config, labels: {} });
    useSessionStore.getState().bindAgent(sessionId, result.agentId);
    return result.agentId;
  })();

  materializing.set(sessionId, promise);
  void promise.finally(() => materializing.delete(sessionId));
  return promise;
}

/** Discard a chat whose conversation never started: closing its tab throws it away instead of
 * leaving an empty persisted record behind forever. A record that's never closed persists
 * indefinitely by design (`use-session-restore.ts` hydrates every known agent unconditionally,
 * including an untouched draft) — this is the ONLY path that removes one short of an explicit
 * delete. A chat with any timeline row is kept (closing the tab keeps the session, as before).
 * Returns whether the session was removed, purely for tests — callers (`tab-store.ts`
 * `closeTab`) treat this as fire-and-forget. */
export async function discardIfEmpty(
  client: PiStudioClient | null,
  sessionId: string,
): Promise<boolean> {
  const entry = useSessionStore.getState().sessions[sessionId];
  if (!entry) return false;
  if (entry.userMessageCount > 0 || entry.timeline.rows.length > 0) return false;

  // An eager materialize (`tab-store.ts` `openNewChat`) may still be in flight — await it so the
  // `agentId` it is about to bind isn't leaked (created, then never deleted because `entry`
  // was read before the bind landed).
  await materializing.get(sessionId)?.catch(() => {});
  const fresh = useSessionStore.getState().sessions[sessionId];
  if (!fresh) return false;

  if (fresh.agentId && client) {
    await client
      .agent(fresh.agentId)
      .delete()
      .catch(() => {
        // Best-effort hard delete: the local entry goes away regardless (mirrors
        // `SessionContextMenu.remove`'s convention), even if the RPC itself failed.
      });
  }
  useSessionStore.getState().remove(sessionId);
  return true;
}
