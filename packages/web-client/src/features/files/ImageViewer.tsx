/**
 * ImageViewer — renders a binary image file by downloading it over the file-transfer binary
 * frames (`useFileDownload`) and displaying the resulting object URL (POC_TO_APP_PLAN_UI.md §4.5
 * follow-up: modular file preview). A checkerboard background shows through transparent PNGs.
 */

import { Spinner } from "../../components/primitives/Spinner.js";
import { useFileDownload } from "../../hooks/use-file-download.js";
import type { ViewerProps } from "./viewer-registry.js";
import panelStyles from "./FilePanel.module.css";
import styles from "./ImageViewer.module.css";

export function ImageViewer({ path }: ViewerProps) {
  const query = useFileDownload(path);

  if (query.isLoading) {
    return (
      <div className={panelStyles.emptyState}>
        <Spinner size="sm" /> Loading image...
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
      <img className={styles.image} src={query.data.objectUrl} alt={path.split("/").pop() || path} />
    </div>
  );
}
