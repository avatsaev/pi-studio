/**
 * BinaryFallbackViewer — the registry's catch-all for binary files with no dedicated viewer
 * (archives, executables, unrecognized blobs). No preview is attempted eagerly; a manual
 * "Download" action fetches the bytes on demand via `useFileDownload` and saves them locally
 * (POC_TO_APP_PLAN_UI.md §4.5 follow-up: modular file preview).
 */

import { useState } from "react";
import { FileQuestion } from "lucide-react";
import { Button } from "@pi-studio-ui/components/primitives/Button.js";
import { Spinner } from "@pi-studio-ui/components/primitives/Spinner.js";
import { useFileDownload } from "@pi-studio-ui/hooks/use-file-download.js";
import type { ViewerProps } from "./viewer-registry.js";
import styles from "./BinaryFallbackViewer.module.css";

export function BinaryFallbackViewer({ path }: ViewerProps) {
  const [requested, setRequested] = useState(false);
  const query = useFileDownload(path, requested);
  const name = path.split("/").pop() || path;

  return (
    <div className={styles.wrap}>
      <FileQuestion size={32} />
      <div className={styles.name}>{name}</div>
      <div>No preview available for this file type.</div>
      {query.isError && (
        <div>Error: {query.error instanceof Error ? query.error.message : "download failed"}</div>
      )}
      {requested && query.isLoading ? (
        <Spinner size="sm" />
      ) : query.data ? (
        <a href={query.data.objectUrl} download={query.data.fileName || name}>
          <Button size="sm">Save file</Button>
        </a>
      ) : (
        <Button size="sm" onClick={() => setRequested(true)}>
          Download
        </Button>
      )}
    </div>
  );
}
