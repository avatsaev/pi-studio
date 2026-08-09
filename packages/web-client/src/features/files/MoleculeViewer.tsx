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
 * Save (`onSave`, `@molviewer/core` 0.4.3+): only wired when `path` is non-null — a file-backed
 * tab writes the viewer's current serialization straight back to that same absolute path via
 * `file_write_request` (`write-file.ts`); the empty ("+"-menu) tab has nowhere to write and gets
 * no Save button at all (passing `onSave` is what draws it). `e.saved()` is called only after the
 * daemon confirms the write, which is what greys the button out and flips the viewer back to
 * clean — a failed write leaves it live so the user can retry. Note `e.fileName` is molviewer's
 * own load-time basename (`moleculeSource`'s `name`, extension only, no directory), not a usable
 * write target — the absolute `path` prop already in scope is what gets written.
 *
 * Polymer build (`onPolymerBuild`, `@molviewer/core` 0.4.4+): file-backed tabs only, like `onSave`
 * — but omitting it does NOT hide the Build button the way omitting `onSave` hides Save. With no
 * handler molviewer downloads the .mol2 itself, which is the right answer for a `path`-null
 * ("+"-menu) tab: there is no directory to write beside.
 *
 * Building deliberately does not change what is on screen — the monomer stays loaded and the
 * polymer is a NEW structure — so this writes it beside the monomer and opens it in its own
 * molecule tab, in the SAME pane this viewer lives in. See `writePolymer` below for the naming
 * and rollback contract.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  MolViewer,
  type MolViewerHandle,
  type PolymerBuildEvent,
  type SaveEvent,
} from "@molviewer/core";
import "@molviewer/core/style.css";
import type { PiStudioClient } from "@av-pi-studio/client";
import { Spinner } from "@pi-studio-ui/components/primitives/Spinner.js";
import { StatusBadge } from "@pi-studio-ui/components/primitives/StatusBadge.js";
import { Panel } from "@pi-studio-ui/components/primitives/Panel.js";
import { EmptyState } from "@pi-studio-ui/components/primitives/EmptyState.js";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useLayoutStore } from "@pi-studio-ui/stores/layout-store.js";
import { dirOf } from "@pi-studio-ui/lib/paths.js";
import { useFileDownload } from "@pi-studio-ui/hooks/use-file-download.js";
import { useFileWatch } from "@pi-studio-ui/hooks/use-file-watch.js";
import { useFileTransfer } from "@pi-studio-ui/hooks/use-file-transfer.js";
import { moleculeSource } from "./molecule-source.js";
import { shouldApplyRefresh } from "./molecule-reload.js";
import { writeFile } from "./write-file.js";
import { createEntry, CreateEntryError } from "./create-entry.js";
import { deleteEntry } from "./delete-entry.js";
import { openMoleculeTab } from "./open-file-tab.js";
import { polymerFileName } from "./polymer-file.js";
import { MOLVIEWER_THEME } from "./molecule-theme.js";
import styles from "./MoleculeViewer.module.css";

/** How many `<stem>_polymer_<n>[_k].mol2` candidates to claim before giving up on a free name. A
 *  ceiling only: every attempt past the first means that many builds already landed in this folder
 *  with these settings, and 50 of them is a user problem rather than a naming one. */
const MAX_POLYMER_NAME_ATTEMPTS = 50;

export interface MoleculeViewerProps {
  /** Absolute path of the file to render, or null for an empty ("New molecule view") tab. */
  path: string | null;
  /** Workspace this viewer's tab belongs to — needed to open the polymer's tab in the same
   *  workspace. Same normalized cwd the tab was minted with, never re-derived from the active
   *  session. */
  workspaceCwd: string;
  /** This viewer's own tab id, used to resolve which pane a built polymer's tab should join.
   *  Without it the polymer would land in the FOCUSED pane, which is not necessarily the one the
   *  monomer is being viewed in. */
  tabId: string;
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

/**
 * Claim a free name next to `sourcePath` and fill it with `text`; returns the path written.
 *
 * The name is claimed with `file_create_request` rather than chosen from a directory listing:
 * that RPC opens `wx` (create-exclusive), so the filesystem itself arbitrates the collision and a
 * stale listing can never cause an overwrite. Each `exists` just advances to the next candidate.
 *
 * Content then goes through the binary upload stream, not `file_write_request`, because the latter
 * caps at `MAX_INLINE_FILE_READ_BYTES` (5 MiB) — reachable for a long chain of a large monomer,
 * and a build silently failing at some atom count is not a behaviour worth shipping. The upload
 * opens the target `"w"`, so it fills the empty file the claim just created.
 *
 * A failed upload rolls the claim back: without it every failure would litter the folder with a
 * 0-byte .mol2 that also burns its candidate name for good. The rollback is best-effort — the
 * upload error is what the user needs to see, and a delete that also fails must not mask it.
 */
async function writePolymer(args: {
  client: PiStudioClient;
  upload: (dir: string, file: File) => Promise<void>;
  sourcePath: string;
  monomers: number;
  text: string;
}): Promise<string> {
  const { client, upload, sourcePath, monomers, text } = args;
  const dir = dirOf(sourcePath);

  let claimed: string | null = null;
  let name = "";
  for (let attempt = 0; attempt < MAX_POLYMER_NAME_ATTEMPTS && claimed === null; attempt += 1) {
    name = polymerFileName({ sourcePath, monomers, attempt });
    try {
      claimed = await createEntry(client, dir, name, "file");
    } catch (err) {
      if (err instanceof CreateEntryError && err.code === "exists") continue;
      throw err;
    }
  }
  if (claimed === null)
    throw new Error(`No free name for ${name} — too many builds in this folder.`);

  try {
    await upload(dir, new File([text], name, { type: "chemical/x-mol2" }));
  } catch (err) {
    await deleteEntry(client, claimed).catch(() => {});
    throw err;
  }
  return claimed;
}

export function MoleculeViewer({
  path,
  workspaceCwd,
  tabId,
  isActive,
  onModifiedChange,
}: MoleculeViewerProps) {
  const client = useConnectionStore((s) => s.client);
  const { upload } = useFileTransfer();
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
  const [buildError, setBuildError] = useState<string | null>(null);
  const [buildWarning, setBuildWarning] = useState<string | null>(null);
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

  /**
   * A polymer was built. Nothing on screen changes — the monomer stays loaded — so the whole job
   * here is getting the new structure onto disk beside it and into its own tab.
   *
   * `e.text()` is a thunk and is called exactly once, up front: serialising a long chain costs
   * real time, and calling it after the name is claimed would leave an empty file behind if
   * serialisation threw.
   *
   * The new tab joins THIS viewer's pane (`paneOfTab`) rather than the focused one, so a build
   * started in a background pane doesn't fling its result across the workspace. `openMoleculeTab`
   * treats an unknown pane id as "not supplied" and falls back to the focused pane, so a null from
   * `paneOfTab` needs no special case.
   */
  async function handlePolymerBuild(e: PolymerBuildEvent) {
    if (!path) return;
    if (!client) {
      setBuildError("Not connected — cannot save the polymer.");
      return;
    }
    setBuildError(null);
    setBuildWarning(null);
    try {
      const created = await writePolymer({
        client,
        upload,
        sourcePath: path,
        monomers: e.monomers,
        text: e.text(),
      });
      // Rigid placement is never minimised, so overlapping atoms are a real result the user has to
      // know about before feeding this into anything. Surfaced after the write, not instead of it:
      // the file is still valid and still theirs.
      if (e.report.clashes > 0) {
        setBuildWarning(
          `${e.report.clashes} close contacts — relax the geometry before simulating`,
        );
      }
      const pane = useLayoutStore.getState().paneOfTab(workspaceCwd, tabId);
      openMoleculeTab(created, workspaceCwd, pane ?? undefined);
    } catch (err) {
      setBuildError(err instanceof Error ? err.message : "Failed to save the polymer");
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
        {buildError && <StatusBadge label={`Polymer build: ${buildError}`} variant="error" />}
        {buildWarning && <StatusBadge label={buildWarning} variant="warning" />}
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
        onPolymerBuild={path ? handlePolymerBuild : undefined}
      />
    </Panel>
  );
}
