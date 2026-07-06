/**
 * Rewind + fork hooks — wire the rewind menu / fork-context menu to daemon RPCs.
 *
 * clean-room-scope/features/rewind.md
 * clean-room-scope/features/composer-ui.md § fork context
 */

import { useCallback, useState } from "react";
import { useSessionStore } from "../store/session-store.js";
import { useClient } from "./client-context.js";
import {
  rewindMenuItems,
  shouldShowRewindMenu,
  buildRewindRequest,
  buildRewindConfirmation,
  postRewindActions,
  REWIND_RPC,
  type RewindMode,
  type RewindMenuItem,
  type RewindConfirmation,
} from "../timeline/rewind.js";
import { buildForkRequest, type ForkRequestInput } from "../timeline/fork.js";
import type { AgentCapabilityFlags } from "@av-pi-studio/protocol";

export interface UseRewindResult {
  /** Menu items resolved from provider capabilities (empty → hide menu). */
  items: RewindMenuItem[];
  /** Whether the rewind menu should be shown at all. */
  visible: boolean;
  /** Build the (possibly destructive) confirmation for a mode. */
  confirmation(mode: RewindMode, affectedFiles?: string[]): RewindConfirmation;
  /** Mode currently in-flight (spinner), or null. */
  pendingMode: RewindMode | null;
  /** Perform the rewind: RPC → truncate timeline → restore composer draft. */
  rewind(input: {
    messageId: string;
    mode: RewindMode;
    rewoundMessageText?: string;
    composerEmpty?: boolean;
    onRestoreComposer?: (text: string) => void;
    onRefetchTail?: () => void;
  }): Promise<void>;
}

export function useRewind(
  agentId: string | undefined,
  capabilities: Partial<AgentCapabilityFlags> = {},
): UseRewindResult {
  const client = useClient();
  const store = useSessionStore;
  const [pendingMode, setPendingMode] = useState<RewindMode | null>(null);

  const items = rewindMenuItems(capabilities);
  const visible = shouldShowRewindMenu(capabilities);

  const confirmation = useCallback(
    (mode: RewindMode, affectedFiles: string[] = []) => buildRewindConfirmation(mode, affectedFiles),
    [],
  );

  const rewind = useCallback<UseRewindResult["rewind"]>(
    async ({ messageId, mode, rewoundMessageText = "", composerEmpty = true, onRestoreComposer, onRefetchTail }) => {
      if (!agentId || !client) return;
      setPendingMode(mode);
      try {
        await client.connection.request(
          REWIND_RPC,
          buildRewindRequest(agentId, messageId, mode) as unknown as Record<string, unknown>,
        );
        // Post-rewind client sync.
        if (mode !== "files") {
          store.getState().truncateTimelineAfter(agentId, messageId);
        }
        for (const action of postRewindActions({ mode, agentId, rewoundMessageText, composerEmpty })) {
          if (action.kind === "refetch-tail") onRefetchTail?.();
          else if (action.kind === "restore-composer") onRestoreComposer?.(action.text);
        }
      } finally {
        setPendingMode(null);
      }
    },
    [agentId, client], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return { items, visible, confirmation, pendingMode, rewind };
}

// ─── Fork context ────────────────────────────────────────────────────────────

export interface UseForkResult {
  forking: boolean;
  /** Create a forked session; returns the new agentId (or undefined on failure). */
  fork(input: Omit<ForkRequestInput, "sourceAgentId">): Promise<string | undefined>;
}

export function useFork(sourceAgentId: string | undefined): UseForkResult {
  const client = useClient();
  const [forking, setForking] = useState(false);

  const fork = useCallback<UseForkResult["fork"]>(
    async (input) => {
      if (!sourceAgentId || !client) return undefined;
      setForking(true);
      try {
        const payload = buildForkRequest({ sourceAgentId, ...input });
        const created = await client.createAgent(payload as unknown as Parameters<typeof client.createAgent>[0]);
        return created.agentId;
      } finally {
        setForking(false);
      }
    },
    [sourceAgentId, client],
  );

  return { forking, fork };
}
