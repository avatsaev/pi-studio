import type {
  AgentUiPendingRequest,
  AgentUiRequest,
  AgentUiResolved,
  AgentUiResponse,
  AgentUiSurface,
} from "@av-pi-studio/protocol";

import type { AgentUiEventMeta } from "./pistudio-client.js";

/**
 * Framework-free extension-UI state machine (`swe/features/extension-ui-client-sdk.md` § Pure
 * state module). No DOM, no timers, no I/O, no logging — every transition returns a **new** state
 * plus a list of effects to perform, never performs them itself. This is the module that makes the
 * sibling rendering scope component work over an already-tested machine.
 *
 * **Routing is by wire predicate, never by a `method` table** (mirrors the server-side adapter,
 * `packages/server/src/agent/agent-ui/agent-ui-service.ts`, which is equally payload-blind):
 *
 * ```
 * expectsResponse        → dialog            (select, confirm, input, editor)
 * surfaceKey && removed  → delete surface
 * surfaceKey             → upsert surface    (setStatus, setWidget, setTitle)
 * otherwise              → transient effect  (notify, set_editor_text)
 * ```
 *
 * `method` is inspected only *within* the transient category, to pick which effect to build — the
 * one place the routing rule permits it. An unknown fire-and-forget method therefore produces
 * **zero** effects; that absence is deliberately the caller's "unknown method" signal, not a stored
 * flag on any entry (a flag would require the exact known-methods table this module refuses to
 * keep).
 *
 * **Timeouts are displayed, never acted on.** Pi auto-resolves its own timed dialogs and states the
 * client does not need to track them. `remainingMs` is a pure function of `(entry, now)`; no action
 * or code path here dismisses, expires, or mutates an entry — only a `ui_resolved` action removes
 * one from `pending` (moving it to `resolved`, see below).
 *
 * **`method` is also inspected once more, on resolution — a storage rule, not routing.** A
 * `select`/`confirm` answer is retained on the resolved entry for display (`answer`, below); an
 * `input`/`editor` answer, or any unrecognised method's, never is. Those two methods resolve to free
 * text the user typed, and an extension asking for a secret (an API token, say) is an expected,
 * documented case — so the value must be unrepresentable in this module's state, not merely
 * convention-excluded from rendering. See `answerFromResponse` below.
 */

// ─── State shape ──────────────────────────────────────────────────────────────

export interface AgentUiPendingEntry {
  requestId: string;
  agentId: string;
  method: string;
  payload: Record<string, unknown>;
  timeoutMs?: number;
  /** As received off the wire — epoch ms or ISO string. Normalised only inside `remainingMs`. */
  createdAt: number | string;
  /** Local clock reading, live events only — absent for a snapshot-recovered entry. */
  receivedAt?: number;
  answerable: boolean;
  /** A `respond` from this client is in flight. Never an optimistic resolution — the entry stays in
   *  `pending` until a real `ui_resolved` arrives; `respond_failed` clears this if the RPC itself
   *  reports failure (e.g. lost the first-answer-wins race). */
  submitting?: boolean;
  /** What this client submitted, `select`/`confirm` only — see the module header. Carried onto the
   *  resolved entry's `answer` once `ui_resolved` arrives. */
  submittedAnswer?: AgentUiAnswer;
}

export interface AgentUiSurfaceEntry {
  agentId: string;
  surfaceKey: string;
  method: string;
  payload: Record<string, unknown>;
  updatedAt: number | string;
}

/** Retained on a resolved dialog only for `select`/`confirm` — see the module header. */
export interface AgentUiAnswer {
  value?: string;
  confirmed?: boolean;
}

/** A dialog that is no longer answerable, kept for display only. Page-lifetime state: it survives a
 *  reconnect (the daemon has no resolved history to re-serve — `snapshot` passes this through
 *  untouched) and dies with the tab. */
export interface AgentUiResolvedEntry {
  requestId: string;
  agentId: string;
  method: string;
  payload: Record<string, unknown>;
  /** The ORIGINAL `createdAt` from when the dialog was pending, so a card keeps its slot in a list
   *  merged with `pendingForAgent` when it resolves — no `resolvedAt` field exists. */
  createdAt: number | string;
  /** Verbatim from `agent_ui_resolved` — an open string, never relabeled, never enumerated. */
  reason: string;
  /** Present only when THIS client answered a `select`/`confirm` — see the module header. */
  answer?: AgentUiAnswer;
}

export interface AgentUiState {
  /** Keyed by `requestId` — daemon-minted, unique across every agent. */
  pending: Record<string, AgentUiPendingEntry>;
  /** Keyed by `surfaceMapKey(agentId, surfaceKey)` — a `surfaceKey` is unique only within an agent. */
  surfaces: Record<string, AgentUiSurfaceEntry>;
  /** Keyed by `requestId`, same as `pending`. Bounded per agent — see `RESOLVED_HISTORY_LIMIT`. */
  resolved: Record<string, AgentUiResolvedEntry>;
}

export const initialAgentUiState: AgentUiState = { pending: {}, surfaces: {}, resolved: {} };

/** Per-agent cap on retained resolved dialogs. Page-lifetime state, but a chatty extension over a
 *  long session must not grow it without limit. */
export const RESOLVED_HISTORY_LIMIT = 50;

// ─── Actions & effects ────────────────────────────────────────────────────────

export type AgentUiAction =
  | { type: "ui_request"; event: AgentUiRequest; meta: AgentUiEventMeta }
  | { type: "ui_resolved"; event: AgentUiResolved }
  | { type: "snapshot"; pending: AgentUiPendingRequest[]; surfaces: AgentUiSurface[] }
  | { type: "disconnected" }
  | { type: "agent_removed"; agentId: string }
  | { type: "respond_sent"; requestId: string; response: AgentUiResponse }
  | { type: "respond_failed"; requestId: string };

export type AgentUiEffect =
  | { type: "replace_composer_text"; agentId: string; text: string }
  | { type: "notify"; agentId: string; message: string; level: string };

/**
 * Unambiguous composite key: `agentId` is a UUID, so `\u0000` (no UUID contains it) is a safe
 * separator. `agentId`/`surfaceKey` are also stored verbatim on the entry, so nothing ever needs to
 * parse this key back apart.
 */
export function surfaceMapKey(agentId: string, surfaceKey: string): string {
  return `${agentId}\u0000${surfaceKey}`;
}

/** Epoch ms or ISO string → epoch ms, for ordering/countdown arithmetic only. */
function normalizeTimestamp(value: number | string): number {
  return typeof value === "number" ? value : Date.parse(value);
}

// ─── Reducer ──────────────────────────────────────────────────────────────────

export function reduce(
  state: AgentUiState,
  action: AgentUiAction,
): { state: AgentUiState; effects: AgentUiEffect[] } {
  switch (action.type) {
    case "ui_request":
      return reduceUiRequest(state, action.event, action.meta);
    case "ui_resolved":
      return { state: reduceUiResolved(state, action.event), effects: [] };
    case "snapshot":
      return {
        state: buildSnapshotState(action.pending, action.surfaces, state.resolved),
        effects: [],
      };
    case "disconnected":
      return { state: markAllUnanswerable(state), effects: [] };
    case "agent_removed":
      return { state: dropAgent(state, action.agentId), effects: [] };
    case "respond_sent":
      return { state: applyRespondSent(state, action.requestId, action.response), effects: [] };
    case "respond_failed":
      return { state: applyRespondFailed(state, action.requestId), effects: [] };
  }
}

function reduceUiRequest(
  state: AgentUiState,
  event: AgentUiRequest,
  meta: AgentUiEventMeta,
): { state: AgentUiState; effects: AgentUiEffect[] } {
  // Dialog: expectsResponse wins the ladder regardless of any other field.
  if (event.expectsResponse) {
    const entry: AgentUiPendingEntry = {
      requestId: event.requestId,
      agentId: event.agentId,
      method: event.method,
      payload: event.payload,
      timeoutMs: event.timeoutMs,
      createdAt: event.createdAt,
      receivedAt: meta.receivedAt,
      answerable: true,
    };
    return {
      state: { ...state, pending: { ...state.pending, [event.requestId]: entry } },
      effects: [],
    };
  }

  // Surface clear/upsert.
  if (event.surfaceKey !== undefined) {
    const key = surfaceMapKey(event.agentId, event.surfaceKey);
    if (event.removed) {
      if (!(key in state.surfaces)) return { state, effects: [] }; // never-seen key: no-op, not an error
      const surfaces = { ...state.surfaces };
      delete surfaces[key];
      return { state: { ...state, surfaces }, effects: [] };
    }
    const entry: AgentUiSurfaceEntry = {
      agentId: event.agentId,
      surfaceKey: event.surfaceKey,
      method: event.method,
      payload: event.payload,
      updatedAt: event.createdAt,
    };
    // Last-write-wins on (agentId, surfaceKey) — never deduped by requestId, which is fresh per upsert.
    return { state: { ...state, surfaces: { ...state.surfaces, [key]: entry } }, effects: [] };
  }

  // Transient: no state change, effects built from `method` — the one place this module reads it
  // for routing purposes, and only to pick an effect shape within this already-decided category.
  return { state, effects: buildTransientEffects(event) };
}

function buildTransientEffects(event: AgentUiRequest): AgentUiEffect[] {
  switch (event.method) {
    case "set_editor_text": {
      // Always replace — matches Pi's own semantics (`pasteToEditor` delegates to `setEditorText`
      // with no paste handling), and is the predictable behavior for extension authors.
      const text = typeof event.payload.text === "string" ? event.payload.text : "";
      return [{ type: "replace_composer_text", agentId: event.agentId, text }];
    }
    case "notify": {
      const message = typeof event.payload.message === "string" ? event.payload.message : "";
      // Forwarded verbatim — never collapsed onto today's ToastVariant, which has no "warning".
      const level = typeof event.payload.level === "string" ? event.payload.level : "info";
      return [{ type: "notify", agentId: event.agentId, message, level }];
    }
    default:
      // Unrecognised fire-and-forget method: zero effects IS the "unknown method" signal — the
      // caller (task-003) reports it, this module stays silent and stateless about it.
      return [];
  }
}

/**
 * Retention rule for a resolved dialog's answer (module header). `select`/`confirm` responses are
 * kept for display; `input`/`editor` (and any unrecognised method) resolve to free text or secrets
 * and are never retained — the value must be unrepresentable in state, not merely unrendered. This
 * is the only place besides `buildTransientEffects` that this module inspects `method`, and only to
 * enforce this exclusion, never to route.
 */
function answerFromResponse(method: string, response: AgentUiResponse): AgentUiAnswer | undefined {
  if (method !== "select" && method !== "confirm") return undefined;
  return { value: response.value, confirmed: response.confirmed };
}

function reduceUiResolved(state: AgentUiState, event: AgentUiResolved): AgentUiState {
  // Unknown requestId: ordered delivery on a single socket makes "resolved before its own
  // snapshot/create arrived" unconstructible, so this is a plain no-op — no tombstone bookkeeping.
  const pendingEntry = state.pending[event.requestId];
  if (!pendingEntry) return state;
  const pending = { ...state.pending };
  delete pending[event.requestId];
  const resolvedEntry: AgentUiResolvedEntry = {
    requestId: pendingEntry.requestId,
    agentId: pendingEntry.agentId,
    method: pendingEntry.method,
    payload: pendingEntry.payload,
    createdAt: pendingEntry.createdAt,
    reason: event.reason,
  };
  if (pendingEntry.submittedAnswer !== undefined)
    resolvedEntry.answer = pendingEntry.submittedAnswer;
  return { ...state, pending, resolved: addResolvedEntry(state.resolved, resolvedEntry) };
}

/** Inserts `entry`, then evicts that agent's oldest resolved entries (by the same
 *  `createdAt`/`requestId` ordering the selectors use) past `RESOLVED_HISTORY_LIMIT`. Other agents'
 *  entries are never touched by one agent's eviction. */
function addResolvedEntry(
  resolved: Record<string, AgentUiResolvedEntry>,
  entry: AgentUiResolvedEntry,
): Record<string, AgentUiResolvedEntry> {
  const next = { ...resolved, [entry.requestId]: entry };
  const forAgent = Object.values(next)
    .filter((e) => e.agentId === entry.agentId)
    .toSorted((a, b) => compareByTimeThenId(a.createdAt, a.requestId, b.createdAt, b.requestId));
  const evictCount = forAgent.length - RESOLVED_HISTORY_LIMIT;
  if (evictCount <= 0) return next;
  for (const evicted of forAgent.slice(0, evictCount)) delete next[evicted.requestId];
  return next;
}

function buildSnapshotState(
  pendingList: AgentUiPendingRequest[],
  surfaceList: AgentUiSurface[],
  resolved: Record<string, AgentUiResolvedEntry>,
): AgentUiState {
  // Wholesale replacement for `pending`/`surfaces`, never a merge: the daemon composes this response
  // from state that postdates every broadcast already delivered on this (single, ordered) socket, so
  // it is authoritative. Every rebuilt pending entry resets `answerable: true` and carries no
  // `receivedAt`/`submitting`/`submittedAnswer` — it was not observed locally, it was recovered, and
  // a dropped socket invalidates any respond that had been in flight. `resolved` is passed through
  // untouched instead: `agent_ui_list_response` carries no resolved history for the daemon to
  // re-serve, so replacing it here would wipe every collapsed card on reconnect.
  const pending: Record<string, AgentUiPendingEntry> = {};
  for (const p of pendingList) {
    pending[p.requestId] = {
      requestId: p.requestId,
      agentId: p.agentId,
      method: p.method,
      payload: p.payload,
      timeoutMs: p.timeoutMs,
      createdAt: p.createdAt,
      answerable: true,
    };
  }
  const surfaces: Record<string, AgentUiSurfaceEntry> = {};
  for (const s of surfaceList) {
    surfaces[surfaceMapKey(s.agentId, s.surfaceKey)] = {
      agentId: s.agentId,
      surfaceKey: s.surfaceKey,
      method: s.method,
      payload: s.payload,
      updatedAt: s.updatedAt,
    };
  }
  return { pending, surfaces, resolved };
}

function markAllUnanswerable(state: AgentUiState): AgentUiState {
  const pending: Record<string, AgentUiPendingEntry> = {};
  for (const [id, entry] of Object.entries(state.pending)) {
    pending[id] = { ...entry, answerable: false };
  }
  // Nothing removed — only a later `snapshot` action round-trips `answerable` back to `true`.
  return { ...state, pending };
}

function dropAgent(state: AgentUiState, agentId: string): AgentUiState {
  const pending: Record<string, AgentUiPendingEntry> = {};
  for (const [id, entry] of Object.entries(state.pending)) {
    if (entry.agentId !== agentId) pending[id] = entry;
  }
  const surfaces: Record<string, AgentUiSurfaceEntry> = {};
  for (const [key, entry] of Object.entries(state.surfaces)) {
    if (entry.agentId !== agentId) surfaces[key] = entry;
  }
  const resolved: Record<string, AgentUiResolvedEntry> = {};
  for (const [id, entry] of Object.entries(state.resolved)) {
    if (entry.agentId !== agentId) resolved[id] = entry;
  }
  return { pending, surfaces, resolved };
}

function applyRespondSent(
  state: AgentUiState,
  requestId: string,
  response: AgentUiResponse,
): AgentUiState {
  const entry = state.pending[requestId];
  if (!entry) return state; // unknown id: nothing to mark in flight
  const submittedAnswer = answerFromResponse(entry.method, response);
  const next: AgentUiPendingEntry = { ...entry, submitting: true };
  if (submittedAnswer !== undefined) next.submittedAnswer = submittedAnswer;
  return { ...state, pending: { ...state.pending, [requestId]: next } };
}

function applyRespondFailed(state: AgentUiState, requestId: string): AgentUiState {
  const entry = state.pending[requestId];
  if (!entry) return state; // no longer pending (already resolved, or never was) — no-op
  // Rebuilt explicitly, not spread-and-delete: this is what stops a lost first-answer-wins race
  // from leaving a spinner running forever, since a `not_found` response is followed by no
  // broadcast to this client.
  const next: AgentUiPendingEntry = {
    requestId: entry.requestId,
    agentId: entry.agentId,
    method: entry.method,
    payload: entry.payload,
    timeoutMs: entry.timeoutMs,
    createdAt: entry.createdAt,
    receivedAt: entry.receivedAt,
    answerable: entry.answerable,
  };
  return { ...state, pending: { ...state.pending, [requestId]: next } };
}

// ─── Selectors ────────────────────────────────────────────────────────────────

function compareByTimeThenId(
  aTime: number | string,
  aId: string,
  bTime: number | string,
  bId: string,
): number {
  const diff = normalizeTimestamp(aTime) - normalizeTimestamp(bTime);
  return diff !== 0 ? diff : aId.localeCompare(bId);
}

/** Every pending dialog for one agent, oldest first (`createdAt`, `requestId` tie-break) — stable
 *  so a list cannot jitter between renders. */
export function pendingForAgent(state: AgentUiState, agentId: string): AgentUiPendingEntry[] {
  return Object.values(state.pending)
    .filter((entry) => entry.agentId === agentId)
    .toSorted((a, b) => compareByTimeThenId(a.createdAt, a.requestId, b.createdAt, b.requestId));
}

/** Pending-dialog count per agent — the attention-badge derivation, so badging is a subscription
 *  rather than UI logic. An agent with zero pending is **absent** from the map, never present at `0`. */
export function pendingByAgent(state: AgentUiState): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of Object.values(state.pending)) {
    counts[entry.agentId] = (counts[entry.agentId] ?? 0) + 1;
  }
  return counts;
}

/** Every retained surface for one agent, oldest-updated first (`updatedAt`, `surfaceKey` tie-break). */
export function surfacesForAgent(state: AgentUiState, agentId: string): AgentUiSurfaceEntry[] {
  return Object.values(state.surfaces)
    .filter((entry) => entry.agentId === agentId)
    .toSorted((a, b) => compareByTimeThenId(a.updatedAt, a.surfaceKey, b.updatedAt, b.surfaceKey));
}

/** Every resolved dialog for one agent, oldest first (`createdAt`, `requestId` tie-break) — the same
 *  ordering key and comparator as `pendingForAgent`, so merging both lists by that key keeps a
 *  card's index stable across resolution (no per-card `resolvedAt`, and no clock reads here). */
export function resolvedForAgent(state: AgentUiState, agentId: string): AgentUiResolvedEntry[] {
  return Object.values(state.resolved)
    .filter((entry) => entry.agentId === agentId)
    .toSorted((a, b) => compareByTimeThenId(a.createdAt, a.requestId, b.createdAt, b.requestId));
}

/**
 * Time left before Pi auto-resolves this dialog, or `null` when it is untimed (a human may take
 * hours). A **legibility affordance only** — nothing in this module or its callers may act on the
 * result (dismiss, expire, resend); only a real `ui_resolved` event ever removes an entry. Anchors
 * on the local `receivedAt` when available; a snapshot-recovered entry has none, so it falls back to
 * the daemon's `createdAt` and accepts the residual cross-host clock skew — acceptable for a rough
 * countdown display, which is the only thing this value drives. Clamped at `0`, never negative.
 */
export function remainingMs(entry: AgentUiPendingEntry, now: number): number | null {
  if (entry.timeoutMs === undefined) return null;
  const anchor = entry.receivedAt ?? normalizeTimestamp(entry.createdAt);
  return Math.max(0, entry.timeoutMs - (now - anchor));
}
