/**
 * TreeDraftRow — the inline "new file"/"new folder" name-entry row rendered in place of a real
 * tree row (`file-tree.ts`'s `DraftRow`). Owns the input's local text state so `TreeNode` stays
 * hook-free and presentational; submits the trimmed name up to `FileExplorer` via `onSubmit`,
 * or discards the draft via `onCancel` on Escape/blur/empty-submit.
 */

import { useState, type CSSProperties } from "react";
import { Folder, File as FileIcon } from "lucide-react";
import styles from "./FileExplorer.module.css";

export interface TreeDraftRowProps {
  draftKind: "file" | "directory";
  indentStyle: CSSProperties;
  onSubmit(name: string): void;
  onCancel(): void;
}

export function TreeDraftRow({ draftKind, indentStyle, onSubmit, onCancel }: TreeDraftRowProps) {
  const [name, setName] = useState("");

  return (
    <div className={styles.item} style={indentStyle} onClick={(e) => e.stopPropagation()}>
      <span className={styles.chevronSlot} />
      <span className={styles.icon}>
        {draftKind === "directory" ? <Folder size={14} /> : <FileIcon size={14} />}
      </span>
      <input
        className={styles.draftInput}
        autoFocus
        spellCheck={false}
        placeholder={draftKind === "directory" ? "New folder" : "New file"}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const trimmed = name.trim();
            if (trimmed) onSubmit(trimmed);
            else onCancel();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={onCancel}
      />
    </div>
  );
}
