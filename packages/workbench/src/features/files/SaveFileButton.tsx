/**
 * The "Download" action for a file no viewer can display (too large, or binary with no preview).
 * Saves through the host's `files.saveToDisk` — the browser downloads and offers the file, a native
 * host can stream it to disk — so no viewer builds its own download link.
 */

import { useEffect, useRef, useState } from "react";
import { Button, Spinner } from "@av-pi-studio/ui-library";
import { useFileTransfer } from "../../hooks/use-file-transfer.js";
import { isAbortError } from "../../stores/transfer-activity-store.js";

export function SaveFileButton({ path }: { path: string }) {
  const { saveToDisk } = useFileTransfer();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await saveToDisk(path);
    } catch (err) {
      if (mountedRef.current && !isAbortError(err)) {
        setError(err instanceof Error ? err.message : "download failed");
      }
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }

  return (
    <>
      {error && <div>Error: {error}</div>}
      {saving ? (
        <Spinner size="sm" />
      ) : (
        <Button size="sm" onClick={() => void save()}>
          Download
        </Button>
      )}
    </>
  );
}
