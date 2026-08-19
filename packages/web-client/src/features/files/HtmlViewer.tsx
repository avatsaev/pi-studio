/**
 * HtmlViewer — renders an `.html`/`.htm`/`.xhtml` file inside an isolated sandboxed iframe, with a
 * Preview/Source toggle (mirroring `MarkdownFileViewer`), a "Block remote resources" switch, and a
 * Reload action. See `html-sandbox.ts` for the two security invariants this component depends on
 * (never `allow-same-origin`; the CSP is a network policy, not the isolation boundary) and the
 * measured browser facts behind base-URL neutralization and the fragment-anchor fix.
 *
 * Source loading goes through the shared `use-file-source` ladder (task-002), so a report over the
 * 5 MiB inline cap still previews via the streamed tier instead of failing outright — real
 * coverage/benchmark HTML routinely exceeds it.
 *
 * Local asset inlining (`./style.css`, `./app.js`, relative images) is sprint-064: a multi-file
 * report renders unstyled here, which is the pre-existing baseline for any file type, not a
 * regression this task introduces.
 */

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@pi-studio-ui/components/primitives/Button.js";
import { Spinner } from "@pi-studio-ui/components/primitives/Spinner.js";
import { EmptyState } from "@pi-studio-ui/components/primitives/EmptyState.js";
import { Switch } from "@pi-studio-ui/components/primitives/Switch.js";
import { useFileSource } from "@pi-studio-ui/hooks/use-file-source.js";
import { rpcKeys } from "@pi-studio-ui/lib/connection/rpc-keys.js";
import { assembleHtmlPreview, HTML_SANDBOX_TOKENS } from "./html-sandbox.js";
import { CodeView } from "./CodeView.js";
import type { ViewerProps } from "./viewer-registry.js";
import styles from "./HtmlViewer.module.css";

type Mode = "preview" | "source";

const SANDBOX = HTML_SANDBOX_TOKENS.join(" ");

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function HtmlViewer({ path }: ViewerProps) {
  const state = useFileSource(path);
  const [mode, setMode] = useState<Mode>("preview");
  const [blockRemote, setBlockRemote] = useState(false);
  const queryClient = useQueryClient();

  const content = state.kind === "inline" || state.kind === "streamed" ? state.content : null;

  // Memoized on exactly (content, blockRemote) — not recomputed on unrelated re-renders (theme,
  // pane layout, Preview<->Source toggle-and-back). React re-setting `srcDoc` on the iframe
  // reloads the document and re-runs its scripts, and re-assembling a 30 MiB source every render
  // is a main-thread stall; this hook call is unconditional (before any branch below returns) so
  // it never runs out of order across renders.
  const srcDoc = useMemo(() => {
    if (content === null) return null;
    return assembleHtmlPreview(content, { blockRemote });
  }, [content, blockRemote]);

  function handleReload() {
    // Mirrors `useFileLiveRefresh`'s invalidation set exactly: `useFileText`'s decode is keyed on
    // the download's object URL, so invalidating `fileDownload` already forces a fresh decode —
    // no separate `fileText` invalidation needed (see task-002's notes).
    void queryClient.invalidateQueries({ queryKey: rpcKeys.fileRead(path) });
    void queryClient.invalidateQueries({ queryKey: rpcKeys.fileDownload(path) });
  }

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
    case "streamed":
      break;
  }

  if (content === null || srcDoc === null) return null;
  const name = path.split("/").pop() || path;

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <div className={styles.modeToggle}>
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
        <div className={styles.controls}>
          <label className={styles.switchLabel}>
            <Switch
              checked={blockRemote}
              onCheckedChange={setBlockRemote}
              aria-label="Block remote resources"
            />
            Block remote resources
          </label>
          <Button size="xs" variant="ghost" onClick={handleReload}>
            Reload
          </Button>
        </div>
      </div>
      {state.kind === "streamed" ? (
        <div className={styles.streamedNote}>{formatMegabytes(state.size)} file streamed</div>
      ) : null}
      <div className={styles.body}>
        {
          // The iframe is ALWAYS mounted once content is available — never conditionally
          // rendered on `mode` — and merely hidden via `display: none` in Source mode. A
          // ternary that unmounts/remounts it on toggle would destroy and recreate the
          // browsing context on every Preview<->Source round trip: a genuine reload (fresh
          // scripts, lost scroll position) despite `srcDoc`'s memoized string being unchanged.
          // `CodeView` has no persistent state worth keeping, so it stays conditional.
        }
        <iframe
          sandbox={SANDBOX}
          srcDoc={srcDoc}
          referrerPolicy="no-referrer"
          allow=""
          className={styles.frame}
          style={mode === "preview" ? undefined : { display: "none" }}
          title={name}
        />
        {mode === "source" ? <CodeView path={path} content={content} /> : null}
      </div>
    </div>
  );
}
