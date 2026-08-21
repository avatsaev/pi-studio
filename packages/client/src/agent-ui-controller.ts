import type { AgentUiRequest, AgentUiResponse } from "@av-pi-studio/protocol";

import {
  type AgentUiAction,
  type AgentUiEffect,
  type AgentUiState,
  initialAgentUiState,
  reduce,
} from "./agent-ui-state.js";
import {
  isAgentArchived,
  isAgentDeleted,
  type AgentUiRespondResult,
  type PiStudioClient,
} from "./pistudio-client.js";

/**
 * Impure wiring layer that drives task-002's reducer from task-001's SDK
 * (`swe/features/extension-ui-client-sdk.md` § Controller). Owns the three things a consumer would
 * otherwise get wrong: subscribe-then-list rehydration ordering, automatic re-sync on reconnect
 * (never left to the consumer — `disconnected` is a one-way door in the reducer without it), and
 * `agent_removed` pruning on agent archive/delete.
 *
 * **Rehydration is subscribe-then-list, merge is "replace, discard, apply".** The two `agent_ui_*`
 * subscriptions attach before the first `listAgentUi()` call, queueing whatever arrives while it is
 * in flight. When the snapshot lands: dispatch `snapshot` (wholesale replace), **discard** every
 * queued dialog/surface event (already reflected in the snapshot — the socket is one ordered stream
 * and the daemon composed the snapshot from state that postdates them), and **apply** every queued
 * transient exactly once (nothing retains a transient, so it is genuinely new).
 *
 * **Pruning rides `agent_archived`/`agent_deleted`, never `onAgentUpdate`.** Verified against
 * `agent-manager.ts`: `archiveAgent`/`deleteAgent` call `broadcastArchived`/`broadcastDeleted`
 * exclusively and never the `agent_update`-emitting path, so a pruner wired to `onAgentUpdate` would
 * silently never fire — dialogs would still clear (the daemon broadcasts `agent_ui_resolved` for
 * those), so only surfaces would leak, invisibly, after every archive.
 */

export interface AgentUiController {
  getState(): AgentUiState;
  /** Fires on every committed transition; `effects` are the effects of that transition only. */
  subscribe(listener: (state: AgentUiState, effects: AgentUiEffect[]) => void): () => void;
  respond(uiRequestId: string, response: AgentUiResponse): Promise<AgentUiRespondResult>;
  /** Escape hatch; reconnect already triggers this internally — never required in normal operation. */
  resync(): Promise<void>;
  dispose(): void;
}

export interface AgentUiControllerOptions {
  /** Reported once per unknown fire-and-forget method for the controller's lifetime. Falls back to
   *  `console.warn` when omitted. */
  onUnknownMethod?: (method: string) => void;
}

/** Predicate ladder mirrored from the reducer, used ONLY to decide whether a queued event is
 *  discarded (dialog/surface — already reflected in the snapshot that supersedes it) or replayed
 *  (transient — genuinely new). Never a method list. */
function classifyUiRequest(event: AgentUiRequest): "dialog" | "surface" | "transient" {
  if (event.expectsResponse) return "dialog";
  if (event.surfaceKey !== undefined) return "surface";
  return "transient";
}

export function createAgentUiController(
  client: PiStudioClient,
  opts: AgentUiControllerOptions = {},
): AgentUiController {
  let state: AgentUiState = initialAgentUiState;
  const listeners = new Set<(state: AgentUiState, effects: AgentUiEffect[]) => void>();
  const reportedUnknownMethods = new Set<string>();

  let disposed = false;
  /** True while a `listAgentUi()` call is in flight; the two `agent_ui_*` subscriptions queue
   *  instead of committing while this is true. */
  let queueing = false;
  let queue: AgentUiAction[] = [];
  /** Bumped at the start of every `resync()` attempt. A response whose generation no longer matches
   *  the latest one was superseded and commits nothing — "last write wins", by start order, not by
   *  response arrival order (responses are not guaranteed to resolve in the order they were sent). */
  let generation = 0;

  function commit(action: AgentUiAction): void {
    if (disposed) return;
    const result = reduce(state, action);
    state = result.state;
    if (
      action.type === "ui_request" &&
      classifyUiRequest(action.event) === "transient" &&
      result.effects.length === 0
    ) {
      reportUnknownMethod(action.event.method);
    }
    for (const listener of listeners) listener(state, result.effects);
  }

  function reportUnknownMethod(method: string): void {
    if (reportedUnknownMethods.has(method)) return;
    reportedUnknownMethods.add(method);
    if (opts.onUnknownMethod) opts.onUnknownMethod(method);
    else console.warn(`agent-ui-controller: unknown extension-UI method "${method}"`);
  }

  async function resync(): Promise<void> {
    if (disposed) return;
    // Capability gating: stays inert, no RPC — an ungated call earns an rpc_error from an older
    // daemon. Re-checked on every call (including every reconnect), because the daemon on the
    // other end may have been upgraded since the last check.
    if (!client.extensionUiAvailable()) return;

    const myGeneration = ++generation;
    // Only reset the window when transitioning from "not queueing" — an overlapping resync joins
    // the existing window instead of dropping whatever it already collected, so a superseded
    // resync never causes a queued transient to be silently lost.
    if (!queueing) {
      queueing = true;
      queue = [];
    }

    let snapshot: Awaited<ReturnType<PiStudioClient["listAgentUi"]>>;
    try {
      snapshot = await client.listAgentUi();
    } catch (err) {
      if (disposed || myGeneration !== generation) return; // superseded: the newer resync owns the window
      queueing = false;
      queue = [];
      const message = err instanceof Error ? err.message : String(err);
      console.error(`agent-ui-controller: failed to sync extension UI state: ${message}`);
      return;
    }
    if (disposed || myGeneration !== generation) return; // superseded: do not commit, do not touch the queue

    queueing = false;
    const drained = queue;
    queue = [];
    commit({ type: "snapshot", pending: snapshot.pending, surfaces: snapshot.surfaces });
    for (const action of drained) {
      if (action.type === "ui_request" && classifyUiRequest(action.event) === "transient") {
        commit(action);
      }
      // Every other queued action (dialog/surface ui_request, every ui_resolved) is already
      // reflected in the snapshot just committed above — discarded, never replayed.
    }
  }

  const unsubscribeRequest = client.onAgentUiRequest((event, meta) => {
    const action: AgentUiAction = { type: "ui_request", event, meta };
    if (queueing) queue.push(action);
    else commit(action);
  });
  const unsubscribeResolved = client.onAgentUiResolved((event) => {
    const action: AgentUiAction = { type: "ui_resolved", event };
    if (queueing) queue.push(action);
    else commit(action);
  });
  const unsubscribePrune = client.connection.onSessionMessage((msg) => {
    if (isAgentArchived(msg) || isAgentDeleted(msg)) {
      commit({ type: "agent_removed", agentId: msg.agentId });
    }
  });
  const unsubscribeState = client.connection.onStateChange((connState) => {
    if (connState === "closed" || connState === "closing") {
      commit({ type: "disconnected" });
    } else if (connState === "open") {
      void resync();
    }
    // "idle"/"connecting" carry no actionable transition here.
  });

  // Kick off the first sync immediately if the daemon is already connected and capable — the
  // common case, since a controller is normally constructed against an already-open client. If
  // the client is not yet open, `extensionUiAvailable()` is false here (no features known yet) and
  // this is a no-op; the eventual real "open" transition above triggers the one-and-only initial
  // sync, so there is no risk of a duplicate initial snapshot either way.
  void resync();

  /** Dispatches `respond_sent` before the RPC (so a spinner can render immediately), then
   *  `respond_failed` only on a domain failure — `ui_resolved` is what actually clears `submitting`
   *  on success, never this function. Never throws on a domain outcome; `AgentUiRespondResult`
   *  stays the contract task-001 established. */
  async function respond(
    uiRequestId: string,
    response: AgentUiResponse,
  ): Promise<AgentUiRespondResult> {
    commit({ type: "respond_sent", requestId: uiRequestId, response });
    const result = await client.respondToUi(uiRequestId, response);
    if (!result.ok) commit({ type: "respond_failed", requestId: uiRequestId });
    return result;
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    respond,
    resync,
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeRequest();
      unsubscribeResolved();
      unsubscribePrune();
      unsubscribeState();
      listeners.clear();
      queue = [];
    },
  };
}
