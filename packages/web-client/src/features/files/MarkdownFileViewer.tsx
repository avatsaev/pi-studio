/**
 * MarkdownFileViewer — renders a `.md`/`.mdx` file's content through the app's sanitized
 * Markdown renderer (`timeline/markdown.tsx`, react-markdown + remark-gfm — no
 * `dangerouslySetInnerHTML` of user content), with a Preview/Source toggle since raw markdown is
 * sometimes what you actually want to read (POC_TO_APP_PLAN_UI.md §4.5 follow-up: modular file
 * preview).
 *
 * Source loading goes through the shared `use-file-source` ladder (task-002) instead of a bare
 * inline read, so a file over the server's inline-read cap streams and previews — with the same
 * muted "streamed" affordance `TextViewer` shows — instead of erroring with `file_too_large`.
 */

import { useMemo, useState } from "react";
import { Button } from "@pi-studio-ui/components/primitives/Button.js";
import { Spinner } from "@pi-studio-ui/components/primitives/Spinner.js";
import { EmptyState } from "@pi-studio-ui/components/primitives/EmptyState.js";
import { useFileSource } from "@pi-studio-ui/hooks/use-file-source.js";
import { dirOf, resolveWorkspacePath } from "@pi-studio-ui/lib/paths.js";
import { Markdown } from "@pi-studio-ui/timeline/markdown.js";
import { CodeView } from "./CodeView.js";
import type { ViewerProps } from "./viewer-registry.js";
import styles from "./MarkdownFileViewer.module.css";

type Mode = "preview" | "source";

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MarkdownFileViewer({ path, workspaceCwd }: ViewerProps) {
  const state = useFileSource(path);
  const [mode, setMode] = useState<Mode>("preview");
  // `assetBase` — not `workspaceCwd` itself — is what `classifyImageSrc`/`InlineImage` resolve a
  // relative `![x](./shot.png)` against (mirrors the chat timeline's `normalizeCwd(session.cwd,
  // homeDir)`): the file's OWN directory, not the workspace root. `workspaceCwd` alone is still
  // threaded through for click-to-open pane targeting (`resolveFileOpenTarget`).
  const assetBase = useMemo(() => {
    const abs = resolveWorkspacePath(path, workspaceCwd);
    return abs ? dirOf(abs) : null;
  }, [path, workspaceCwd]);

  switch (state.kind) {
    case "loading":
      return (
        <EmptyState>
          <Spinner size="sm" /> Loading...
        </EmptyState>
      );
    case "streaming":
      return (
        <EmptyState>
          <Spinner size="sm" /> Streaming {formatMegabytes(state.size)} file...
        </EmptyState>
      );
    case "stream-error":
    case "error":
      return <EmptyState>Error: {state.message}</EmptyState>;
    case "too-large": {
      const name = path.split("/").pop() || path;
      return (
        <EmptyState>
          <div className={styles.tooLarge}>
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
    case "inline":
    case "streamed": {
      const content = state.content;
      const streamed = state.kind === "streamed";
      return (
        <div className={styles.wrap}>
          <div className={styles.toolbar}>
            <Button
              size="xs"
              variant={mode === "preview" ? "default" : "ghost"}
              onClick={() => setMode("preview")}
            >
              Preview
            </Button>
            <Button
              size="xs"
              variant={mode === "source" ? "default" : "ghost"}
              onClick={() => setMode("source")}
            >
              Source
            </Button>
          </div>
          {streamed ? (
            <div className={styles.streamedNote}>{formatMegabytes(state.size)} file streamed</div>
          ) : null}
          {mode === "preview" ? (
            <div className={styles.rendered}>
              <Markdown text={content} assetBase={assetBase} workspaceCwd={workspaceCwd} />
            </div>
          ) : (
            <CodeView path={path} content={content} />
          )}
        </div>
      );
    }
  }
}
