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
 * **Effects (`AgentUiEffect`) are deliberately ignored here** — the controller emits `notify` and
 * `replace_composer_text` on every transition, and this sprint does not wire either to a toast or
 * the composer (sprint-069 does). This is the status quo (nothing consumes them today), stated here
 * explicitly so it reads as a decision, not an oversight.
 *
 * **Retained surfaces are deliberately not exposed** — no `useAgentUiSurfaces` hook exists yet.
 * Sprint-070 renders them; an unused public selector today would invite a second, divergent
 * consumer before that design is settled.
 */

import { create } from "zustand";
import {
  createAgentUiController,
  initialAgentUiState,
  pendingForAgent,
  resolvedForAgent,
  type AgentUiController,
  type AgentUiPendingEntry,
  type AgentUiResolvedEntry,
  type AgentUiRespondResult,
  type AgentUiState,
  type PiStudioClient,
} from "@av-pi-studio/client";
import type { AgentUiResponse } from "@av-pi-studio/protocol";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";

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

function resetCaches(): void {
  pendingCache = new Map();
  resolvedCache = new Map();
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
  const unsubscribeController = controller.subscribe((state) => {
    useAgentUiStore.setState({ uiState: state });
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
