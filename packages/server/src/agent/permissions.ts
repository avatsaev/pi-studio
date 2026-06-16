import { randomUUID } from "node:crypto";

import type { Session } from "../ws/session.js";
import type { HandlerRegistry } from "../ws/router.js";
import type { AgentManager } from "./agent-manager.js";

/**
 * Tool-call permission flow + question-permission bridge
 * (features/tool-permissions.md § Flow messages / § Behavior / § Question-permission bridge).
 *
 * When an agent's mode requires approval:
 *  1. A tool call creates an `AgentPermissionRequest`, flags the agent as awaiting-input, and
 *     broadcasts `agent_permission_request` to all clients.
 *  2. The turn WAITS until `resolvePermission(requestId, response)` is called.
 *  3. The first resolution wins; `agent_permission_resolved` is broadcast to all clients.
 *  4. Full-access modes (`colorTier:"dangerous"`) emit no requests.
 *
 * Question bridge: Pi `select`/`input`/`editor`/`confirm` surface as question permissions. A
 * `select` with `allowComment:true` is ONE combined question — answer the `select`, then
 * auto-answer the follow-up optional `input` (supplied comment or empty string).
 */

export interface AgentPermissionRequestRecord {
  requestId: string;
  agentId: string;
  toolName?: string;
  action?: unknown;
  responses?: string[];
  /** Question-bridge kind. */
  questionKind?: "select" | "input" | "editor" | "confirm";
  allowComment?: boolean;
}

export type ResolutionResponse = string | Record<string, unknown>;

export interface LivePermission extends AgentPermissionRequestRecord {
  resolve: (response: ResolutionResponse) => void;
}

/**
 * In-memory permission state (not separately persisted — only broadcast-live per scope).
 * Keyed by `requestId`.
 */
export class PermissionStore {
  private readonly pending = new Map<string, LivePermission>();

  add(req: LivePermission): void {
    this.pending.set(req.requestId, req);
  }

  get(requestId: string): LivePermission | undefined {
    return this.pending.get(requestId);
  }

  remove(requestId: string): void {
    this.pending.delete(requestId);
  }

  listForAgent(agentId: string): LivePermission[] {
    return [...this.pending.values()].filter((p) => p.agentId === agentId);
  }
}

export const globalPermissionStore = new PermissionStore();

export interface PermissionServiceDeps {
  manager: AgentManager;
  broadcast: (sessions: Iterable<Session>, message: unknown) => void;
  store?: PermissionStore;
}

export class PermissionService {
  private readonly store: PermissionStore;

  constructor(private readonly deps: PermissionServiceDeps) {
    this.store = deps.store ?? globalPermissionStore;
  }

  registerHandlers(registry: HandlerRegistry, getActiveSessions: () => Iterable<Session>): void {
    registry.register("agent.permission.respond.request", (ctx) =>
      this.handleRespond(ctx.message as Record<string, unknown>, getActiveSessions),
    );
    registry.registerAlias("respond_to_permission", "agent.permission.respond.request");
  }

  private broadcastAll(sessions: Iterable<Session>, msg: unknown): void {
    this.deps.broadcast(sessions, msg);
  }

  /**
   * Create a permission request, broadcast it, and wait for resolution. Returns the decision.
   * Throws if interrupted (the promise is rejected externally).
   */
  requestPermission(
    req: Omit<AgentPermissionRequestRecord, "requestId">,
    getSessions: () => Iterable<Session>,
  ): { requestId: string; decision: Promise<ResolutionResponse> } {
    const requestId = randomUUID();
    let resolve!: (r: ResolutionResponse) => void;
    const decision = new Promise<ResolutionResponse>((res) => {
      resolve = res;
    });

    this.store.add({ ...req, requestId, resolve });
    this.broadcastAll(getSessions(), {
      type: "session",
      message: {
        type: "agent_permission_request",
        requestId,
        agentId: req.agentId,
        toolName: req.toolName,
        action: req.action,
        responses: req.responses ?? ["allow", "deny"],
      },
    });
    return { requestId, decision };
  }

  /**
   * Handle a respond-to-permission RPC. First resolution wins; subsequent calls are no-ops.
   */
  handleRespond(
    msg: Record<string, unknown>,
    getSessions: () => Iterable<Session>,
  ): Record<string, unknown> {
    const permId = msg.permissionRequestId as string;
    const response = msg.response as ResolutionResponse;
    const pending = this.store.get(permId);
    if (!pending) {
      // Already resolved or unknown.
      return {
        type: "agent.permission.respond.response",
        requestId: msg.requestId as string,
        payload: { resolved: false },
      };
    }

    this.store.remove(permId);
    pending.resolve(response);
    this.broadcastAll(getSessions(), {
      type: "session",
      message: {
        type: "agent_permission_resolved",
        requestId: permId,
        agentId: pending.agentId,
        decision: typeof response === "string" ? response : "allow",
      },
    });

    // Question bridge: auto-answer a follow-up optional comment input.
    if (pending.allowComment) {
      // The Pi adapter will surface the follow-up `input` as another question permission;
      // the comment (if any) is embedded in the response, or we auto-answer with empty string.
      const comment =
        typeof response === "object" && "comment" in response ? (response.comment as string) : "";
      // Find and resolve any pending follow-up input for the same agent.
      const followUp = this.store
        .listForAgent(pending.agentId)
        .find((p) => p.questionKind === "input");
      if (followUp) {
        this.store.remove(followUp.requestId);
        followUp.resolve(comment);
        this.broadcastAll(getSessions(), {
          type: "session",
          message: {
            type: "agent_permission_resolved",
            requestId: followUp.requestId,
            agentId: pending.agentId,
            decision: "auto",
          },
        });
      }
    }

    return {
      type: "agent.permission.respond.response",
      requestId: msg.requestId as string,
      payload: { resolved: true },
    };
  }

  /** Cancel all pending permissions for an agent (called on interrupt). */
  cancelPending(agentId: string, getSessions: () => Iterable<Session>): void {
    for (const pending of this.store.listForAgent(agentId)) {
      this.store.remove(pending.requestId);
      pending.resolve("canceled");
      this.broadcastAll(getSessions(), {
        type: "session",
        message: {
          type: "agent_permission_resolved",
          requestId: pending.requestId,
          agentId,
          decision: "canceled",
        },
      });
    }
  }
}
