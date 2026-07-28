/**
 * MoleculeViewer — mounts `<MolViewer>` for both molecule-tab shapes: a file-backed tab (fetch
 * the file, hand molviewer the bytes) and an empty ("+"-menu) tab (no source — molviewer's own
 * drag-drop empty state, `ui.emptyState`'s `FirstRunCard`).
 *
 * Content is fetched through `useFileDownload` (chunked binary transfer, uncapped), not
 * `useFileRead` (`file_read_request`, UTF-8 text, inline-size capped): molviewer wants raw bytes
 * and the object URL that hook already produces is exactly molviewer's `{ url, name }` source
 * shape — no decode step, no new fetch hook.
 */

import { useRef, useState } from "react";
import { MolViewer, type MolViewerHandle } from "@molviewer/core";
import "@molviewer/core/style.css";
import { Spinner } from "@pi-studio-ui/components/primitives/Spinner.js";
import { useFileDownload } from "@pi-studio-ui/hooks/use-file-download.js";
import { moleculeSource } from "./molecule-source.js";
import styles from "./MoleculeViewer.module.css";

export interface MoleculeViewerProps {
  /** Absolute path of the file to render, or null for an empty ("New molecule view") tab. */
  path: string | null;
  /** True when this viewer's tab is the visible one. Molstar's own `ResizeObserver` on its canvas
   *  container re-fits on becoming visible (verified in the installed bundle), so this is not
   *  currently used to drive a manual re-fit — kept as the escape hatch task-010's visual
   *  verification may still need. */
  isActive?: boolean;
  /** Mirrors `MolViewerProps.onModifiedChange` upward so a parent (task-007's reload gate) can
   *  observe the clean/dirty transition without reaching into this component. */
  onModifiedChange?: (modified: boolean) => void;
}

export function MoleculeViewer({ path, isActive, onModifiedChange }: MoleculeViewerProps) {
  const download = useFileDownload(path ?? "", Boolean(path));
  const handleRef = useRef<MolViewerHandle>(null);
  // First load of this tab's file refits the camera ("replace"); every reload after that (the
  // same file changing on disk, task-007) preserves camera/selection/undo ("update"). A mounted
  // MoleculeViewer corresponds to exactly one tab for its whole lifetime (task-004 mints a new
  // tab id per path), so this never needs to reset for a "new" path mid-lifetime.
  const hasLoadedRef = useRef(false);
  const [loadError, setLoadError] = useState<Error | null>(null);

  const source = moleculeSource(path, download.data?.objectUrl);

  const downloadErrorMessage = download.isError
    ? download.error instanceof Error
      ? download.error.message
      : "download failed"
    : null;
  const errorMessage = downloadErrorMessage ?? loadError?.message ?? null;

  if (path && download.isPending) {
    return (
      <div className={styles.wrap}>
        <div className={styles.emptyState}>
          <Spinner size="sm" /> Loading...
        </div>
      </div>
    );
  }
  if (errorMessage) {
    return (
      <div className={styles.wrap}>
        <div className={styles.emptyState}>Error: {errorMessage}</div>
      </div>
    );
  }

  return (
    <div className={styles.wrap} data-molecule-active={isActive ? "true" : "false"}>
      <MolViewer
        ref={handleRef}
        className={styles.molViewer}
        source={source}
        sourceMode={hasLoadedRef.current ? "update" : "replace"}
        onLoad={() => {
          hasLoadedRef.current = true;
          setLoadError(null);
        }}
        onLoadError={(e) => setLoadError(e.error)}
        onModifiedChange={onModifiedChange}
      />
    </div>
  );
}
