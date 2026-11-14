/**
 * `use-file-download` — TanStack Query wrapper that makes a daemon file displayable by URL, for
 * viewers that need raw bytes rather than the UTF-8 preview `file_read_request` returns (images,
 * video, PDF, molecules, large text). The URL comes from the host's `files.openForView` (browser: a
 * `Blob` object URL over the chunked binary download). Each URL is released once superseded by a
 * new one or once this consumer unmounts.
 */

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { getHost } from "../host/install.js";
import { useConnectionStore } from "../lib/connection/connection-store.js";
import { rpcKeys } from "../lib/connection/rpc-keys.js";

export interface FileDownload {
  objectUrl: string;
  mimeType?: string;
  fileName?: string;
  /** Frees `objectUrl`. Owned by this hook; consumers never call it. */
  release(): void;
}

/** Release `previous` when `next` supersedes it. Returns what to remember as current. */
export function supersedeDownload(
  previous: FileDownload | null,
  next: FileDownload | null,
): FileDownload | null {
  if (next && previous && previous !== next) previous.release();
  return next;
}

export function useFileDownload(path: string, enabled = true) {
  const client = useConnectionStore((s) => s.client);
  const daemon = useConnectionStore((s) => s.daemon);

  const query = useQuery({
    queryKey: rpcKeys.fileDownload(path),
    queryFn: async (): Promise<FileDownload> => {
      const file = await getHost().files.openForView(path);
      return {
        objectUrl: file.url,
        mimeType: file.mimeType,
        fileName: file.fileName,
        release: () => file.release(),
      };
    },
    enabled: Boolean(client) && Boolean(daemon) && Boolean(path) && enabled,
    // View URLs are process-local, non-serializable resources — never persist them or silently
    // refetch behind this hook's back (that would leak the previous URL).
    staleTime: Infinity,
    gcTime: 0,
  });

  // Release the previous URL once a new one supersedes it, and the current one on unmount —
  // TanStack Query's cache has no notion that this value owns a resource to release.
  const currentRef = useRef<FileDownload | null>(null);
  useEffect(() => {
    currentRef.current = supersedeDownload(currentRef.current, query.data ?? null);
  }, [query.data]);

  useEffect(() => {
    return () => currentRef.current?.release();
  }, []);

  return query;
}
