/**
 * CommitBox — commit message + suggest + commit/push + stage toggles.
 * BranchSwitcher — current branch combobox with search/switch/create/delete.
 * ConflictList — conflict file resolution.
 *
 * feature-panels-ui.md § commit box, § git actions
 */

import { useCallback, useMemo, useState } from "react";
import { Check, ChevronsUpDown, GitBranch, Plus, Sparkles, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import styles from "./CommitBox.module.css";
import { Button } from "../primitives/index.js";
import {
  filterBranches,
  partitionBranches,
  validateBranchName,
  toggleStaged,
  buildConflictList,
  allConflictsResolved,
  type BranchOption,
  type StageableFile,
  type ConflictResolution,
  type GitStatusSummary,
} from "../../panels/git-controls.js";

// ─── Commit box ──────────────────────────────────────────────────────────────

export interface CommitBoxProps {
  files: StageableFile[];
  message: string;
  onMessageChange: (message: string) => void;
  stagedPaths: string[];
  onStagedChange: (paths: string[]) => void;
  onCommit: () => void;
  onCommitAndPush: () => void;
  onSuggest: () => void;
  committing?: boolean;
  pushing?: boolean;
  suggesting?: boolean;
}

export function CommitBox({
  files,
  message,
  onMessageChange,
  stagedPaths,
  onStagedChange,
  onCommit,
  onCommitAndPush,
  onSuggest,
  committing = false,
  pushing = false,
  suggesting = false,
}: CommitBoxProps) {
  const canCommit = message.trim().length > 0 && stagedPaths.length > 0 && !committing;

  return (
    <div className={styles.commitBox}>
      <div className={styles.fileList}>
        {files.map((f) => (
          <label key={f.path} className={styles.fileRow}>
            <input
              type="checkbox"
              checked={stagedPaths.includes(f.path)}
              onChange={() => onStagedChange(toggleStaged(stagedPaths, f.path))}
            />
            <span className={styles.filePath}>{f.path}</span>
          </label>
        ))}
      </div>
      <div className={styles.messageRow}>
        <textarea
          className={styles.messageInput}
          value={message}
          onChange={(e) => onMessageChange(e.target.value)}
          placeholder="Commit message…"
          rows={2}
        />
        <button className={styles.suggestBtn} onClick={onSuggest} disabled={suggesting} title="Suggest message">
          <Sparkles size={14} />
        </button>
      </div>
      <div className={styles.commitActions}>
        <Button size="sm" disabled={!canCommit} onClick={onCommit}>
          {committing ? "Committing…" : "Commit"}
        </Button>
        <Button size="sm" variant="secondary" disabled={!canCommit || pushing} onClick={onCommitAndPush}>
          {pushing ? "Pushing…" : "Commit & Push"}
        </Button>
      </div>
    </div>
  );
}

// ─── Branch switcher ─────────────────────────────────────────────────────────

export interface BranchSwitcherProps {
  currentBranch?: string;
  branches: BranchOption[];
  onSwitch: (name: string) => void;
  onCreate: (name: string) => void;
  onDelete: (name: string) => void;
}

export function BranchSwitcher({ currentBranch, branches, onSwitch, onCreate, onDelete }: BranchSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const filtered = useMemo(() => filterBranches(branches, query), [branches, query]);
  const { local, remote } = useMemo(() => partitionBranches(filtered), [filtered]);
  const validation = useMemo(() => validateBranchName(newName), [newName]);

  const handleCreate = useCallback(() => {
    if (validation.valid) {
      onCreate(validation.slug);
      setCreating(false);
      setNewName("");
      setOpen(false);
    }
  }, [validation, onCreate]);

  return (
    <div className={styles.branchSwitcher}>
      <button className={styles.branchTrigger} onClick={() => setOpen((o) => !o)}>
        <GitBranch size={12} />
        <span className={styles.branchName}>{currentBranch ?? "(no branch)"}</span>
        <ChevronsUpDown size={12} />
      </button>
      {open && (
        <div className={styles.branchDropdown}>
          <input
            className={styles.branchSearch}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search branches…"
            autoFocus
          />
          <div className={styles.branchList}>
            {local.length > 0 && <div className={styles.branchGroup}>Local</div>}
            {local.map((b) => (
              <BranchRow key={b.name} branch={b} onSwitch={onSwitch} onDelete={onDelete} />
            ))}
            {remote.length > 0 && <div className={styles.branchGroup}>Remote</div>}
            {remote.map((b) => (
              <BranchRow key={b.name} branch={b} onSwitch={onSwitch} onDelete={onDelete} />
            ))}
          </div>
          {creating ? (
            <div className={styles.createRow}>
              <input
                className={styles.branchSearch}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="new-branch-name"
                autoFocus
              />
              <Button size="sm" disabled={!validation.valid} onClick={handleCreate}>
                Create
              </Button>
              {newName && !validation.valid && <span className={styles.error}>{validation.error}</span>}
            </div>
          ) : (
            <button className={styles.createBranchBtn} onClick={() => setCreating(true)}>
              <Plus size={12} /> Create branch
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function BranchRow({
  branch,
  onSwitch,
  onDelete,
}: {
  branch: BranchOption;
  onSwitch: (name: string) => void;
  onDelete: (name: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div className={clsx(styles.branchRow, branch.isCurrent && styles.branchCurrent)}>
      <button className={styles.branchSelect} onClick={() => onSwitch(branch.name)}>
        {branch.isCurrent && <Check size={12} />}
        <span>{branch.name}</span>
      </button>
      {!branch.isCurrent && !branch.isRemote && (
        confirmDelete ? (
          <button className={styles.branchDelete} onClick={() => onDelete(branch.name)} title="Confirm delete">
            Confirm
          </button>
        ) : (
          <button className={styles.branchDelete} onClick={() => setConfirmDelete(true)} title="Delete branch">
            <Trash2 size={12} />
          </button>
        )
      )}
    </div>
  );
}

// ─── Conflict resolution ─────────────────────────────────────────────────────

export interface ConflictListProps {
  status: GitStatusSummary;
  onResolve: (path: string, resolution: ConflictResolution) => void;
  onOpen?: (path: string) => void;
}

export function ConflictList({ status, onResolve, onOpen }: ConflictListProps) {
  const [resolved, setResolved] = useState<Record<string, ConflictResolution>>({});
  const files = useMemo(() => buildConflictList(status), [status]);
  const merged = files.map((f) => ({ ...f, resolution: resolved[f.path] }));

  const resolve = useCallback(
    (path: string, resolution: ConflictResolution) => {
      setResolved((r) => ({ ...r, [path]: resolution }));
      onResolve(path, resolution);
    },
    [onResolve],
  );

  if (files.length === 0) return null;

  return (
    <div className={styles.conflicts}>
      <div className={styles.conflictHeader}>
        {files.length} conflicted file{files.length === 1 ? "" : "s"}
        {allConflictsResolved(merged) && <span className={styles.resolvedBadge}>All resolved</span>}
      </div>
      {merged.map((f) => (
        <div key={f.path} className={styles.conflictRow}>
          <span className={styles.filePath}>{f.path}</span>
          <div className={styles.conflictActions}>
            <button className={clsx(f.resolution === "ours" && styles.chosen)} onClick={() => resolve(f.path, "ours")}>
              Ours
            </button>
            <button className={clsx(f.resolution === "theirs" && styles.chosen)} onClick={() => resolve(f.path, "theirs")}>
              Theirs
            </button>
            {onOpen && <button onClick={() => onOpen(f.path)}>Open</button>}
          </div>
        </div>
      ))}
    </div>
  );
}
