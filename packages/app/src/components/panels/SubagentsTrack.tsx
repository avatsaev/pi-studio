/**
 * SubagentsTrack — collapsible strip listing child agents above the composer.
 * feature-panels-ui.md § subagents track
 */

import { useState, useMemo, useCallback } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { clsx } from "clsx";
import styles from "./SubagentsTrack.module.css";
import {
  type SubagentEntry,
  type SubagentTrackState,
  type SubagentChip,
  type ArchiveConfirm,
  buildSubagentChip,
  buildArchiveConfirm,
  trackHeaderLabel,
} from "../../panels/subagents-track.js";

export interface SubagentsTrackProps {
  entries: SubagentEntry[];
  expanded: boolean;
  onToggleExpand: () => void;
  onSelect: (agentId: string) => void;
  onArchive: (agentId: string) => void;
}

export function SubagentsTrack({
  entries,
  expanded,
  onToggleExpand,
  onSelect,
  onArchive,
}: SubagentsTrackProps) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const headerLabel = useMemo(() => trackHeaderLabel(entries), [entries]);

  if (entries.length === 0) return null;

  const handleArchiveClick = useCallback((e: React.MouseEvent, agentId: string) => {
    e.stopPropagation();
    setConfirmId(agentId);
  }, []);

  const handleConfirm = useCallback((agentId: string) => {
    onArchive(agentId);
    setConfirmId(null);
  }, [onArchive]);

  return (
    <div className={styles.container}>
      <div className={styles.header} onClick={onToggleExpand}>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span style={{ flex: 1, marginLeft: 4 }}>{headerLabel}</span>
        <span>{entries.length}</span>
      </div>
      {expanded && (
        <div className={styles.chips}>
          {entries.map((entry) => {
            const chip = buildSubagentChip(entry);
            return (
              <SubagentChipView
                key={entry.agentId}
                chip={chip}
                confirmActive={confirmId === entry.agentId}
                onSelect={() => onSelect(entry.agentId)}
                onArchiveClick={(e) => handleArchiveClick(e, entry.agentId)}
                onConfirm={() => handleConfirm(entry.agentId)}
                onCancelConfirm={() => setConfirmId(null)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function SubagentChipView({
  chip,
  confirmActive,
  onSelect,
  onArchiveClick,
  onConfirm,
  onCancelConfirm,
}: {
  chip: SubagentChip;
  confirmActive: boolean;
  onSelect: () => void;
  onArchiveClick: (e: React.MouseEvent) => void;
  onConfirm: () => void;
  onCancelConfirm: () => void;
}) {
  const dotClass = {
    running: styles.dotRunning,
    needs_attention: styles.dotAttention,
    failed: styles.dotFailed,
    idle: styles.dotIdle,
    archived: styles.dotIdle,
  }[chip.status];

  if (confirmActive) {
    return (
      <span className={styles.chip}>
        Archive {chip.label}?
        <button onClick={onConfirm} style={{ background: "none", border: "none", color: "var(--pi-color-statusDanger)", cursor: "pointer", fontSize: 10 }}>Yes</button>
        <button onClick={onCancelConfirm} style={{ background: "none", border: "none", color: "var(--pi-color-foregroundMuted)", cursor: "pointer", fontSize: 10 }}>No</button>
      </span>
    );
  }

  return (
    <span className={styles.chip} onClick={onSelect}>
      <span className={clsx(styles.dot, dotClass)} />
      {chip.label}
      {chip.needsAttention && <span style={{ color: "var(--pi-color-statusWarning)", fontSize: 9 }}>!</span>}
      <button className={styles.archiveBtn} onClick={onArchiveClick}><X size={8} /></button>
    </span>
  );
}
