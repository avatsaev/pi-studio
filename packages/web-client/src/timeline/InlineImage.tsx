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
import { useInlineImage } from "@pi-studio-ui/hooks/use-inline-image.js";
import { useHomeDir } from "@pi-studio-ui/hooks/use-home-dir.js";
import { useTabStore, tabIds } from "@pi-studio-ui/stores/tab-store.js";
import { Spinner } from "@pi-studio-ui/components/primitives/Spinner.js";
import styles from "./markdown.module.css";

export interface InlineImageProps {
  src?: string;
  alt?: string;
  assetBase: string | null;
}

export const InlineImage = memo(function InlineImage({ src, alt, assetBase }: InlineImageProps) {
  const homeDir = useHomeDir();
  const openTab = useTabStore((s) => s.open);

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

  // Ready: render the fetched image with click-to-open handler.
  const handleClick = () => {
    openTab({
      id: tabIds.file(view.path),
      kind: "file",
      label: view.path.split("/").pop() || view.path,
      closable: true,
      data: { path: view.path },
      workspaceCwd: assetBase || "~",
    });
  };

  return (
    <img
      src={view.objectUrl}
      alt={view.alt}
      className={styles.inlineImage}
      title={view.path}
      onClick={handleClick}
      style={{ cursor: "pointer" }}
    />
  );
});
