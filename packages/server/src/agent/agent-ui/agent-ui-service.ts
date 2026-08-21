import { randomUUID } from "node:crypto";

import type { AgentUiPendingRequest, AgentUiSurface } from "@av-pi-studio/protocol";

import type { Logger } from "../../logging/logger.js";
import type { Session } from "../../ws/session.js";
import type {
  AgentSession,
  ProviderUiRequest,
  ProviderUiResponse,
  Unsubscribe,
} from "../provider-contract.js";

/**
 * Correlates the provider UI channel into the daemon's wire family
 * (features/extension-ui-rpc.md § Behavior & algorithms — the pseudocode there is normative). The
 * only stateful piece of the bridge, and deliberately **payload-blind**: every Pi-specific decision
 * (which methods block, surface-key namespacing, clear-by-omission, envelope stamping) was already
 * made by the adapter (task-002); this service does no `method` string comparison beyond the
 * unknown-method diagnostic log.
 *
 * Four behaviors here each prevent a concrete defect — see the task's own "Context / why":
 *  - **Wire ids are daemon-minted, never the provider's.** `ProviderUiRequest.requestId` is only
 *    promised unique per-process; keying a daemon-global map by it would let one agent's dialog
 *    shadow another's. `pending` is keyed by a minted UUID; providers never see it.
 *  - **Interrupt touches nothing.** Dialogs are not turn-scoped (`pi-background-tasks` raises
 *    questions outside any turn) and surfaces are agent-lifetime state. `sweep` runs ONLY on
 *    session-terminal events (archive/delete/re-attach) — nothing else cancels.
 *  - **Expiry never answers.** Pi auto-resolves its own timed dialogs; the mirrored timer here
 *    exists solely so clients dismiss in step. Sending a second response would target a dead id.
 *  - **Resolution broadcasts unconditionally.** A `respondToUi` throw (dead stdin after a crash)
 *    still broadcasts from `finally` — otherwise every other client keeps a ghost dialog that no
 *    longer appears in `agent_ui_list_response`.
 */

/** Extension UI method vocabulary as documented (rpc.md § Extension UI Protocol), used ONLY to
 *  decide whether an incoming method is diagnosable-as-unknown for the info log below — the single
 *  sanctioned exception to "no method string comparison" in this service. Duplicated here rather
 *  than imported from the Pi adapter: this service must stay provider-agnostic (never import
 *  `providers/pi/*` per root AGENTS.md § Key invariants #3), so this list is deliberately a
 *  diagnostics-only echo, not a source of behavior. */
const KNOWN_METHODS = new Set([
  "select",
  "confirm",
  "input",
  "editor",
  "notify",
  "setStatus",
  "setWidget",
  "setTitle",
  "set_editor_text",
]);

interface PendingEntry {
  agentId: string;
  providerRequestId: string;
  session: AgentSession;
  method: string;
  payload: Record<string, unknown>;
  surfaceKey?: string;
  timeoutMs?: number;
  createdAt: number;
  timer?: ReturnType<typeof setTimeout>;
}

export interface AgentUiServiceDeps {
  broadcast: (sessions: Iterable<Session>, message: unknown) => void;
  getActiveSessions: () => Iterable<Session>;
  logger?: Logger;
  /** Timer seams so tests use fake timers instead of wall-clock waits. */
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

export class AgentUiService {
  private readonly broadcastFn: (sessions: Iterable<Session>, message: unknown) => void;
  private readonly getActiveSessions: () => Iterable<Session>;
  private readonly logger: Logger | undefined;
  private readonly setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (handle: ReturnType<typeof setTimeout>) => void;

  private readonly pending = new Map<string, PendingEntry>();
  private readonly surfaces = new Map<string, Map<string, AgentUiSurface>>();
  private readonly channels = new Map<string, Unsubscribe>();
  private readonly loggedUnknownMethods = new Set<string>();

  constructor(deps: AgentUiServiceDeps) {
    this.broadcastFn = deps.broadcast;
    this.getActiveSessions = deps.getActiveSessions;
    this.logger = deps.logger;
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle));
  }

  /**
   * `AgentManager.onSessionAttached` hook (task-004 wires the call site; nothing calls this yet).
   * Sweeps first — a forced respawn (`spawnOrResumeSession` always spawns fresh) leaves undead
   * dialogs whose provider ids belong to a dead process, so any prior pending/surfaces/channel for
   * this agent are cancelled as `"aborted"` before the new session's channel is ever subscribed.
   */
  attach(agentId: string, session: AgentSession): void {
    this.sweep(agentId, "aborted");
    if (!session.onUiRequest) return; // provider opted out; nothing to do, no error
    const unsubscribe = session.onUiRequest((req) => this.onProviderRequest(agentId, session, req));
    this.channels.set(agentId, unsubscribe);
  }

  /** First-answer-wins. Unknown/already-resolved/fire-and-forget ids all report `not_found` — a
   *  fire-and-forget request was never inserted into `pending` in the first place. */
  respond(uiRequestId: string, response: ProviderUiResponse): { ok: boolean; error?: string } {
    const entry = this.pending.get(uiRequestId);
    if (!entry) return { ok: false, error: "not_found" };
    if (!entry.session.respondToUi) return { ok: false, error: "unsupported" };

    this.pending.delete(uiRequestId);
    if (entry.timer) this.clearTimer(entry.timer);
    try {
      entry.session.respondToUi(entry.providerRequestId, response);
    } catch (err) {
      // The answer was still accepted (first-wins already consumed it) — swallow + log so the
      // resolution broadcast below still fires; otherwise every other client keeps a ghost dialog.
      this.logger?.warn(
        {
          agentId: entry.agentId,
          requestId: uiRequestId,
          method: entry.method,
          err: errorMessage(err),
        },
        "agent-ui: respondToUi failed",
      );
    } finally {
      this.broadcastResolved(uiRequestId, entry.agentId, "answered");
    }
    return { ok: true };
  }

  listPending(agentId?: string): AgentUiPendingRequest[] {
    const result: AgentUiPendingRequest[] = [];
    for (const [wireId, entry] of this.pending) {
      if (agentId !== undefined && entry.agentId !== agentId) continue;
      result.push({
        requestId: wireId,
        agentId: entry.agentId,
        method: entry.method,
        expectsResponse: true,
        payload: entry.payload,
        ...(entry.surfaceKey !== undefined ? { surfaceKey: entry.surfaceKey } : {}),
        ...(entry.timeoutMs !== undefined ? { timeoutMs: entry.timeoutMs } : {}),
        createdAt: entry.createdAt,
      });
    }
    return result;
  }

  listSurfaces(agentId?: string): AgentUiSurface[] {
    if (agentId !== undefined) return [...(this.surfaces.get(agentId)?.values() ?? [])];
    const result: AgentUiSurface[] = [];
    for (const agentSurfaces of this.surfaces.values()) result.push(...agentSurfaces.values());
    return result;
  }

  /**
   * Session-terminal only (archive / delete / re-attach) — NEVER called on interrupt. For each
   * pending entry: best-effort cancel toward **the entry's own captured session** (never a freshly
   * attached one — on the attach-path sweep the new session never issued those provider ids),
   * broadcast the resolution, then drop the agent's pending entries, surfaces, and — critically —
   * call the stored channel `Unsubscribe` before dropping it, so a post-sweep emission from a dying
   * session cannot re-create a surface for an agent that no longer has a live channel.
   */
  sweep(agentId: string, reason: string): void {
    for (const [wireId, entry] of this.pending) {
      if (entry.agentId !== agentId) continue;
      this.pending.delete(wireId);
      if (entry.timer) this.clearTimer(entry.timer);
      if (entry.session.respondToUi) {
        try {
          entry.session.respondToUi(entry.providerRequestId, { cancelled: true });
        } catch (err) {
          this.logger?.warn(
            { agentId, requestId: wireId, method: entry.method, err: errorMessage(err) },
            "agent-ui: sweep respondToUi failed",
          );
        }
      }
      this.broadcastResolved(wireId, agentId, reason);
    }
    this.surfaces.delete(agentId);
    const unsubscribe = this.channels.get(agentId);
    if (unsubscribe) {
      unsubscribe();
      this.channels.delete(agentId);
    }
  }

  private onProviderRequest(agentId: string, session: AgentSession, req: ProviderUiRequest): void {
    const now = Date.now();

    if (req.surfaceKey !== undefined) {
      let agentSurfaces = this.surfaces.get(agentId);
      if (!agentSurfaces) {
        agentSurfaces = new Map<string, AgentUiSurface>();
        this.surfaces.set(agentId, agentSurfaces);
      }
      if (req.removed) {
        agentSurfaces.delete(req.surfaceKey);
      } else {
        agentSurfaces.set(req.surfaceKey, {
          agentId,
          method: req.method,
          surfaceKey: req.surfaceKey,
          payload: req.payload,
          updatedAt: now,
        });
      }
    }

    if (!KNOWN_METHODS.has(req.method)) {
      const key = `${agentId}:${req.method}`;
      if (!this.loggedUnknownMethods.has(key)) {
        this.loggedUnknownMethods.add(key);
        this.logger?.info({ agentId, method: req.method }, "agent-ui: unknown extension UI method");
      }
    }

    const wireId = randomUUID();
    if (req.expectsResponse) {
      const entry: PendingEntry = {
        agentId,
        providerRequestId: req.requestId,
        session,
        method: req.method,
        payload: req.payload,
        createdAt: now,
        ...(req.surfaceKey !== undefined ? { surfaceKey: req.surfaceKey } : {}),
        ...(req.timeoutMs !== undefined ? { timeoutMs: req.timeoutMs } : {}),
      };
      if (req.timeoutMs) entry.timer = this.setTimer(() => this.expire(wireId), req.timeoutMs);
      this.pending.set(wireId, entry);
    }

    this.broadcastFn(this.getActiveSessions(), {
      type: "session",
      message: {
        type: "agent_ui_request",
        requestId: wireId,
        agentId,
        method: req.method,
        expectsResponse: req.expectsResponse,
        payload: req.payload,
        ...(req.surfaceKey !== undefined ? { surfaceKey: req.surfaceKey } : {}),
        ...(req.removed ? { removed: true } : {}),
        ...(req.timeoutMs !== undefined ? { timeoutMs: req.timeoutMs } : {}),
        createdAt: now,
      },
    });
  }

  /** Pi's own timeout elapsed — Pi already auto-resolved the dialog on its side (docs/rpc.md: "the
   *  client does not need to track timeouts"). Deliberately does NOT call `respondToUi`: answering
   *  again would target an id Pi has already dropped. */
  private expire(wireId: string): void {
    const entry = this.pending.get(wireId);
    if (!entry) return;
    this.pending.delete(wireId);
    this.broadcastResolved(wireId, entry.agentId, "timeout");
  }

  private broadcastResolved(uiRequestId: string, agentId: string, reason: string): void {
    this.broadcastFn(this.getActiveSessions(), {
      type: "session",
      message: { type: "agent_ui_resolved", requestId: uiRequestId, agentId, reason },
    });
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
