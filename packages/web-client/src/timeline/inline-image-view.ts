/**
 * Pure, testable logic for rendering inline images — extracted from the component
 * so tests can verify branch logic without JSX rendering (mirror of molecule-reload.ts,
 * text-viewer-state.ts; see AGENTS.md testing conventions).
 *
 * Returns a discriminated union describing what to render: the component switches
 * on it to decide remote passthrough, skeleton, ready image, or text fallback.
 */

import type { ImageSrcClassification } from "./image-src.js";
import type { InlineImageState } from "@pi-studio-ui/hooks/use-inline-image.js";

export type InlineImageView =
  | { kind: "remote"; src: string; alt?: string }
  | { kind: "unresolvable"; fallbackText: string }
  | { kind: "loading" }
  | { kind: "ready"; objectUrl: string; alt?: string; path: string }
  | { kind: "error"; fallbackText: string };

/**
 * Decides what to render for an inline image given its classification and loading state.
 * Pure: no hooks, no store access — all state passed in as arguments.
 */
export function selectInlineImageView(
  classification: ImageSrcClassification,
  imageState: InlineImageState,
  src: string | undefined,
  alt: string | undefined,
): InlineImageView {
  if (classification.kind === "remote") {
    return { kind: "remote", src: src || "", alt };
  }

  if (classification.kind === "unresolvable") {
    const fallbackText = alt || src || "(image)";
    return { kind: "unresolvable", fallbackText };
  }

  // classification.kind === "local"
  if (imageState.status === "loading" || imageState.status === "idle") {
    return { kind: "loading" };
  }

  if (imageState.status === "ready") {
    return { kind: "ready", objectUrl: imageState.objectUrl, alt, path: classification.path };
  }

  // imageState.status === "error"
  const fallbackText = alt || classification.path || "(image)";
  return { kind: "error", fallbackText };
}
