/**
 * RewindMenu — inline rewind affordance on user messages.
 * rewind.md
 */

import { useState, useMemo, useCallback } from "react";
import { RotateCcw } from "lucide-react";
import { clsx } from "clsx";
import styles from "./RewindMenu.module.css";
import { Button } from "../primitives/index.js";
import { AdaptiveSheet } from "../overlays/Dialog.js";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../overlays/DropdownMenu.js";
import {
  rewindMenuItems,
  shouldShowRewindMenu,
  startRewind,
  rewindSuccess,
  rewindError,
  isRewindPending,
  postRewindActions,
  type RewindMode,
  type RewindMutationState,
  type RewindMenuItem,
  type PostRewindAction,
  REWIND_IDLE,
} from "../../timeline/rewind.js";
import type { AgentCapabilityFlags } from "@av-pi-studio/protocol";

export interface RewindMenuProps {
  messageId: string;
  messageText: string;
  agentId: string;
  capabilities: Partial<AgentCapabilityFlags>;
  composerEmpty?: boolean;
  onRewind: (messageId: string, mode: RewindMode) => Promise<void>;
  onPostActions?: (actions: PostRewindAction[]) => void;
  visible?: boolean;
}

export function RewindMenu({
  messageId,
  messageText,
  agentId,
  capabilities,
  composerEmpty = true,
  onRewind,
  onPostActions,
  visible = false,
}: RewindMenuProps) {
  const showMenu = useMemo(() => shouldShowRewindMenu(capabilities), [capabilities]);
  const items = useMemo(() => rewindMenuItems(capabilities), [capabilities]);
  const [state, setState] = useState<RewindMutationState>(REWIND_IDLE);
  const [confirmMode, setConfirmMode] = useState<RewindMode | null>(null);

  const executeRewind = useCallback(
    async (mode: RewindMode) => {
      setState(startRewind(messageId, mode));
      try {
        await onRewind(messageId, mode);
        setState(rewindSuccess(state));
        const actions = postRewindActions({ mode, agentId, rewoundMessageText: messageText, composerEmpty });
        onPostActions?.(actions);
      } catch (err) {
        setState(rewindError(state, err instanceof Error ? err.message : String(err)));
      }
    },
    [messageId, messageText, state, onRewind, onPostActions],
  );

  const handleSelect = useCallback(
    (item: RewindMenuItem) => {
      if (item.mode === "files" || item.mode === "both") {
        setConfirmMode(item.mode);
      } else {
        executeRewind(item.mode);
      }
    },
    [executeRewind],
  );

  if (!showMenu) return null;

  return (
    <span className={clsx(visible && styles.visible)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className={clsx(styles.trigger, isRewindPending(state) && styles.pending)}>
            <RotateCcw size={10} />
            Rewind
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end">
          {items.map((item) => (
            <DropdownMenuItem
              key={item.mode}
              onSelect={() => handleSelect(item)}
            >
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Confirmation for destructive rewinds */}
      <AdaptiveSheet
        visible={confirmMode !== null}
        onClose={() => setConfirmMode(null)}
        title="Confirm rewind"
      >
        <p style={{ fontSize: 13, margin: "0 0 12px", color: "var(--pi-color-foreground)" }}>
          This will revert file changes {confirmMode === "both" ? "and the conversation" : ""} to this point. This cannot be undone.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="destructive" onClick={() => { setConfirmMode(null); executeRewind(confirmMode!); }}>
            Rewind
          </Button>
          <Button variant="ghost" onClick={() => setConfirmMode(null)}>Cancel</Button>
        </div>
      </AdaptiveSheet>
    </span>
  );
}
