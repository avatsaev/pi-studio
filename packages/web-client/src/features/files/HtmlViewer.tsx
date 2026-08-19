/**
 * HtmlViewer — renders an `.html`/`.htm`/`.xhtml` file inside an isolated sandboxed iframe, with a
 * Preview/Source toggle (mirroring `MarkdownFileViewer`), a "Block remote resources" switch, and a
 * Reload action. See `html-sandbox.ts` for the two security invariants this component depends on
 * (never `allow-same-origin`; the CSP is a network policy, not the isolation boundary) and the
 * measured browser facts behind base-URL neutralization and the fragment-anchor fix.
 *
 * Source loading goes through the shared `use-file-source` ladder (sprint-063 task-002), so a
 * report over the 5 MiB inline cap still previews via the streamed tier instead of failing
 * outright — real coverage/benchmark HTML routinely exceeds it.
 *
 * Local asset inlining (`./style.css`, `./app.js`, relative images — sprint-064) resolves the
 * document's local-asset refs (`html-assets.ts`), fetches and inlines them as `data:` URIs
 * (`html-asset-loader.ts`) over the existing binary file-transfer path, and surfaces anything left
 * un-inlined as a muted note. **Single-load rule:** while there is at least one local ref to
 * inline, the loading state is held until the asset bundle settles — never an assetless
 * intermediate `srcDoc` swapped for the inlined one, which would reload the document and re-run
 * its scripts twice (see the asset-bundle query below).
 */

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@pi-studio-ui/components/primitives/Button.js";
import { Spinner } from "@pi-studio-ui/components/primitives/Spinner.js";
import { EmptyState } from "@pi-studio-ui/components/primitives/EmptyState.js";
import { Switch } from "@pi-studio-ui/components/primitives/Switch.js";
import { useFileSource } from "@pi-studio-ui/hooks/use-file-source.js";
import { useHomeDir } from "@pi-studio-ui/hooks/use-home-dir.js";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { rpcKeys } from "@pi-studio-ui/lib/connection/rpc-keys.js";
import { dirOf, resolveWorkspacePath } from "@pi-studio-ui/lib/paths.js";
import { transferFor } from "@pi-studio-ui/hooks/file-transfer-instance.js";
import { assembleHtmlPreview, HTML_SANDBOX_TOKENS } from "./html-sandbox.js";
import { confineAssetRef, confinementRoot, extractLocalAssetRefs } from "./html-assets.js";
import { loadHtmlAssetBundle, type SkippedRef } from "./html-asset-loader.js";
import { CodeView } from "./CodeView.js";
import type { ViewerProps } from "./viewer-registry.js";
import styles from "./HtmlViewer.module.css";

type Mode = "preview" | "source";

const SANDBOX = HTML_SANDBOX_TOKENS.join(" ");
const EMPTY_ASSETS: Readonly<Record<string, string>> = Object.freeze({});
const EMPTY_SKIPPED: readonly SkippedRef[] = Object.freeze([]);

const SKIP_REASON_LABEL: Readonly<Record<SkippedRef["reason"], string>> = {
  external: "external",
  "outside-workspace": "outside workspace",
  unsupported: "unsupported",
  "over-cap": "over cap",
  "fetch-failed": "not found",
};

function summarizeSkipReasons(skipped: readonly SkippedRef[]): string {
  const counts = new Map<string, number>();
  for (const ref of skipped) {
    const label = SKIP_REASON_LABEL[ref.reason];
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, n]) => `${n} ${label}`).join(", ");
}

/** FNV-1a 32-bit string hash — not cryptographic, just a fast, deterministic asset-bundle query
 *  key input so the bundle refetches exactly when the document's own content changes, without
 *  keying a cache entry on a multi-MB string directly. */
function hashString(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function HtmlViewer({ path, workspaceCwd }: ViewerProps) {
  const state = useFileSource(path);
  const [mode, setMode] = useState<Mode>("preview");
  const [blockRemote, setBlockRemote] = useState(false);
  const [skippedExpanded, setSkippedExpanded] = useState(false);
  const queryClient = useQueryClient();
  const client = useConnectionStore((s) => s.client);
  const daemon = useConnectionStore((s) => s.daemon);
  const homeDir = useHomeDir();

  const content = state.kind === "inline" || state.kind === "streamed" ? state.content : null;

  // The document's own directory, and the confinement root narrowed to it for a home-rooted
  // (workspace-less) tab — see `confinementRoot`'s doc comment for why that narrowing matters.
  const docDir = useMemo(() => {
    const abs = resolveWorkspacePath(path, workspaceCwd);
    return abs ? dirOf(abs) : null;
  }, [path, workspaceCwd]);
  const root = useMemo(
    () => (docDir !== null ? confinementRoot(docDir, workspaceCwd, homeDir) : null),
    [docDir, workspaceCwd, homeDir],
  );

  // Every extracted ref, confined — recomputed only when the document text itself changes, not on
  // an unrelated re-render (theme, pane layout, Preview<->Source toggle-and-back).
  const confined = useMemo(() => {
    if (content === null || docDir === null || root === null) return [];
    return extractLocalAssetRefs(content).map((ref) =>
      confineAssetRef(ref.raw, docDir, root, ref.context, homeDir),
    );
  }, [content, docDir, root, homeDir]);
  const hasLocalRefs = useMemo(() => confined.some((ref) => ref.kind === "local"), [confined]);
  const confinementSkipped = useMemo(
    () =>
      confined.flatMap((ref) =>
        ref.kind === "skip" ? [{ raw: ref.raw, reason: ref.reason }] : [],
      ),
    [confined],
  );

  // Hashed, not the raw string — a query key element must be cheap to compare, and this only
  // recomputes when `content` (or whether there's anything to inline) actually changes.
  const contentHash = useMemo(
    () => (hasLocalRefs && content !== null ? hashString(content) : ""),
    [content, hasLocalRefs],
  );

  const assetQuery = useQuery({
    queryKey: rpcKeys.htmlAssetBundle(path, contentHash),
    queryFn: () => {
      const fetchBytes = async (assetPath: string): Promise<Uint8Array> => {
        if (!client || !daemon) throw new Error("not connected");
        const file = await transferFor(daemon).download(assetPath);
        return file.bytes;
      };
      return root === null
        ? Promise.resolve({ assets: {}, skipped: [] })
        : loadHtmlAssetBundle(confined, { root, homeDir, fetchBytes });
    },
    enabled: hasLocalRefs,
    // Immutable per (path, content hash) — a change is only ever observed via a new key
    // (document edited) or an explicit Reload invalidation, never a background refetch.
    staleTime: Infinity,
  });

  const assets = hasLocalRefs ? (assetQuery.data?.assets ?? EMPTY_ASSETS) : EMPTY_ASSETS;
  const skipped = hasLocalRefs ? (assetQuery.data?.skipped ?? EMPTY_SKIPPED) : confinementSkipped;

  // Memoized on exactly (content, assets, blockRemote) — not recomputed on unrelated re-renders.
  // React re-setting `srcDoc` on the iframe reloads the document and re-runs its scripts, and
  // re-assembling a 30 MiB source every render is a main-thread stall; this hook call is
  // unconditional (before any branch below returns) so it never runs out of order across renders.
  const srcDoc = useMemo(() => {
    if (content === null) return null;
    return assembleHtmlPreview(content, { assets, blockRemote });
  }, [content, assets, blockRemote]);

  function handleReload() {
    // Mirrors `useFileLiveRefresh`'s invalidation set exactly: `useFileText`'s decode is keyed on
    // the download's object URL, so invalidating `fileDownload` already forces a fresh decode —
    // no separate `fileText` invalidation needed. `htmlAssetBundleByPath` additionally forces a
    // refetch of the asset bundle even when the document's own hash is unchanged — the documented
    // way an edited *asset* (not the document itself) picks up its change, since only the
    // document is watched for live refresh.
    void queryClient.invalidateQueries({ queryKey: rpcKeys.fileRead(path) });
    void queryClient.invalidateQueries({ queryKey: rpcKeys.fileDownload(path) });
    void queryClient.invalidateQueries({ queryKey: rpcKeys.htmlAssetBundleByPath(path) });
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

  // Single-load rule: hold the loading state until the asset bundle settles rather than
  // rendering an assetless `srcDoc` now and swapping in the inlined one once fetched.
  if (hasLocalRefs && assetQuery.data === undefined) {
    return (
      <EmptyState>
        <Spinner size="sm" /> Loading assets...
      </EmptyState>
    );
  }

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
      {skipped.length > 0 ? (
        <div className={styles.skippedNote}>
          <button
            type="button"
            className={styles.skippedToggle}
            onClick={() => setSkippedExpanded((v) => !v)}
          >
            {skipped.length} reference{skipped.length === 1 ? "" : "s"} not inlined (
            {summarizeSkipReasons(skipped)})
          </button>
          {skippedExpanded ? (
            <ul className={styles.skippedList}>
              {skipped.map((ref) => (
                <li key={ref.raw}>
                  {ref.raw} — {SKIP_REASON_LABEL[ref.reason]}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
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
