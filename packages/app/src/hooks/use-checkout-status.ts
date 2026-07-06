/**
 * useCheckoutStatus — live checkout status badge + `checkout_status_update`
 * subscription that refreshes the git-status cache and emits git notifications.
 *
 * git-checkout.md § checkout status; worktrees.md
 */

import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  deriveCheckoutBadge,
  isStaleBranch,
  buildGitNotification,
  type CheckoutBadge,
  type GitNotification,
} from "../panels/checkout-status.js";
import type { GitStatusSummary } from "../panels/git-controls.js";
import { EXPLORER_QUERY_KEYS } from "./use-explorer-hooks.js";

interface SubscriptionClient {
  connection: { onSessionMessage(handler: (msg: unknown) => void): () => void };
}

export interface UseCheckoutStatusResult {
  badge: CheckoutBadge;
  stale: boolean;
}

/**
 * Derive the badge from a status summary and (optionally) subscribe to live
 * `checkout_status_update` events, refreshing the cache + firing notifications.
 */
export function useCheckoutStatus(
  serverId: string | undefined,
  cwd: string | undefined,
  status: GitStatusSummary,
  client: SubscriptionClient | null,
  options: {
    now?: number;
    onNotify?: (n: GitNotification) => void;
  } = {},
): UseCheckoutStatusResult {
  const qc = useQueryClient();
  const now = options.now ?? Date.now();
  const onNotify = options.onNotify;

  useEffect(() => {
    if (!client || !serverId || !cwd) return;
    return client.connection.onSessionMessage((raw: unknown) => {
      const msg = raw as Record<string, unknown>;
      const type = msg["type"];
      if (type === "checkout_status_update" && msg["serverId"] === serverId && msg["cwd"] === cwd) {
        qc.invalidateQueries({ queryKey: EXPLORER_QUERY_KEYS.gitStatus(serverId, cwd) });
        // Conflict detection from the streamed status.
        const conflicts = (msg["conflicts"] as string[] | undefined) ?? [];
        if (conflicts.length > 0 && onNotify) {
          onNotify(buildGitNotification({ type: "conflict", files: conflicts }));
        }
      } else if (type === "git_push_success" && onNotify) {
        onNotify(
          buildGitNotification({
            type: "push_success",
            count: (msg["count"] as number) ?? 0,
            branch: (msg["branch"] as string) ?? "",
          }),
        );
      } else if (type === "git_pull_new" && onNotify) {
        onNotify(buildGitNotification({ type: "pull_new", count: (msg["count"] as number) ?? 0 }));
      } else if (type === "git_worktree_created" && onNotify) {
        onNotify(buildGitNotification({ type: "worktree_created", path: (msg["path"] as string) ?? "" }));
      }
    });
  }, [client, serverId, cwd, qc, onNotify]);

  const badge = useMemo(() => deriveCheckoutBadge(status), [status]);
  const stale = useMemo(() => isStaleBranch(status, now), [status, now]);

  return { badge, stale };
}
