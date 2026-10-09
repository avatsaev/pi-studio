/**
 * ContextMeterPopover — the status bar's context segment as an interactive control (sprint-074):
 * the meter is the trigger of a popover showing exact usage, an optional instructions field, and
 * one button — **Cancel** while compacting, otherwise **Compact now** (disabled with a reason
 * while the agent is running / not yet created / the daemon is unreachable). All sending goes
 * through `compaction-store`'s `compactSession`, the same action the composer's `/compact` uses.
 * The popover deliberately stays open while a compaction runs so Cancel is reachable; Radix
 * returns focus to the trigger on Escape/outside press.
 */

import { useState } from "react";
import { Button } from "@pi-studio-ui/components/primitives/Button.js";
import { Popover, PopoverContent } from "@pi-studio-ui/components/primitives/Popover.js";
import { TextArea } from "@pi-studio-ui/components/primitives/TextInput.js";
import { useIsCompacting } from "@pi-studio-ui/hooks/use-is-compacting.js";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useCompactionStore } from "@pi-studio-ui/stores/compaction-store.js";
import { useSessionStore } from "@pi-studio-ui/stores/session-store.js";
import type { SessionStats } from "@pi-studio-ui/stores/stats-store.js";
import { compactionLabel, pendingCompaction } from "@pi-studio-ui/timeline/compaction.js";
import { ContextMeter } from "./ContextMeter.js";
import { meterState, meterText, meterTitle } from "./context-meter.js";
import { compactAction } from "./compact-action.js";
import styles from "./ContextMeterPopover.module.css";

export interface ContextMeterPopoverProps {
  sessionId: string;
  stats: SessionStats | undefined;
}

export function ContextMeterPopover({ sessionId, stats }: ContextMeterPopoverProps) {
  const [instructions, setInstructions] = useState("");
  const compacting = useIsCompacting(sessionId);
  const connected = useConnectionStore((s) => s.status === "open");
  const agentId = useSessionStore((s) => s.sessions[sessionId]?.agentId ?? null);
  const running = useSessionStore((s) => s.sessions[sessionId]?.status === "running");
  const started = useSessionStore((s) =>
    pendingCompaction(s.sessions[sessionId]?.timeline.rows ?? []),
  );
  const error = useCompactionStore((s) => s.lastErrorBySession[sessionId]);
  const compactSession = useCompactionStore((s) => s.compactSession);
  const cancelCompaction = useCompactionStore((s) => s.cancelCompaction);

  const state = meterState(stats, compacting);
  const action = compactAction({ compacting, running, hasAgent: agentId !== null, connected });
  const note =
    action.kind === "cancel" ? (started ? compactionLabel(started) : "Compacting…") : action.note;

  async function handleCompact(): Promise<void> {
    const result = await compactSession(sessionId, instructions.trim() || undefined);
    if (result.ok) setInstructions(""); // cleared on success, kept on failure so it can be retried
  }

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={styles.trigger}
          aria-label="Context usage — open compaction options"
        >
          <ContextMeter stats={stats} compacting={compacting} />
        </button>
      </Popover.Trigger>
      <PopoverContent width={320} aria-label="Compact context">
        <div className={styles.body}>
          <div className={styles.heading}>Context</div>
          <ContextMeter stats={stats} compacting={compacting} wide />
          <div className={styles.detail}>
            {state.kind === "value"
              ? `${meterTitle(stats, state)} (${meterText(state)})`
              : meterTitle(stats, state)}
          </div>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Instructions (optional)</span>
            <TextArea
              value={instructions}
              rows={3}
              placeholder="e.g. focus on the auth refactor"
              disabled={compacting}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </label>

          {error && !compacting && (
            <div role="alert" className={styles.error}>
              {error}
            </div>
          )}
          {note && <div className={styles.note}>{note}</div>}

          <div className={styles.actions}>
            {action.kind === "cancel" ? (
              <Button variant="outline" size="sm" onClick={() => void cancelCompaction(sessionId)}>
                Cancel
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                disabled={action.kind === "disabled"}
                onClick={() => void handleCompact()}
              >
                Compact now
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover.Root>
  );
}
