/**
 * BinaryFallbackViewer — the registry's catch-all for binary files with no dedicated viewer
 * (archives, executables, unrecognized blobs). No preview is attempted eagerly; a manual
 * "Download" action fetches the bytes on demand via `useFileDownload` and saves them locally
 * (POC_TO_APP_PLAN_UI.md §4.5 follow-up: modular file preview).
 */

import { FileQuestion } from "lucide-react";
import type { ViewerProps } from "./viewer-registry.js";
import { SaveFileButton } from "./SaveFileButton.js";
import styles from "./BinaryFallbackViewer.module.css";

export function BinaryFallbackViewer({ path, workspaceCwd }: ViewerProps) {
  const name = path.split("/").pop() || path;

  return (
    <div className={styles.wrap}>
      <FileQuestion size={32} />
      <div className={styles.name}>{name}</div>
      <div>No preview available for this file type.</div>
      <SaveFileButton path={path} />
    </div>
  );
}
