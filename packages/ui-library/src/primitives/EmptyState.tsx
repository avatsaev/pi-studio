/**
 * EmptyState — centered, muted placeholder text (loading/error/no-results states) — the shared
 * shape behind FileExplorer/ChangesPanel/OpenWorkspaceDialog/SessionList's plain-text variant and
 * FilePanel/MoleculeViewer's `<Spinner/> Loading…` variant (both are a centered flex row; a
 * lone text child renders identically to the plain-text sites' old `text-align: center`).
 * ui-components.md § Feedback
 */

import { type HTMLAttributes } from "react";
import { clsx } from "clsx";
import styles from "./EmptyState.module.css";

export type EmptyStateProps = HTMLAttributes<HTMLDivElement>;

export function EmptyState({ className, ...rest }: EmptyStateProps) {
  return <div className={clsx(styles.emptyState, className)} {...rest} />;
}
