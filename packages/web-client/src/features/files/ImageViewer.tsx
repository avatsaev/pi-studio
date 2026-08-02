/**
 * ImageViewer — renders a binary image file by downloading it over the file-transfer binary
 * frames (`useFileDownload`) and displaying the resulting object URL (POC_TO_APP_PLAN_UI.md §4.5
 * follow-up: modular file preview). A checkerboard background shows through transparent PNGs.
 */

import { Spinner } from "@pi-studio-ui/components/primitives/Spinner.js";
import { EmptyState } from "@pi-studio-ui/components/primitives/EmptyState.js";
import { useFileDownload } from "@pi-studio-ui/hooks/use-file-download.js";
import type { ViewerProps } from "./viewer-registry.js";
import styles from "./ImageViewer.module.css";

export function ImageViewer({ path }: ViewerProps) {
  const query = useFileDownload(path);

  if (query.isLoading) {
    return (
      <EmptyState>
        <Spinner size="sm" /> Loading image...
      </EmptyState>
    );
  }
  if (query.isError) {
    return (
      <EmptyState>
        Error: {query.error instanceof Error ? query.error.message : "unknown error"}
      </EmptyState>
    );
  }
  if (!query.data) return null;

  return (
    <div className={styles.wrap}>
      <img
        className={styles.image}
        src={query.data.objectUrl}
        alt={path.split("/").pop() || path}
      />
    </div>
  );
}
