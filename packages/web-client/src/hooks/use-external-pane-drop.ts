/**
 * The pane's side of a sidebar-to-pane drag: preview while an external drag is over a pane body, and
 * the open-or-move dispatch on release. `use-pane-drag.ts` is the dnd-kit counterpart for drags that
 * start on a tab already in a strip; `features/workspace/external-drag.ts` documents why this half is
 * native HTML5 DnD instead.
 *
 * The dispatch has two shapes, and what separates them is whether the dragged thing already has a tab:
 *
 * ||centre drop|edge drop|
 * |---|---|---|
 * |already open|`moveTab`|`splitWithTab`|
 * |not open yet|`open(tab, pane)`|`splitEmpty` then `open(tab, newPane)`|
 *
 * The already-open row deliberately routes through the *same* store calls an internal tab drag makes,
 * rather than re-`open`ing the tab: `tab-store.open` short-circuits to `activate` for an id that
 * already exists (ignoring `targetPaneId`), and the internal path is also where the no-op guards live
 * — dragging a chat from the sidebar onto the pane its tab already occupies must do nothing, exactly
 * as dragging its tab there does.
 *
 * `activeTabId` needs no manual resync here: it is a projection, and `tab-store`'s subscription on the
 * layout store follows every layout mutation, including these.
 *
 * This hook also owns the app-wide iframe drag guard (`lib/drag-guard.ts`), mounted here because it
 * is where a native drag's document-level lifecycle is already understood — it applies to the
 * dnd-kit half too, which arms it from its own callbacks.
 *
 * swe/features/workspace-split-panes.md § Drop regions, § Splitting
 */

import { useCallback, useEffect, useState, type DragEvent, type RefObject } from "react";
import {
  externalDragKind,
  readExternalDrag,
  resolveExternalDropRegion,
  type ExternalDragPayload,
} from "@pi-studio-ui/features/workspace/external-drag.js";
import {
  containsPoint,
  isNoOpDrop,
  type DropBounds,
  type DropOutcome,
  type DropPoint,
  type DropRegion,
} from "@pi-studio-ui/features/workspace/pane-dnd.js";
import { openFileTab } from "@pi-studio-ui/features/files/open-file-tab.js";
import { openChatTab } from "@pi-studio-ui/features/sessions/open-chat-tab.js";
import { armDragGuard, disarmDragGuard } from "@pi-studio-ui/lib/drag-guard.js";
import { useLayoutStore } from "@pi-studio-ui/stores/layout-store.js";
import { useSessionStore } from "@pi-studio-ui/stores/session-store.js";
import { useTabStore, tabIds } from "@pi-studio-ui/stores/tab-store.js";
import { useHomeDir } from "./use-home-dir.js";
/**
 * Marks a pane's body drop zone for the pointer lookup below, and spreads onto it. An attribute
 * rather than a ref map because the zones are already rendered from one list; nothing else needs to
 * address them.
 *
 * The name is written down exactly once, here: the zone that carries it and the selector that reads it
 * back live in different files, and a rename that hit only one of them would stop every sidebar drag
 * with nothing failing — these hooks are driven directly in tests, never rendered.
 */
const PANE_DROP_ATTR = "data-pane-drop";

export function paneDropProps(paneId: string): Record<string, string> {
  return { [PANE_DROP_ATTR]: paneId };
}

export interface ExternalPaneDrop {
  /** The outcome a release right now would produce, or `null` when no external drag is over a pane. */
  preview: DropOutcome | null;
  onDragOver(event: DragEvent<HTMLElement>): void;
  onDragLeave(event: DragEvent<HTMLElement>): void;
  onDrop(event: DragEvent<HTMLElement>): void;
}

/**
 * The pane whose body contains the pointer, with that body's client bounds.
 *
 * Measured, not computed: a pane body's box is `paneStyle`'s percentage rect minus the strip, whose
 * height is the CSS variable `--pane-strip-height` — so the DOM is the only place the two are already
 * combined, and reproducing that arithmetic here would be a second geometry that could disagree.
 *
 * The zones are `pointer-events: none` (they must not swallow clicks into the panel beneath), which is
 * also why the handlers sit on the host and hit-test rather than being per-zone listeners.
 */
function paneUnderPointer(
  host: HTMLElement | null,
  pointer: DropPoint,
): { paneId: string; bounds: DropBounds } | null {
  if (host === null) return null;
  for (const zone of host.querySelectorAll<HTMLElement>(`[${PANE_DROP_ATTR}]`)) {
    const rect = zone.getBoundingClientRect();
    const bounds = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    const paneId = zone.getAttribute(PANE_DROP_ATTR);
    if (paneId !== null && paneId !== "" && containsPoint(bounds, pointer))
      return { paneId, bounds };
  }
  return null;
}

/**
 * The tab this payload would reuse, or `null` when nothing is open for it yet. A path can be open as
 * either kind — `isMoleculeFile` decides for a fresh open, but a file already forced into MolViewer
 * through the context menu must be found too, so both ids are checked.
 */
function existingTabId(payload: ExternalDragPayload): string | null {
  const { tabs } = useTabStore.getState();
  const open = (id: string): string | null => (tabs.some((t) => t.id === id) ? id : null);
  if (payload.kind === "chat") return open(tabIds.chat(payload.value));
  return open(tabIds.file(payload.value)) ?? open(tabIds.molecule(payload.value));
}

/**
 * Apply a resolved external drop. Exported for direct unit testing — this project's vitest config runs
 * `.test.ts` under a plain Node environment with no DOM, so the hook is verified by smoke test while
 * this, which is all of the behaviour, is driven directly.
 */
export function applyExternalDrop(
  payload: ExternalDragPayload,
  cwd: string,
  paneId: string,
  region: DropRegion,
  homeDir: string | null,
): void {
  const layout = useLayoutStore.getState().layouts[cwd];
  if (layout === undefined) return;

  const order = useTabStore
    .getState()
    .tabs.filter((t) => t.workspaceCwd === cwd)
    .map((t) => t.id);
  const existing = existingTabId(payload);

  if (existing !== null) {
    if (isNoOpDrop(region, paneId, existing, layout.placement)) return;
    const { moveTab, splitWithTab } = useLayoutStore.getState();
    if (region === "center") moveTab(cwd, existing, paneId, order);
    else splitWithTab(cwd, existing, paneId, region, order);
    return;
  }

  // A fresh tab: make the pane first when an edge was chosen, so the tab opens straight into its
  // final home rather than landing in the focused pane and being moved a beat later.
  let target: string | null = paneId;
  if (region !== "center") target = useLayoutStore.getState().splitEmpty(cwd, paneId, region);
  if (target === null) return; // the split was refused (depth cap) — nothing to open into

  if (payload.kind === "path") {
    openFileTab(payload.value, cwd, target);
    return;
  }
  const session = useSessionStore.getState().sessions[payload.value];
  if (session !== undefined) openChatTab(session, homeDir, target);
}

export function useExternalPaneDrop(
  cwd: string | null,
  hostRef: RefObject<HTMLElement | null>,
): ExternalPaneDrop {
  const [preview, setPreview] = useState<DropOutcome | null>(null);
  const homeDir = useHomeDir();

  // Armed from `document`, not from the handlers below: by the time a native drag reaches this
  // host's `dragover` it is already too late — a drag that enters a preview iframe first never
  // reaches the host at all, because the iframe's own document consumes the event. `dragstart`
  // bubbles from every draggable in the app (Files rows, session rows, timeline file links), so one
  // listener pair arms the guard for all of them without touching a single drag source.
  // `dragend` always fires on the source when the gesture finishes, cancelled or not; `drop` is
  // belt-and-braces for the same gesture, which is why disarming is idempotent.
  useEffect(() => {
    const arm = (): void => armDragGuard();
    const disarm = (): void => disarmDragGuard();
    document.addEventListener("dragstart", arm);
    document.addEventListener("dragend", disarm);
    document.addEventListener("drop", disarm);
    return () => {
      document.removeEventListener("dragstart", arm);
      document.removeEventListener("dragend", disarm);
      document.removeEventListener("drop", disarm);
      disarmDragGuard();
    };
  }, []);

  /** The pane and already-degraded region under this pointer, or `null` when a drop would do nothing. */
  const outcomeAt = useCallback(
    (event: DragEvent<HTMLElement>): DropOutcome | null => {
      if (cwd === null) return null;
      const layout = useLayoutStore.getState().layouts[cwd];
      if (layout === undefined) return null;
      const pointer = { x: event.clientX, y: event.clientY };
      const hit = paneUnderPointer(hostRef.current, pointer);
      if (hit === null) return null;
      return {
        paneId: hit.paneId,
        region: resolveExternalDropRegion(layout.tree, hit.paneId, pointer, hit.bounds),
      };
    },
    [cwd, hostRef],
  );

  const onDragOver = useCallback(
    (event: DragEvent<HTMLElement>) => {
      // Not one of ours: stay inert so the drag keeps whatever meaning it already had — and note that
      // without a `preventDefault` here the browser never fires `drop` on this element at all.
      if (externalDragKind(event.dataTransfer.types) === null) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      const next = outcomeAt(event);
      // Runs per pointer frame, so only ever set a real change.
      setPreview((current) =>
        current?.paneId === next?.paneId && current?.region === next?.region ? current : next,
      );
    },
    [outcomeAt],
  );

  const onDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    // `dragleave` mirrors `mouseout`, not `mouseleave`: it bubbles and refires on every child-element
    // boundary crossing inside the host — moving between two panes, or between elements inside one
    // panel — so clearing on each would kill the preview a tick after `dragover` set it. Only a leave
    // whose next element is outside the host is the drag actually leaving (same guard as the Files
    // tree's container).
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setPreview(null);
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      const payload = readExternalDrag(event.dataTransfer.types, (mime) =>
        event.dataTransfer.getData(mime),
      );
      if (payload === null) return;
      event.preventDefault();
      setPreview(null);
      const outcome = outcomeAt(event);
      if (outcome === null || cwd === null) return;
      applyExternalDrop(payload, cwd, outcome.paneId, outcome.region, homeDir);
    },
    [cwd, homeDir, outcomeAt],
  );

  return { preview, onDragOver, onDragLeave, onDrop };
}
