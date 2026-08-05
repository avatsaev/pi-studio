/**
 * `[label](href)` renderer for finalized assistant markdown (features/file-link-rendering.md §
 * Render pipeline, § Click-to-open pane targeting, § Drag-to-split). `classifyFileLinkSrc`'s
 * `external` result renders an ordinary, unmodified anchor — never intercepted, so in-page anchors
 * and real links keep working exactly as the browser's default. A `local` result renders an
 * actionable, draggable anchor: click prevents navigation and dispatches through the same
 * `openFileTab` primitive the Files tree and its context menu already use, targeted at the owning
 * chat tab's pane — the converged click-to-open dispatch `InlineImage` also uses
 * (features/inline-image-rendering.md § Click-to-open, amended); drag carries the identical
 * `EXTERNAL_DRAG_MIME.path` payload a Files-tree row drag carries, so dropping it onto a pane's
 * edge splits and opens it there, with zero drop-side changes needed.
 */

import type { ReactNode } from "react";
import { classifyFileLinkSrc } from "./file-link-src.js";
import { resolveFileOpenTarget } from "./file-open-target.js";
import { useHomeDir } from "@pi-studio-ui/hooks/use-home-dir.js";
import { openFileTab } from "@pi-studio-ui/features/files/open-file-tab.js";
import { pathDragStartHandler } from "@pi-studio-ui/features/workspace/external-drag.js";

export interface FileLinkProps {
  href?: string;
  children?: ReactNode;
  assetBase: string | null;
  owningPaneId: string | null;
  workspaceCwd: string | null;
}

export function FileLink({ href, children, assetBase, owningPaneId, workspaceCwd }: FileLinkProps) {
  const homeDir = useHomeDir();
  const classification = classifyFileLinkSrc(href ?? "", assetBase, homeDir);

  if (classification.kind === "external") {
    return <a href={href}>{children}</a>;
  }

  const path = classification.path;
  const target = resolveFileOpenTarget(assetBase, owningPaneId, workspaceCwd);
  return (
    <a
      href={href}
      draggable
      onDragStart={pathDragStartHandler(path)}
      onClick={(event) => {
        event.preventDefault();
        openFileTab(path, target.workspaceCwd, target.targetPaneId);
      }}
    >
      {children}
    </a>
  );
}
