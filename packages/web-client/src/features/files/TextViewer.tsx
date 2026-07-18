/**
 * TextViewer — the default viewer for source/text files: fetches the UTF-8 preview via
 * `useFileRead` and renders it through `CodeView` (line gutter + Shiki highlighting). Registered
 * in `viewer-registry.ts` as the fallback for any file not claimed by a more specific viewer.
 */

import { Spinner } from "@pi-studio-ui/components/primitives/Spinner.js";
import { useFileRead } from "@pi-studio-ui/hooks/use-file-read.js";
import { CodeView } from "./CodeView.js";
import type { ViewerProps } from "./viewer-registry.js";
import styles from "./FilePanel.module.css";

export function TextViewer({ path }: ViewerProps) {
  const query = useFileRead(path);

  if (query.isLoading) {
    return (
      <div className={styles.emptyState}>
        <Spinner size="sm" /> Loading...
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className={styles.emptyState}>
        Error: {query.error instanceof Error ? query.error.message : "unknown error"}
      </div>
    );
  }
  if (!query.data) return null;
  return <CodeView path={path} content={query.data.content} />;
}
