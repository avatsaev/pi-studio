/**
 * TextViewer — the default viewer for source/text files: fetches the UTF-8 preview via
 * `useFileSource` and renders it through `CodeView` (line gutter + Shiki highlighting).
 * Registered in `viewer-registry.ts` as the fallback for any file not claimed by a more specific
 * viewer.
 *
 * Three size tiers (task-009 — raising `file_read_request`'s old 512 KiB ceiling; task-002 —
 * extracted into the shared `use-file-source` hook so other text-shaped viewers get the same
 * ladder):
 * 1. `size <= MAX_INLINE_FILE_READ_BYTES` (server-side, 5 MiB) — the `useFileRead` JSON round
 *    trip, unchanged.
 * 2. `MAX_INLINE_FILE_READ_BYTES < size <= MAX_DISPLAY_BYTES` (30 MiB) — transparently refetch via
 *    the uncapped chunked binary download path (`use-file-text.ts`) and render the same
 *    `CodeView`, with a muted note that the file was streamed rather than read inline.
 * 3. `size > MAX_DISPLAY_BYTES` — a terminal state: no render attempt, just the size, why, and a
 *    download action (`BinaryFallbackViewer`'s existing on-demand download pattern).
 *
 * Which tier applies is the pure, DOM-free `selectTextViewerState` (`text-viewer-state.ts`), run
 * inside `useFileSource` — this component is a thin switch-render over its result.
 */

import { Button } from "@pi-studio-ui/components/primitives/Button.js";
import { Spinner } from "@pi-studio-ui/components/primitives/Spinner.js";
import { Panel } from "@pi-studio-ui/components/primitives/Panel.js";
import { EmptyState } from "@pi-studio-ui/components/primitives/EmptyState.js";
import { useFileSource } from "@pi-studio-ui/hooks/use-file-source.js";
import { CodeView } from "./CodeView.js";
import type { ViewerProps } from "./viewer-registry.js";
import textStyles from "./TextViewer.module.css";

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function TextViewer({ path }: ViewerProps) {
  const state = useFileSource(path);

  switch (state.kind) {
    case "loading":
      return (
        <EmptyState>
          <Spinner size="sm" /> Loading...
        </EmptyState>
      );
    case "inline":
      return <CodeView path={path} content={state.content} />;
    case "streaming":
      return (
        <EmptyState>
          <Spinner size="sm" /> Streaming {formatMegabytes(state.size)} file...
        </EmptyState>
      );
    case "stream-error":
      return <EmptyState>Error: {state.message}</EmptyState>;
    case "streamed":
      return (
        <Panel>
          <div className={textStyles.note}>{formatMegabytes(state.size)} file streamed</div>
          <div className={textStyles.body}>
            <CodeView path={path} content={state.content} />
          </div>
        </Panel>
      );
    case "too-large": {
      const name = path.split("/").pop() || path;
      return (
        <EmptyState>
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
              <Button size="sm" onClick={() => state.requestDownload()}>
                Download
              </Button>
            )}
          </div>
        </EmptyState>
      );
    }
    case "error":
      return <EmptyState>Error: {state.message}</EmptyState>;
  }
}
