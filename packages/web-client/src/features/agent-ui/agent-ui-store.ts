/**
 * Extension-UI state, wired into React (sprint-068/task-003). Owns lifetime management only — the
 * `AgentUiController` (`@av-pi-studio/client`, sprint-067) already handles every hard problem
 * (rehydration ordering, reconnect resync, first-answer-wins, agent-lifecycle pruning); this module
 * must not reimplement or second-guess any of it.
 *
 * **One controller per connected client, app-scoped** (unlike `use-file-watch.ts`'s/
 * `use-checkout-status.ts`'s per-path subscriptions) — created lazily and disposed on client
 * change, mirroring `lib/connection/connection-store.ts`'s own lifecycle.
 *
 * **Capability is read only once the connection is actually `"open"`**, never eagerly the instant
 * `client` is assigned: `client.extensionUiAvailable()` reads `server_info.features`, which is not
 * known until the handshake completes (`connection-store.ts`'s `connect()` sets `client` before
 * `await daemon.connect()` resolves). Creating a controller unconditionally at assignment time
 * would either race that handshake or (worse) require polling; instead this module waits for the
 * connection's own `"open"` transition, checks capability at that moment, and creates a controller
 * only if it is present. **If it is never present for this client, no controller is ever created**
 * — not merely inert, genuinely absent, satisfying the capability-gating acceptance criterion
 * verbatim ("no controller exists").
 *
 * **A controller, once created, is NEVER torn down for an in-connection blip** (disconnect/
 * reconnect against the very same `client` instance) — the controller's own `disconnected`/resync
 * handling already covers that (`agent-ui-controller.ts`'s header: "`answerable` is a one-way door
 * … only a fresh snapshot resets it"). Disposal happens only when `client` itself changes — a real
 * switch of daemon, or a transition to no client at all.
 *
 * **Effects (`AgentUiEffect`) are routed from exactly one seam** — `dispatchEffects`, called from
 * this module's single `controller.subscribe` callback with that commit's own `effects` array, in
 * order. Exactly-once follows from the controller itself: `agent-ui-controller.ts`'s `commit()` is
 * the only place a listener ever fires, called exactly once per action (including once each for
 * queued transients replayed during `resync()`), and this module registers exactly one listener —
 * so there is no path that could process the same effects twice. `"notify"` routes to a toast
 * (`notify-effect.ts`'s pure decision helpers; sprint-069/task-006); `"replace_composer_text"`
 * routes to `draft-store.ts` (sprint-069/task-007), the target SESSION's draft resolved from the
 * effect's own `agentId` — never whichever composer currently has focus; any other/future kind is
 * ignored, never thrown — the SDK's own `onUnknownMethod` above establishes the same "log or
 * ignore, never crash" posture for methods this client doesn't know.
 *
 * **§ 08/§ 11 announcements are a second, separate consumer of the same commit** (sprint-069/
 * task-008) — `announceTransitions`, called right after `dispatchEffects` from the same
 * `subscribe` callback, diffs the just-committed `uiState` against the one before it
 * (`announce.ts`'s pure `computeAnnouncements`) for § 08 pending-question arrivals/resolutions,
 * while `notifyEffect`/`composerTextEffect` themselves additionally `speak()` their own § 11
 * copy. Both write through `stores/announcer-store.ts`'s one shared live region — never a second,
 * divergent one.
 *
 * **Retained surfaces are deliberately not exposed** — no `useAgentUiSurfaces` hook exists yet.
 * Sprint-070 renders them; an unused public selector today would invite a second, divergent
 * consumer before that design is settled.
 */

import { create } from "zustand";
import {
  createAgentUiController,
  initialAgentUiState,
  pendingByAgent,
  pendingForAgent,
  resolvedForAgent,
  type AgentUiController,
  type AgentUiEffect,
  type AgentUiPendingEntry,
  type AgentUiResolvedEntry,
  type AgentUiRespondResult,
  type AgentUiState,
  type PiStudioClient,
} from "@av-pi-studio/client";
import type { AgentUiResponse } from "@av-pi-studio/protocol";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useDraftStore } from "@pi-studio-ui/stores/draft-store.js";
import { useSessionStore } from "@pi-studio-ui/stores/session-store.js";
import { clearWhenIdle, speak } from "@pi-studio-ui/stores/announcer-store.js";
import { isTabVisible, tabIds } from "@pi-studio-ui/stores/tab-store.js";
import { useToastStore } from "@pi-studio-ui/stores/toast-store.js";
import { computeAnnouncements } from "./announce.js";
import {
  notifyAnnouncement,
  notifyDurationMs,
  notifyToastCopy,
  notifyVariant,
} from "./notify-effect.js";

export interface AgentUiStoreState {
  controller: AgentUiController | null;
  uiState: AgentUiState;
}

export const useAgentUiStore = create<AgentUiStoreState>()(() => ({
  controller: null,
  uiState: initialAgentUiState,
}));

// ─── Lifecycle: attach/detach exactly one controller per `client` identity ─────────────────────

let attachedClient: PiStudioClient | null = null;
/** Unsubscribes whichever of the two is currently active: the pre-controller connection-state
 *  watcher (waiting for "open" + capability), or the controller's own subscription+dispose. Never
 *  both at once — see `attach`/`createControllerFor`. */
let activeTeardown: (() => void) | null = null;

// Per-agent memoization so `pendingForAgent`/`resolvedForAgent` — which always return a fresh
// array — don't defeat referential-stability selectors for an agent nothing changed for. Reset
// whenever the controller instance changes (new client, or capability-less → none).
let pendingCache = new Map<string, readonly AgentUiPendingEntry[]>();
let resolvedCache = new Map<string, readonly AgentUiResolvedEntry[]>();
// Stable-reference cache for `selectAgentUiPendingAgentIds` (sprint-069/task-003) — same "reuse
// the previous value when the content is unchanged" contract as `stableList` below, but for a Set
// keyed by content rather than a per-agent-id cache.
let pendingAgentIdsCache: ReadonlySet<string> = new Set();

function resetCaches(): void {
  pendingCache = new Map();
  resolvedCache = new Map();
  pendingAgentIdsCache = new Set();
}

function shallowArrayEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Returns `compute()`, or the previously cached array for `key` when the new result is shallowly
 *  equal to it — the standard "stable reference for equal content" memo used to keep an unrelated
 *  agent's selector from re-rendering when a sibling agent's dialog state changes. */
function stableList<T>(
  cache: Map<string, readonly T[]>,
  key: string,
  compute: () => readonly T[],
): readonly T[] {
  const next = compute();
  const prev = cache.get(key);
  if (prev && shallowArrayEqual(prev, next)) return prev;
  cache.set(key, next);
  return next;
}

/** Routes one commit's effects, in order — see this module's header for the exactly-once
 *  argument. Unknown/not-yet-handled kinds are ignored, never thrown. */
function dispatchEffects(effects: readonly AgentUiEffect[]): void {
  for (const effect of effects) {
    switch (effect.type) {
      case "notify":
        notifyEffect(effect);
        break;
      case "replace_composer_text":
        composerTextEffect(effect);
        break;
      default:
        break;
    }
  }
}

function notifyEffect(effect: Extract<AgentUiEffect, { type: "notify" }>): void {
  const sessionState = useSessionStore.getState();
  const activeSession = sessionState.activeSessionId
    ? sessionState.sessions[sessionState.activeSessionId]
    : undefined;
  const effectSession = Object.values(sessionState.sessions).find(
    (s) => s.agentId === effect.agentId,
  );
  const activeAgentId = activeSession?.agentId ?? null;
  const sessionTitle = effectSession?.title ?? null;
  useToastStore
    .getState()
    .show(notifyToastCopy(effect.message, effect.agentId, activeAgentId, sessionTitle), {
      variant: notifyVariant(effect.level),
      durationMs: notifyDurationMs(effect.level),
    });
  const announcement = notifyAnnouncement(
    effect.message,
    effect.level,
    effect.agentId,
    activeAgentId,
    sessionTitle,
  );
  speak(announcement.text, announcement.politeness);
}

/** Routes a `replace_composer_text` effect to the SESSION's draft, never whichever composer
 *  currently has focus (sprint-069/task-007's "Notes": routing by focus silently clobbers the
 *  wrong draft as soon as two panes are open). Visibility is resolved fresh, right here, from the
 *  effect's own agent id — never cached — so a background replacement is correctly deferred even
 *  if some OTHER session's chat happens to be focused at this exact moment. A lookup miss (an
 *  effect naming an agent with no locally-tracked session) is a defensive no-op, mirroring
 *  `notifyEffect`'s own posture: an effect should always name a real, known agent, but this must
 *  never throw on a miss. */
function composerTextEffect(
  effect: Extract<AgentUiEffect, { type: "replace_composer_text" }>,
): void {
  const effectSession = Object.values(useSessionStore.getState().sessions).find(
    (s) => s.agentId === effect.agentId,
  );
  if (effectSession === undefined) return;
  const visible = isTabVisible(tabIds.chat(effectSession.id));
  useDraftStore.getState().replaceDraft(effectSession.id, effect.text, visible);
  // § 11 "the visible case is not announced — the on-screen note is the feedback".
  if (!visible) speak(`Draft replaced in ${effectSession.title || "Chat"}`, "polite");
}

/** § 08 announcements — a second, separate consumer of the same `subscribe` commit as
 *  `dispatchEffects`, diffing this commit's `uiState` against the one before it. Global pending
 *  count reaching zero additionally schedules the region to empty itself
 *  (`announcer-store.ts`'s `clearWhenIdle`) — "nothing pending anywhere" has no announcement
 *  string of its own (`announce.ts`'s header), so that decision lives here, not in `announce.ts`. */
function announceTransitions(prev: AgentUiState, next: AgentUiState): void {
  const sessionState = useSessionStore.getState();
  const activeSession = sessionState.activeSessionId
    ? sessionState.sessions[sessionState.activeSessionId]
    : undefined;
  const announcements = computeAnnouncements(prev, next, {
    activeAgentId: activeSession?.agentId ?? null,
    sessionTitle: (agentId) =>
      Object.values(sessionState.sessions).find((s) => s.agentId === agentId)?.title ?? null,
  });
  for (const announcement of announcements) speak(announcement.text, announcement.politeness);
  if (Object.keys(prev.pending).length > 0 && Object.keys(next.pending).length === 0) {
    clearWhenIdle();
  }
}

const reportedUnknownMethods = new Set<string>();

function createControllerFor(client: PiStudioClient): void {
  resetCaches();
  const controller = createAgentUiController(client, {
    onUnknownMethod(method) {
      // The controller already dedupes per its own lifetime; this dev-logging dedupe additionally
      // survives controller disposal/recreation (e.g. a daemon restart) — never a second dedupe of
      // the SAME transition, just a floor so a reconnect loop cannot spam the console.
      if (reportedUnknownMethods.has(method)) return;
      reportedUnknownMethods.add(method);
      console.warn(`agent-ui: unrecognised extension-UI method "${method}"`);
    },
  });
  const unsubscribeController = controller.subscribe((state, effects) => {
    const prevUiState = useAgentUiStore.getState().uiState;
    useAgentUiStore.setState({ uiState: state });
    dispatchEffects(effects);
    announceTransitions(prevUiState, state);
  });
  useAgentUiStore.setState({ controller, uiState: controller.getState() });
  activeTeardown = () => {
    unsubscribeController();
    controller.dispose();
  };
}

function teardownAll(): void {
  activeTeardown?.();
  activeTeardown = null;
  resetCaches();
  useAgentUiStore.setState({ controller: null, uiState: initialAgentUiState });
}

/** Attaches (or detaches) the one app-scoped controller for `client`. Idempotent against redundant
 *  calls with the same client identity — callers do not need to pre-filter. */
function attach(client: PiStudioClient | null): void {
  if (client === attachedClient) return;
  teardownAll();
  attachedClient = client;
  if (!client) return;

  const tryCreate = (): void => {
    if (useAgentUiStore.getState().controller) return; // already created for this client
    if (client.connection.state !== "open") return;
    if (!client.extensionUiAvailable()) return; // this daemon lacks the family — never create one
    activeTeardown?.(); // drop the connection-state watcher; a controller replaces it below
    activeTeardown = null;
    createControllerFor(client);
  };

  tryCreate();
  if (!useAgentUiStore.getState().controller) {
    activeTeardown = client.connection.onStateChange((state) => {
      // Deferred, not called inline: `DaemonClient.setState` dispatches its state handlers via a
      // live (unsnapshotted) `for...of` over a `Set` — `createControllerFor` below registers the
      // controller's OWN `onStateChange` listener on that very same Set, and a Set iterator visits
      // entries inserted during iteration. Creating the controller synchronously from inside this
      // callback would let its brand-new listener be visited again within the SAME dispatch pass,
      // firing a redundant extra `resync()`/`listAgentUi()` on every first connect. Deferring to a
      // microtask lets the in-flight dispatch finish first; `tryCreate` re-reads
      // `client.connection.state` at call time, so nothing here risks acting on stale state.
      if (state === "open") queueMicrotask(tryCreate);
    });
  }
}

// React to every real client-identity change (connect, disconnect, switch to a different daemon).
// `useConnectionStore.subscribe` fires on every store update; the identity check inside `attach`
// makes this a no-op for unrelated changes (status ticks, serverInfo updates, …).
useConnectionStore.subscribe((state) => attach(state.client));
// Cover the case this module is first imported against an already-connected store (HMR, or a
// consumer mounting after `connect()` already ran).
attach(useConnectionStore.getState().client);

// ─── Public hooks & action ──────────────────────────────────────────────────────────────────────

const EMPTY_PENDING: readonly AgentUiPendingEntry[] = [];
const EMPTY_RESOLVED: readonly AgentUiResolvedEntry[] = [];

/** Pure selector core, exported so tests can exercise stability/emptiness without a React renderer
 *  (this repo's Vitest runner has no jsdom — see `use-file-watch.ts`'s "extract the testable core"
 *  convention). `useAgentUiPending` is a thin hook wrapper around this same function. */
export function selectAgentUiPending(
  s: AgentUiStoreState,
  agentId: string,
): readonly AgentUiPendingEntry[] {
  if (!s.controller) return EMPTY_PENDING;
  const list = stableList(pendingCache, agentId, () => pendingForAgent(s.uiState, agentId));
  return list.length === 0 ? EMPTY_PENDING : list;
}

/** Pure selector core for resolved entries — see `selectAgentUiPending`. */
export function selectAgentUiResolved(
  s: AgentUiStoreState,
  agentId: string,
): readonly AgentUiResolvedEntry[] {
  if (!s.controller) return EMPTY_RESOLVED;
  const list = stableList(resolvedCache, agentId, () => resolvedForAgent(s.uiState, agentId));
  return list.length === 0 ? EMPTY_RESOLVED : list;
}

const EMPTY_PENDING_AGENT_IDS: ReadonlySet<string> = new Set();

/** Pure selector core for the set of agent ids with at least one pending question, across every
 *  agent — sprint-069/task-003's workspace-header aggregation and task-004's tab strip both need
 *  "does this session have a pending question" without subscribing to `useAgentUiPending` per
 *  session (which would call a hook a variable number of times across a group's session list).
 *  Stable-reference cached like `stableList` above, so an unrelated agent's transition does not
 *  re-render every consumer of this selector. */
export function selectAgentUiPendingAgentIds(s: AgentUiStoreState): ReadonlySet<string> {
  if (!s.controller) return EMPTY_PENDING_AGENT_IDS;
  const next = new Set(Object.keys(pendingByAgent(s.uiState)));
  if (
    next.size === pendingAgentIdsCache.size &&
    [...next].every((id) => pendingAgentIdsCache.has(id))
  ) {
    return pendingAgentIdsCache;
  }
  pendingAgentIdsCache = next;
  return next.size === 0 ? EMPTY_PENDING_AGENT_IDS : next;
}

/** The set of agent ids with at least one pending question. Empty (a stable, shared empty set)
 *  when no controller exists (capability absent) or nothing is pending anywhere. */
export function useAgentUiPendingAgentIds(): ReadonlySet<string> {
  return useAgentUiStore(selectAgentUiPendingAgentIds);
}

/** Every pending dialog for `agentId`, oldest first. Empty (a stable, shared empty array) when no
 *  controller exists (capability absent) or the agent has none pending. */
export function useAgentUiPending(agentId: string): readonly AgentUiPendingEntry[] {
  return useAgentUiStore((s) => selectAgentUiPending(s, agentId));
}

/** Every resolved (collapsed-in-place) dialog for `agentId`, oldest first, bounded at the SDK's
 *  `RESOLVED_HISTORY_LIMIT`. Same stability contract as `useAgentUiPending`. */
export function useAgentUiResolved(agentId: string): readonly AgentUiResolvedEntry[] {
  return useAgentUiStore((s) => selectAgentUiResolved(s, agentId));
}

/** Answers a pending dialog. `{ ok: false, reason }` is a normal outcome (e.g. another client won
 *  the race) — callers must handle it, never treat it as a thrown error. Resolves
 *  `{ ok: false, reason: "unsupported" }` with no RPC when no controller exists. */
export function respondToUi(
  uiRequestId: string,
  response: AgentUiResponse,
): Promise<AgentUiRespondResult> {
  const controller = useAgentUiStore.getState().controller;
  if (!controller) return Promise.resolve({ ok: false, reason: "unsupported" });
  return controller.respond(uiRequestId, response);
}
