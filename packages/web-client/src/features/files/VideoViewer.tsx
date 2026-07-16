/**
 * VideoViewer — renders a binary video file via the file-transfer binary download
 * (`useFileDownload`) into a native `<video>` element (POC_TO_APP_PLAN_UI.md §4.5 follow-up:
 * modular file preview).
 */

import { Spinner } from "../../components/primitives/Spinner.js";
import { useFileDownload } from "../../hooks/use-file-download.js";
import type { ViewerProps } from "./viewer-registry.js";
import panelStyles from "./FilePanel.module.css";
import styles from "./VideoViewer.module.css";

export function VideoViewer({ path }: ViewerProps) {
  const query = useFileDownload(path);

  if (query.isLoading) {
    return (
      <div className={panelStyles.emptyState}>
        <Spinner size="sm" /> Loading video...
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className={panelStyles.emptyState}>
        Error: {query.error instanceof Error ? query.error.message : "unknown error"}
      </div>
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
