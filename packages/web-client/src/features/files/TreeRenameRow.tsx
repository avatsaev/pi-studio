/**
 * TreeRenameRow — the inline rename editor rendered in place of the row being renamed
 * (`file-tree.ts`'s `RenameRow`). Mirrors `TreeDraftRow`'s division of labour: owns the input's
 * local text state so `TreeNode` stays hook-free and presentational; submits the trimmed name up
 * to `FileExplorer` via `onSubmit`, or discards the edit via `onCancel` on Escape/blur/unchanged-
 * or-empty submit.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Folder, File as FileIcon } from "lucide-react";
import styles from "./FileExplorer.module.css";

export interface TreeRenameRowProps {
  /** Current basename, pre-filled as the input's initial value. */
  name: string;
  isDirectory: boolean;
  indentStyle: CSSProperties;
  /** Called with the trimmed name once it is non-empty and actually different from `name`. */
  onSubmit(name: string): void;
  onCancel(): void;
}

export function TreeRenameRow({
  name,
  isDirectory,
  indentStyle,
  onSubmit,
  onCancel,
}: TreeRenameRowProps) {
  const [value, setValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    // Select the basename without its extension so a straight re-type doesn't clobber it. Falls
    // back to selecting the whole name for a directory (no extension to preserve) or a dotfile
    // like `.gitignore` (`lastIndexOf(".")` is 0, not a real extension boundary).
    const dot = name.lastIndexOf(".");
    const end = isDirectory || dot <= 0 ? name.length : dot;
    input.setSelectionRange(0, end);
  }, [name, isDirectory]);

  return (
    <div className={styles.item} style={indentStyle} onClick={(e) => e.stopPropagation()}>
      <span className={styles.chevronSlot} />
      <span className={styles.icon}>
        {isDirectory ? <Folder size={16} /> : <FileIcon size={16} />}
      </span>
      <input
        ref={inputRef}
        className={styles.draftInput}
        spellCheck={false}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const trimmed = value.trim();
            // Bailing on empty or unchanged avoids a pointless round-trip the daemon would only
            // answer with `same_path`.
            if (!trimmed || trimmed === name) onCancel();
            else onSubmit(trimmed);
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
