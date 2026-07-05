// Pure web drag/drop split helpers.
// clean-room-scope/features/workspace-ui.md § Split container (web only)

import type { SplitSide } from "./layout.js";

export type PlatformKind = "web" | "desktop" | "ios" | "android";

export function supportsPaneSplits(platform: PlatformKind, isCompact: boolean): boolean {
  return platform === "web" && !isCompact;
}

export type DropRect = { x: number; y: number; width: number; height: number };
export type DropPoint = { x: number; y: number };
export type DropPosition =
  | { kind: "split"; side: SplitSide }
  | { kind: "reorder"; index: number }
  | { kind: "move" };

export function resolvePaneDropPosition(rect: DropRect, point: DropPoint, tabCount: number): DropPosition {
  const localX = point.x - rect.x;
  const localY = point.y - rect.y;
  const edgeX = rect.width * 0.22;
  const edgeY = rect.height * 0.22;
  if (localX <= edgeX) return { kind: "split", side: "left" };
  if (localX >= rect.width - edgeX) return { kind: "split", side: "right" };
  if (localY <= edgeY) return { kind: "split", side: "top" };
  if (localY >= rect.height - edgeY) return { kind: "split", side: "bottom" };
  if (tabCount > 0) return { kind: "reorder", index: Math.max(0, Math.min(tabCount, Math.floor((localX / rect.width) * (tabCount + 1)))) };
  return { kind: "move" };
}

export type DragPreview = { paneId: string; position: DropPosition; overlayLabel: string };

export function dragPreview(paneId: string, position: DropPosition, label: string): DragPreview {
  return { paneId, position, overlayLabel: label };
}
