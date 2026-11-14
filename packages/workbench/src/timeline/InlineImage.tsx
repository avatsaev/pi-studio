/**
 * `![alt](src)` renderer for finalized assistant markdown (features/inline-image-rendering.md §
 * Behavior & Algorithms → Render pipeline). Handles remote passthrough, local file fetch via
 * useInlineImage (task-003), classification (task-002), and click-to-open file tab.
 *
 * Props are optional (react-markdown may omit them) and must be handled defensively.
 */

import { memo, useMemo } from "react";
import { classifyImageSrc } from "./image-src.js";
import { selectInlineImageView } from "./inline-image-view.js";
import { resolveFileOpenTarget } from "./file-open-target.js";
import { useInlineImage } from "../hooks/use-inline-image.js";
import { useHomeDir } from "../hooks/use-home-dir.js";
import { openFileTab } from "../features/files/open-file-tab.js";
import { pathDragStartHandler } from "../features/workspace/external-drag.js";
import { Spinner } from "@av-pi-studio/ui-library";
import styles from "./markdown.module.css";

export interface InlineImageProps {
  src?: string;
  alt?: string;
  assetBase: string | null;
  owningPaneId?: string | null;
  workspaceCwd?: string | null;
}

export const InlineImage = memo(function InlineImage({
  src,
  alt,
  assetBase,
  owningPaneId,
  workspaceCwd,
}: InlineImageProps) {
  const homeDir = useHomeDir();

  // Classify the source once at render time.
  const classification = useMemo(
    () => classifyImageSrc(src || "", assetBase, homeDir),
    [src, assetBase, homeDir],
  );

  // For local images, fetch and track state.
  const imageState = useInlineImage(classification.kind === "local" ? classification.path : null);

  // Decide what to render.
  const view = selectInlineImageView(classification, imageState, src, alt);

  // Remote images: pass through unchanged (what react-markdown's default would do).
  if (view.kind === "remote") {
    return <img src={view.src} alt={view.alt} className={styles.inlineImage} />;
  }

  // Unresolvable or error: render text fallback in inline monospace.
  if (view.kind === "unresolvable" || view.kind === "error") {
    return <code className={styles.inlineImageFallback}>{view.fallbackText}</code>;
  }

  // Loading or idle: skeleton.
  if (view.kind === "loading") {
    return (
      <div className={styles.inlineImageSkeleton}>
        <Spinner size="sm" />
      </div>
    );
  }

  // Ready: render the fetched image with click-to-open handler, converged onto the same
  // `openFileTab` dispatch the Files tree and `FileLink` use — puts the pane-targeting fix
  // (owning tab's real `workspaceCwd`, `owningPaneId`) in exactly one place for both features.
  const target = resolveFileOpenTarget(assetBase, owningPaneId ?? null, workspaceCwd ?? null);
  const handleClick = () => {
    openFileTab(view.path, target.workspaceCwd, target.targetPaneId);
  };

  return (
    <img
      src={view.objectUrl}
      alt={view.alt}
      className={styles.inlineImage}
      title={view.path}
      draggable
      onDragStart={pathDragStartHandler(view.path)}
      onClick={handleClick}
      style={{ cursor: "pointer" }}
    />
  );
});
