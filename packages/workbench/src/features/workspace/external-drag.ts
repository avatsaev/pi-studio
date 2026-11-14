/**
 * The sidebar-to-pane half of drag-to-split: dragging a chat out of the session list, or a file out
 * of the Files tree, onto a pane body — opening it there, splitting the pane when dropped on an edge.
 *
 * **Why this is native HTML5 drag-and-drop and not dnd-kit** (`use-pane-drag.ts`, which carries drags
 * that *start* on a tab already in a strip): the Files tree's rows are already native draggables for
 * row-to-row move, and its container is a native drop target for OS files — whose payload
 * (`dataTransfer.files`) exists ONLY in native DnD, so the tree must keep native DnD no matter what.
 * Arming dnd-kit on the same rows would start two drag systems on one gesture. Native costs neither
 * that nor hoisting `DndContext` above the sidebars, and the two systems cannot collide: a native
 * `dragstart` suppresses the pointer events dnd-kit's `PointerSensor` activates on.
 *
 * The transport reuses the discrimination pattern the tree already documents: mid-drag a browser in
 * protected mode exposes `dataTransfer.types` but NOT the values, so the *type name* carries the
 * drag's kind and the payload is only readable at `drop`. One MIME per kind, so `types` alone tells a
 * pane whether to preview — before it can know *what* is being dragged.
 *
 * A file row carries its move MIME **and** its open MIME at once: one gesture, and *where* it lands
 * decides the meaning — another row is a move, a pane body is an open.
 *
 * swe/features/workspace-split-panes.md § Drop regions, § Splitting
 */

import {
  effectiveDropRegion,
  resolveDropRegion,
  type DropBounds,
  type DropPoint,
  type DropRegion,
} from "./pane-dnd.js";
import type { PaneNode } from "./pane-tree.js";

/** What an external drag carries: a session id (`chat`) or a file's absolute path (`path`). */
export type ExternalDragKind = "chat" | "path";

/**
 * One MIME per kind, because `types` is all a drop target can read mid-drag.
 *
 * The Files tree's row-move MIME (`application/x-pi-studio-path`) is deliberately NOT reused: a move
 * and an open are different outcomes and a row carries both, so they need distinguishable names.
 */
export const EXTERNAL_DRAG_MIME: Readonly<Record<ExternalDragKind, string>> = {
  chat: "application/x-pi-studio-open-chat",
  path: "application/x-pi-studio-open-path",
};

const KINDS: readonly ExternalDragKind[] = ["chat", "path"];

/**
 * Which of our drags a `DataTransfer` carries, from `types` alone — `null` for anything else (an OS
 * file drag, a text selection, another app's payload), none of which a pane accepts. We never emit a
 * transfer carrying two kinds; the fixed `KINDS` order makes it deterministic anyway.
 */
export function externalDragKind(types: readonly string[]): ExternalDragKind | null {
  for (const kind of KINDS) {
    if (types.includes(EXTERNAL_DRAG_MIME[kind])) return kind;
  }
  return null;
}

/**
 * Drag-start handler for a file-path drag source (a `FileLink`/resolved `InlineImage` in the chat
 * timeline; mirrors the Files tree's own inline `dataTransfer.setData(EXTERNAL_DRAG_MIME.path, …)`
 * in `FileExplorer.tsx`'s `handleDragStartRow`) — writes the identical `path`-kind payload so a drop
 * on a pane needs no new drop-side handling. Returned as a closure so the caller supplies `path`
 * once and the result is a plain `onDragStart` prop; the closure itself has no state, so it is
 * exercised directly in tests with a minimal fake `DataTransfer` rather than a rendered drag.
 */
export function pathDragStartHandler(
  path: string,
): (event: { dataTransfer: Pick<DataTransfer, "setData" | "effectAllowed"> }) => void {
  return (event) => {
    event.dataTransfer.setData(EXTERNAL_DRAG_MIME.path, path);
    event.dataTransfer.effectAllowed = "copyMove";
  };
}

export interface ExternalDragPayload {
  kind: ExternalDragKind;
  /** A chat's session id, or a file's absolute path. */
  value: string;
}

/**
 * Decode the payload at drop time. `read` is `dataTransfer.getData` — injected so this is unit-tested
 * without a `DataTransfer`, and because that method answers `""` for a missing type rather than
 * throwing. A blank value counts as no payload: a drag we recognise but cannot act on.
 */
export function readExternalDrag(
  types: readonly string[],
  read: (mime: string) => string,
): ExternalDragPayload | null {
  const kind = externalDragKind(types);
  if (kind === null) return null;
  const value = read(EXTERNAL_DRAG_MIME[kind]).trim();
  return value === "" ? null : { kind, value };
}

/**
 * The composer-only path-ref drag (swe/features/composer-path-drop.md § Public contract 1): every
 * Files-tree row, file **or folder**, carries its absolute path under this MIME so the composer can
 * insert a relative path. A directory's value carries a trailing `/`, the only directory signal that
 * survives `getData` (the `types` list is the sole mid-drag signal).
 *
 * Deliberately NOT an `ExternalDragKind`: a folder row carries only `MOVE_MIME` plus this, and a
 * pane host gating on `externalDragKind(...) !== null` would start previewing a split for a folder
 * drop — exactly what a pane must never do, since there is no directory tab. Keeping it out of
 * `KINDS`/`readExternalDrag` leaves those as the pane-host vocabulary.
 */
export const PATH_REF_MIME = "application/x-pi-studio-path-ref";

/** Whether a drag's `types` advertises a path-ref payload. */
export function hasPathRef(types: readonly string[]): boolean {
  return types.includes(PATH_REF_MIME);
}

/** The path-ref value for a row: a directory gets exactly one trailing `/`. */
export function encodePathRef(absPath: string, isDirectory: boolean): string {
  const bare = absPath.replace(/\/+$/, "");
  return isDirectory ? `${bare}/` : absPath;
}

/**
 * Decode the path-ref at drop time (`read` is `dataTransfer.getData`). Trimmed; blank or absent is
 * `null`, a drag we recognise but cannot act on.
 */
export function readPathRef(
  types: readonly string[],
  read: (mime: string) => string,
): string | null {
  if (!hasPathRef(types)) return null;
  const value = read(PATH_REF_MIME).trim();
  return value === "" ? null : value;
}

/**
 * Marks the composer card as a path-ref drop zone, and spreads onto it. Written down exactly once,
 * here, beside `isInComposerDrop` which reads it back: the zone and the pane host's lookup live in
 * different files, and a rename that hit only one of them would silently stop the host yielding.
 */
const COMPOSER_DROP_ATTR = "data-composer-drop";

export function composerDropProps(): Record<string, string> {
  return { [COMPOSER_DROP_ATTR]: "" };
}

/** Whether a drag event's target sits inside a marked composer drop zone. */
export function isInComposerDrop(target: EventTarget | null): boolean {
  return (target as Element | null)?.closest?.(`[${COMPOSER_DROP_ATTR}]`) != null;
}

/**
 * Whether the pane host must treat the pointer as over **no pane**: a path-ref drag over a composer
 * drop zone belongs to the composer alone, whether or not the composer accepts it (it refuses while
 * compacting), so the release can never fall through to an open or split. A drag without a path-ref
 * (a chat row, a timeline file link) is unaffected and stays a pane drop even over the composer.
 */
export function yieldsToComposer(types: readonly string[], targetInsideComposer: boolean): boolean {
  return targetInsideComposer && hasPathRef(types);
}

/**
 * The region a drop at `pointer` would actually apply — already degraded by `effectiveDropRegion`, so
 * the preview and the drop read one value and cannot disagree. Same contract `use-pane-drag` holds
 * for internal drags, and the reason both go through `pane-dnd` rather than checking `canSplit` again.
 */
export function resolveExternalDropRegion(
  tree: PaneNode,
  paneId: string,
  pointer: DropPoint,
  bounds: DropBounds,
): DropRegion {
  return effectiveDropRegion(tree, paneId, resolveDropRegion(pointer, bounds));
}
