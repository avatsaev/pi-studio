/**
 * MoleculeViewer — mounts `<MolViewer>` for both molecule-tab shapes: a file-backed tab (fetch
 * the file, hand molviewer the bytes) and an empty ("+"-menu) tab (no source — molviewer's own
 * drag-drop empty state, `ui.emptyState`'s `FirstRunCard`).
 *
 * Content is fetched through `useFileDownload` (chunked binary transfer, uncapped), not
 * `useFileRead` (`file_read_request`, UTF-8 text, inline-size capped): molviewer wants raw bytes
 * and the object URL that hook already produces is exactly molviewer's `{ url, name }` source
 * shape — no decode step, no new fetch hook.
 *
 * Live reload (task-006/007): `useFileWatch` pushes a new `changedAt` whenever the daemon detects
 * the file changed on disk. `shouldApplyRefresh` (kept in its own pure module, see
 * `molecule-reload.ts`) gates the reaction on there being no unsaved in-viewer edits; when it
 * clears, `download.refetch()` mints a fresh object URL, the `source` prop changes, and
 * `MolViewer` reloads with `sourceMode="update"` — camera/selection survive. When it's gated by
 * unsaved edits, a small stale-file indicator surfaces instead of silently diverging.
 *
 * Save (`onSave`, `@molviewer/core@0.4.1`): only wired when `path` is non-null — a file-backed
 * tab writes the viewer's current serialization straight back to that same absolute path via
 * `file_write_request` (`write-file.ts`); the empty ("+"-menu) tab has nowhere to write and gets
 * no Save button at all (passing `onSave` is what draws it). `e.saved()` is called only after the
 * daemon confirms the write, which is what greys the button out and flips the viewer back to
 * clean — a failed write leaves it live so the user can retry. Note `e.fileName` is molviewer's
 * own load-time basename (`moleculeSource`'s `name`, extension only, no directory), not a usable
 * write target — the absolute `path` prop already in scope is what gets written.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { MolViewer, type MolViewerHandle, type SaveEvent } from "@molviewer/core";
import "@molviewer/core/style.css";
import { Spinner } from "@pi-studio-ui/components/primitives/Spinner.js";
import { StatusBadge } from "@pi-studio-ui/components/primitives/StatusBadge.js";
import { Panel } from "@pi-studio-ui/components/primitives/Panel.js";
import { EmptyState } from "@pi-studio-ui/components/primitives/EmptyState.js";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useFileDownload } from "@pi-studio-ui/hooks/use-file-download.js";
import { useFileWatch } from "@pi-studio-ui/hooks/use-file-watch.js";
import { moleculeSource } from "./molecule-source.js";
import { shouldApplyRefresh } from "./molecule-reload.js";
import { writeFile } from "./write-file.js";
import { MOLVIEWER_THEME } from "./molecule-theme.js";
import styles from "./MoleculeViewer.module.css";

export interface MoleculeViewerProps {
  /** Absolute path of the file to render, or null for an empty ("New molecule view") tab. */
  path: string | null;
  /** True when this viewer's tab is the visible one. Molstar's own `ResizeObserver` on its canvas
   *  container re-fits on becoming visible (verified in the installed bundle), so this is not
   *  currently used to drive a manual re-fit — kept as the escape hatch task-010's visual
   *  verification may still need. */
  isActive?: boolean;
  /** Mirrors `MolViewerProps.onModifiedChange` upward for a future parent-level consumer (e.g. a
   *  tab-strip "unsaved changes" mark) — independent of this component's own internal `modified`
   *  state below, which drives the live-reload gate. */
  onModifiedChange?: (modified: boolean) => void;
}

export function MoleculeViewer({ path, isActive, onModifiedChange }: MoleculeViewerProps) {
  const client = useConnectionStore((s) => s.client);
  const download = useFileDownload(path ?? "", Boolean(path));
  const { changedAt } = useFileWatch(path);
  const handleRef = useRef<MolViewerHandle>(null);
  // First load of this tab's file refits the camera ("replace"); every reload after that (the
  // same file changing on disk, task-007) preserves camera/selection/undo ("update"). A mounted
  // MoleculeViewer corresponds to exactly one tab for its whole lifetime (task-004 mints a new
  // tab id per path), so this never needs to reset for a "new" path mid-lifetime.
  const hasLoadedRef = useRef(false);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [modified, setModified] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Ref, not state: recording "which push we last acted on" doesn't need its own render — it's
  // read by the same effect that writes it, and by the stale-indicator check below.
  const lastAppliedAtRef = useRef<number | null>(null);

  // Memoized, and that is load-bearing. `MolViewer`'s `source` prop is a load TRIGGER keyed on
  // object IDENTITY (`useEffect(…, [source])` in @molviewer/core, documented there as "loaded
  // whenever this value's identity changes"), so a fresh `{ url, name }` literal per render is a
  // reload command: `UPDATE_SYSTEM` re-parses the file and silently reverts every in-viewer edit.
  // Symptom when this is missing: the FIRST atom delete/move after a load or a save undoes itself
  // — the edit flips `modified`, `onModifiedChange` → `setModified` re-renders, and the new
  // identity reloads the molecule out from under the edit. Later edits stuck (no `modified`
  // transition, so no re-render), which is what made it look intermittent. Every unrelated
  // re-render did it too, and `TabPanelHost` re-renders all panels on every layout mutation —
  // a divider drag reloaded the structure once per pointermove frame.
  // Identity must change only when the bytes do: when `refetch()` mints a new object URL.
  const objectUrl = download.data?.objectUrl ?? null;
  const source = useMemo(() => moleculeSource(path, objectUrl), [path, objectUrl]);

  useEffect(() => {
    if (!shouldApplyRefresh({ changedAt, lastAppliedAt: lastAppliedAtRef.current, modified })) {
      return;
    }
    lastAppliedAtRef.current = changedAt;
    void download.refetch();
    // Only `download.refetch` itself needs to be stable across renders for this effect to behave
    // correctly; depending on the whole `download` query object would re-run on every unrelated
    // status change it produces.
  }, [changedAt, modified, download.refetch]);

  // A push arrived but couldn't be applied because of unsaved edits — surface that rather than
  // silently diverging. Reading the ref during render is safe here: it only ever changes inside
  // the effect above, which always runs before the next paint that could observe a stale value.
  const hasUnappliedChange =
    changedAt !== null && changedAt !== lastAppliedAtRef.current && modified;

  async function handleSave(e: SaveEvent) {
    if (!path) return;
    if (!client) {
      setSaveError("Not connected — cannot save.");
      return;
    }
    setSaveError(null);
    try {
      await writeFile(client, path, e.text());
      e.saved();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    }
  }

  const downloadErrorMessage = download.isError
    ? download.error instanceof Error
      ? download.error.message
      : "download failed"
    : null;
  const errorMessage = downloadErrorMessage ?? loadError?.message ?? null;

  if (path && download.isPending) {
    return (
      <Panel>
        <EmptyState>
          <Spinner size="sm" /> Loading...
        </EmptyState>
      </Panel>
    );
  }
  if (errorMessage) {
    return (
      <Panel>
        <EmptyState>Error: {errorMessage}</EmptyState>
      </Panel>
    );
  }

  return (
    <Panel className={styles.wrap} data-molecule-active={isActive ? "true" : "false"}>
      <div className={styles.badges}>
        {hasUnappliedChange && <StatusBadge label="File changed on disk" variant="muted" />}
        {saveError && <StatusBadge label={`Save failed: ${saveError}`} variant="error" />}
      </div>
      <MolViewer
        ref={handleRef}
        className={styles.molViewer}
        theme={MOLVIEWER_THEME}
        source={source}
        sourceMode={hasLoadedRef.current ? "update" : "replace"}
        onLoad={() => {
          hasLoadedRef.current = true;
          setLoadError(null);
        }}
        onLoadError={(e) => setLoadError(e.error)}
        onModifiedChange={(m) => {
          setModified(m);
          onModifiedChange?.(m);
        }}
        onSave={path ? handleSave : undefined}
      />
    </Panel>
  );
}
