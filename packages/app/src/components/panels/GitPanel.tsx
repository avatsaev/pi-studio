/**
 * GitPanel — Changes tab (diff viewer), git actions, PR activity.
 * feature-panels-ui.md § git changes/diff/PR
 */

import { useCallback, useState, useMemo } from "react";
import { GitBranch, RefreshCw } from "lucide-react";
import { clsx } from "clsx";
import styles from "./GitPanel.module.css";
import { Button } from "../primitives/index.js";
import {
  type DiffMode,
  type DiffLayout,
  type DiffSidebarState,
  type DiffFileEntry,
  type DiffViewEmptyReason,
  type GitAction,
  type GitActionStatus,
  type FileChange,
  type FileChangeStatus,
  type PrActivity,
  type PrActivityFeed,
  type ReviewCommentStore,
  type ReviewCommentDraft,
  INITIAL_DIFF_STATE,
  diffViewEmptyReason,
  diffEmptyMessage,
  sortActivitiesChronologically,
  addReviewComment,
  deleteReviewComment,
  commentsForLine,
  INITIAL_REVIEW_STORE,
} from "../../panels/git-panel.js";
import {
  canAttachActivityToChat,
  canAttachCheckLogsToChat,
  isFailedCheck,
} from "../../panels/pr-review.js";

// ---------------------------------------------------------------------------
// Changes tab
// ---------------------------------------------------------------------------

export interface GitChangesProps {
  state: DiffSidebarState;
  files: DiffFileEntry[];
  onModeChange: (mode: DiffMode) => void;
  onLayoutChange: (layout: DiffLayout) => void;
  onRefresh: () => void;
  onFileClick?: (path: string) => void;
  actions?: GitAction[];
  onAction?: (actionId: string) => void;
}

export function GitChangesPanel({
  state,
  files,
  onModeChange,
  onLayoutChange,
  onRefresh,
  onFileClick,
  actions = [],
  onAction,
}: GitChangesProps) {
  const emptyReason = useMemo(() => diffViewEmptyReason(state, files.length), [state, files]);

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <select
          className={styles.toolbarSelect}
          value={state.diffMode}
          onChange={(e) => onModeChange(e.target.value as DiffMode)}
        >
          <option value="uncommitted">Uncommitted</option>
          <option value="committed">Committed</option>
        </select>
        <select
          className={styles.toolbarSelect}
          value={state.diffLayout}
          onChange={(e) => onLayoutChange(e.target.value as DiffLayout)}
        >
          <option value="unified">Unified</option>
          <option value="split">Side-by-side</option>
        </select>
        <button className={styles.toolbarSelect} onClick={onRefresh} style={{ cursor: "pointer" }}>
          <RefreshCw size={10} />
        </button>
      </div>

      <div className={styles.body}>
        {emptyReason ? (
          <div className={styles.emptyMsg}>{diffEmptyMessage(emptyReason)}</div>
        ) : (
          files.map((file) => (
            <DiffFileHeader key={file.path} file={file} layout={state.diffLayout} onClick={onFileClick} />
          ))
        )}
      </div>

      {actions.length > 0 && (
        <div className={styles.actions}>
          {actions.map((action) => (
            <Button
              key={action.id}
              size="sm"
              disabled={action.status === "pending"}
              onClick={() => onAction?.(action.id)}
            >
              {action.label}{action.status === "pending" ? "…" : ""}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function DiffFileHeader({ file, layout, onClick }: { file: DiffFileEntry; layout: DiffLayout; onClick?: (p: string) => void }) {
  const statusClass = {
    modified: styles.statusModified,
    added: styles.statusAdded,
    deleted: styles.statusDeleted,
    renamed: styles.statusRenamed,
  }[file.status as string] ?? styles.statusModified;

  return (
    <div className={styles.fileHeader} onClick={() => onClick?.(file.path)}>
      <span className={clsx(styles.statusBadge, statusClass)}>{file.status[0]?.toUpperCase()}</span>
      <span>{file.path}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PR Activity Tab
// ---------------------------------------------------------------------------

export interface PrActivityProps {
  feed: PrActivityFeed;
  /** Attach a comment / review activity to the composer. */
  onAttach?: (activity: PrActivity) => void;
  /** Attach a failed check's logs to the composer. */
  onAttachLogs?: (activity: PrActivity) => void;
}

export function PrActivityPanel({ feed, onAttach, onAttachLogs }: PrActivityProps) {
  const sorted = useMemo(() => sortActivitiesChronologically(feed.activities), [feed.activities]);

  if (feed.loading) {
    return <div className={styles.emptyMsg}>Loading PR activity…</div>;
  }
  if (feed.error) {
    return <div className={styles.emptyMsg}>{feed.error}</div>;
  }
  if (sorted.length === 0) {
    return <div className={styles.emptyMsg}>No PR activity</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.body}>
        {sorted.map((item) => (
          <PrActivityRow
            key={activityKey(item)}
            item={item}
            onAttach={onAttach}
            onAttachLogs={onAttachLogs}
          />
        ))}
      </div>
    </div>
  );
}

function activityKey(item: PrActivity): string {
  return `${item.kind}-${item.id}`;
}

function PrActivityRow({
  item,
  onAttach,
  onAttachLogs,
}: {
  item: PrActivity;
  onAttach?: (a: PrActivity) => void;
  onAttachLogs?: (a: PrActivity) => void;
}) {
  const [logsOpen, setLogsOpen] = useState(false);
  const failed = isFailedCheck(item);
  const label =
    item.kind === "review_comment"
      ? "Review comment"
      : item.kind === "review_state"
        ? `Review: ${item.state}`
        : `Check: ${item.name} (${item.status})`;

  return (
    <div className={clsx(styles.prItem, failed && styles.prItemFailed)}>
      <div className={styles.prItemHeader}>
        <GitBranch size={12} />
        <span>{label}</span>
        {canAttachActivityToChat(item) && onAttach && (
          <button onClick={() => onAttach(item)} className={styles.prAttachBtn}>
            Attach
          </button>
        )}
        {canAttachCheckLogsToChat(item) && (
          <button onClick={() => setLogsOpen((o) => !o)} className={styles.prAttachBtn}>
            {logsOpen ? "Hide logs" : "Logs"}
          </button>
        )}
      </div>
      {"body" in item && item.body && <div className={styles.prItemBody}>{item.body}</div>}
      {logsOpen && canAttachCheckLogsToChat(item) && (
        <div className={styles.prLogs}>
          <pre className={styles.prLogsPre}>{item.kind === "check_run" ? item.logsUrl ?? "(no log output)" : ""}</pre>
          {onAttachLogs && (
            <button onClick={() => onAttachLogs(item)} className={styles.prAttachBtn}>
              Attach logs
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline Review (simple gutter comment)
// ---------------------------------------------------------------------------

export interface InlineReviewProps {
  store: ReviewCommentStore;
  filePath: string;
  lineNumber: number;
  side: "old" | "new";
  onAdd: (body: string) => void;
  onDelete: (id: string) => void;
}

export function InlineReview({ store, filePath, lineNumber, side, onAdd, onDelete }: InlineReviewProps) {
  const comments = useMemo(() => commentsForLine(store, filePath, side, lineNumber), [store, filePath, side, lineNumber]);
  const [draft, setDraft] = useState("");

  const handleSubmit = useCallback(() => {
    if (draft.trim()) {
      onAdd(draft.trim());
      setDraft("");
    }
  }, [draft, onAdd]);

  return (
    <div style={{ padding: "4px 8px", borderTop: "1px solid var(--pi-color-border)", fontSize: 12 }}>
      {comments.map((c) => (
        <div key={c.id} style={{ display: "flex", gap: 4, marginBottom: 4 }}>
          <span style={{ flex: 1 }}>{c.body}</span>
          <button onClick={() => onDelete(c.id)} style={{ background: "none", border: "none", color: "var(--pi-color-foregroundMuted)", cursor: "pointer", fontSize: 10 }}>✕</button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 4 }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add comment…" style={{ flex: 1, fontSize: 11, padding: "2px 4px", background: "var(--pi-color-surface1)", border: "1px solid var(--pi-color-border)", borderRadius: 3, color: "var(--pi-color-foreground)" }} />
        <Button size="sm" onClick={handleSubmit} disabled={!draft.trim()}>Add</Button>
      </div>
    </div>
  );
}
