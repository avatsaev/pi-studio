/**
 * Pure derivation of molviewer's `{ url, name }` source shape, kept in its own module (no
 * `@molviewer/core` import) so it is unit-testable without pulling in the WebGL viewer bundle —
 * merely importing `@molviewer/core` touches `document` at module scope, which jsdom-less/node
 * test environments don't have.
 */
import type { MolViewerSource } from "@molviewer/core";

/** `name` is load-bearing: molviewer resolves the file format from its extension. */
export function moleculeSource(
  path: string | null,
  objectUrl: string | null | undefined,
): MolViewerSource | null {
  if (!path || !objectUrl) return null;
  return { url: objectUrl, name: path.split("/").pop() || path };
}
