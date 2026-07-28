/**
 * TextViewer — the default viewer for source/text files: fetches the UTF-8 preview via
 * `useFileRead` and renders it through `CodeView` (line gutter + Shiki highlighting). Registered
 * in `viewer-registry.ts` as the fallback for any file not claimed by a more specific viewer.
 *
 * Three size tiers (task-009 — raising `file_read_request`'s old 512 KiB ceiling):
 * 1. `size <= MAX_INLINE_FILE_READ_BYTES` (server-side, 5 MiB) — the `useFileRead` JSON round
 *    trip above, unchanged.
 * 2. `MAX_INLINE_FILE_READ_BYTES < size <= MAX_DISPLAY_BYTES` (30 MiB) — transparently refetch via
 *    the uncapped chunked binary download path (`use-file-text.ts`) and render the same
 *    `CodeView`, with a muted note that the file was streamed rather than read inline.
 * 3. `size > MAX_DISPLAY_BYTES` — a terminal state: no render attempt, just the size, why, and a
 *    download action (`BinaryFallbackViewer`'s existing on-demand download pattern).
 *
 * Which tier applies is the pure, DOM-free `selectTextViewerState` (`text-viewer-state.ts`) — this
 * component is a thin switch-render over it.
 */

import { useState } from "react";
import { Button } from "@pi-studio-ui/components/primitives/Button.js";
import { Spinner } from "@pi-studio-ui/components/primitives/Spinner.js";
import { useFileRead, FileTooLargeError } from "@pi-studio-ui/hooks/use-file-read.js";
import { useFileText } from "@pi-studio-ui/hooks/use-file-text.js";
import { useFileDownload } from "@pi-studio-ui/hooks/use-file-download.js";
import { CodeView } from "./CodeView.js";
import { selectTextViewerState } from "./text-viewer-state.js";
import type { ViewerProps } from "./viewer-registry.js";
import styles from "./FilePanel.module.css";
import textStyles from "./TextViewer.module.css";

/** Display ceiling above the inline cap. `CodeView`'s CodeMirror instance enables
 *  `EditorView.lineWrapping`, which makes it measure line heights across the whole document —
 *  well past interactive above this size, so files this large get a terminal download-only state
 *  instead of an attempted render. Deliberately not configurable (task-009 notes). */
export const MAX_DISPLAY_BYTES = 30 * 1024 * 1024;

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function TextViewer({ path }: ViewerProps) {
  const inline = useFileRead(path);
  const tooLarge = inline.error instanceof FileTooLargeError ? inline.error : null;
  const displayable = tooLarge !== null && tooLarge.size <= MAX_DISPLAY_BYTES;

  const streamed = useFileText(path, displayable);
  const [downloadRequested, setDownloadRequested] = useState(false);
  const download = useFileDownload(path, downloadRequested);

  const state = selectTextViewerState({
    maxDisplayBytes: MAX_DISPLAY_BYTES,
    inline: {
      isLoading: inline.isLoading,
      isError: inline.isError,
      tooLarge: tooLarge ? { size: tooLarge.size } : null,
      errorMessage: inline.error instanceof Error ? inline.error.message : null,
      content: inline.data?.content ?? null,
    },
    streamed: {
      isLoading: streamed.isLoading,
      isError: streamed.isError,
      errorMessage: streamed.error instanceof Error ? streamed.error.message : null,
      content: streamed.data?.content ?? null,
    },
    download: {
      requested: downloadRequested,
      isLoading: download.isLoading,
      objectUrl: download.data?.objectUrl ?? null,
      fileName: download.data?.fileName ?? null,
    },
  });

  switch (state.kind) {
    case "loading":
      return (
        <div className={styles.emptyState}>
          <Spinner size="sm" /> Loading...
        </div>
      );
    case "inline":
      return <CodeView path={path} content={state.content} />;
    case "streaming":
      return (
        <div className={styles.emptyState}>
          <Spinner size="sm" /> Streaming {formatMegabytes(state.size)} file...
        </div>
      );
    case "stream-error":
      return <div className={styles.emptyState}>Error: {state.message}</div>;
    case "streamed":
      return (
        <div className={textStyles.wrap}>
          <div className={textStyles.note}>{formatMegabytes(state.size)} file streamed</div>
          <div className={textStyles.body}>
            <CodeView path={path} content={state.content} />
          </div>
        </div>
      );
    case "too-large": {
      const name = path.split("/").pop() || path;
      return (
        <div className={styles.emptyState}>
          <div className={textStyles.tooLarge}>
            <div>
              {formatMegabytes(state.size)} — too large to display (display ceiling is{" "}
              {formatMegabytes(state.maxDisplayBytes)}).
            </div>
            {state.downloading ? (
              <Spinner size="sm" />
            ) : state.downloadUrl ? (
              <a href={state.downloadUrl} download={state.downloadName || name}>
                <Button size="sm">Save file</Button>
              </a>
            ) : (
              <Button size="sm" onClick={() => setDownloadRequested(true)}>
                Download
              </Button>
            )}
          </div>
        </div>
      );
    }
    case "error":
      return <div className={styles.emptyState}>Error: {state.message}</div>;
  }
}
