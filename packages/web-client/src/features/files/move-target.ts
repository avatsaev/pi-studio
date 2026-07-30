/**
 * Pure drop-legality decision for the explorer's internal drag-and-drop move (task-006's handlers
 * become thin call sites over this). The web-client test setup has no jsdom environment, so any
 * rule reachable only through a DOM drag event is effectively untestable — every legality rule
 * therefore lives here, exhaustively unit-tested, rather than inside a drag event handler.
 */

import { dirOf } from "@pi-studio-ui/lib/paths.js";

export interface MoveTarget {
  /** Directory the drop lands in. */
  destinationDir: string;
  /** Full destination path — `destinationDir` + "/" + basename(sourcePath). */
  destination: string;
}

/**
 * Where a drag of `sourcePath` dropped on `row` would land, or null when the drop is illegal.
 * `rootPath` is the tree root: a drop resolving above it is rejected (the explorer is
 * workspace-scoped).
 */
export function resolveMoveTarget(
  sourcePath: string,
  row: { kind: string; path: string },
  rootPath: string,
): MoveTarget | null {
  if (row.kind !== "file" && row.kind !== "directory") return null;

  const destinationDir = row.kind === "directory" ? row.path : dirOf(row.path);

  if (destinationDir === dirOf(sourcePath)) return null;
  if (destinationDir === sourcePath) return null;
  if (destinationDir.startsWith(`${sourcePath}/`)) return null;
  if (destinationDir !== rootPath && !destinationDir.startsWith(`${rootPath}/`)) return null;

  const basename = sourcePath.split("/").pop();
  return { destinationDir, destination: `${destinationDir}/${basename}` };
}

/**
 * Directory an OS-file drop on `row` uploads into — a directory row is the target itself, a file
 * row's parent is (files aren't drop containers). `loading`/`error`/`draft` rows have no listing
 * to upload into and are rejected, same as an out-of-workspace resolution.
 */
export function resolveUploadTarget(
  row: { kind: string; path: string },
  rootPath: string,
): string | null {
  if (row.kind !== "file" && row.kind !== "directory") return null;
  const dir = row.kind === "directory" ? row.path : dirOf(row.path);
  if (dir !== rootPath && !dir.startsWith(`${rootPath}/`)) return null;
  return dir;
}
