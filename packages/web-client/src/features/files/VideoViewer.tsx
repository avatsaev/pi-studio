/**
 * VideoViewer — renders a binary video file via the file-transfer binary download
 * (`useFileDownload`) into a native `<video>` element (POC_TO_APP_PLAN_UI.md §4.5 follow-up:
 * modular file preview).
 */

import { Spinner } from "@pi-studio-ui/components/primitives/Spinner.js";
import { EmptyState } from "@pi-studio-ui/components/primitives/EmptyState.js";
import { useFileDownload } from "@pi-studio-ui/hooks/use-file-download.js";
import type { ViewerProps } from "./viewer-registry.js";
import styles from "./VideoViewer.module.css";

export function VideoViewer({ path }: ViewerProps) {
  const query = useFileDownload(path);

  if (query.isLoading) {
    return (
      <EmptyState>
        <Spinner size="sm" /> Loading video...
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
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- arbitrary local file, no caption track available */}
      <video className={styles.video} src={query.data.objectUrl} controls />
    </div>
  );
}
