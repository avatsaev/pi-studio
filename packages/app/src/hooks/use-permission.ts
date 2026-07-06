/**
 * Permission response hook — submit permission decisions via the daemon RPC
 * and evaluate workspace auto-approve rules.
 *
 * clean-room-scope/features/timeline-rendering.md § Permission request prompt
 * clean-room-scope/features/agent-sessions.md § permissions
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useSessionStore } from "../store/session-store.js";
import { useClient } from "./client-context.js";
import {
  buildRespondPayload,
  evaluateAutoApprove,
  PERMISSION_RESPOND_RPC,
  type AutoApproveRule,
} from "../timeline/auto-approve.js";

export interface UsePermissionResult {
  /** Submit a decision for a permission request. */
  respond(requestId: string, optionId: string): Promise<void>;
  /** requestId currently being submitted (spinner), or null. */
  respondingId: string | null;
}

/**
 * Returns a responder that calls the permission-respond RPC and optimistically
 * marks the request resolved in the session store. Also auto-responds to any
 * pending request that matches a workspace auto-approve rule.
 */
export function usePermissionResponder(
  agentId: string | undefined,
  autoApproveRules: readonly AutoApproveRule[] = [],
): UsePermissionResult {
  const client = useClient();
  const store = useSessionStore;
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const autoRespondedRef = useRef<Set<string>>(new Set());

  const respondInternal = useCallback(
    async (requestId: string, optionId: string, source: "user" | "auto") => {
      if (!agentId) return;
      setRespondingId(requestId);
      try {
        if (client) {
          await client.connection.request(
            PERMISSION_RESPOND_RPC,
            buildRespondPayload(agentId, requestId, optionId) as unknown as Record<string, unknown>,
          );
        }
        const perms = store.getState().agents[agentId]?.permissions;
        const existing = perms?.[requestId];
        if (existing) {
          store.getState().resolvePermission(agentId, requestId, optionId);
          if (source === "auto") {
            // mark as auto-approved rather than user-resolved
            const cur = store.getState().agents[agentId]?.permissions[requestId];
            if (cur) store.getState().addPermission(agentId, { ...cur, state: "auto-approved" });
          }
        }
      } finally {
        setRespondingId((c) => (c === requestId ? null : c));
      }
    },
    [agentId, client], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const respond = useCallback(
    (requestId: string, optionId: string) => respondInternal(requestId, optionId, "user"),
    [respondInternal],
  );

  // Auto-approve: watch pending permissions and auto-respond on rule match.
  const permissions = useSessionStore((s) =>
    agentId ? s.agents[agentId]?.permissions : undefined,
  );
  useEffect(() => {
    if (!agentId || !permissions || autoApproveRules.length === 0) return;
    for (const perm of Object.values(permissions)) {
      if (perm.state !== "pending") continue;
      if (autoRespondedRef.current.has(perm.requestId)) continue;
      const optionId = evaluateAutoApprove(perm, autoApproveRules);
      if (optionId) {
        autoRespondedRef.current.add(perm.requestId);
        void respondInternal(perm.requestId, optionId, "auto");
      }
    }
  }, [agentId, permissions, autoApproveRules, respondInternal]);

  return { respond, respondingId };
}
