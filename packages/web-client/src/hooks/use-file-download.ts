/**
 * `use-file-download` — TanStack Query wrapper over the binary file-transfer download path
 * (`file_download_token_request` → `file_download_request` → chunked `Begin`/`Chunk`/`End`
 * binary frames), for viewers that need raw bytes rather than the UTF-8 preview
 * `file_read_request` returns (images, video — POC_TO_APP_PLAN_UI.md §4.5 follow-up: modular
 * file preview). Resolves to an object URL, revoked once superseded by a new one or once this
 * consumer unmounts.
 */

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DaemonClient } from "@av-pi-studio/client";
import { FileTransferClient } from "@av-pi-studio/client";
import { useConnectionStore } from "../lib/connection/connection-store.js";
import { rpcKeys } from "../lib/connection/rpc-keys.js";

// One FileTransferClient per daemon connection — mirrors `TerminalPanel.tsx`'s `routerFor`
// (multiple viewers share the one frame demuxer over the shared socket).
const transferByDaemon = new WeakMap<DaemonClient, FileTransferClient>();

function transferFor(daemon: DaemonClient): FileTransferClient {
  let transfer = transferByDaemon.get(daemon);
  if (!transfer) {
    transfer = new FileTransferClient(daemon);
    transfer.start();
    transferByDaemon.set(daemon, transfer);
  }
  return transfer;
}

export interface FileDownload {
  objectUrl: string;
  mimeType?: string;
  fileName?: string;
}

export function useFileDownload(path: string, enabled = true) {
  const client = useConnectionStore((s) => s.client);
  const daemon = useConnectionStore((s) => s.daemon);

  const query = useQuery({
    queryKey: rpcKeys.fileDownload(path),
    queryFn: async (): Promise<FileDownload> => {
      if (!client || !daemon) throw new Error("not connected");
      const file = await transferFor(daemon).download(path);
      // `Blob`'s DOM typings require an `ArrayBuffer`-backed view; the assembled `Uint8Array`'s
      // `ArrayBufferLike` backing (a decode-time implementation detail) doesn't satisfy that on
      // its own, so copy into a plain `ArrayBuffer`-backed `Uint8Array` first.
      const blob = new Blob([Uint8Array.from(file.bytes)], {
        type: file.mimeType || "application/octet-stream",
      });
      return { objectUrl: URL.createObjectURL(blob), mimeType: file.mimeType, fileName: file.fileName };
    },
    enabled: Boolean(client) && Boolean(daemon) && Boolean(path) && enabled,
    // Object URLs are process-local, non-serializable browser resources — never persist them or
    // silently refetch behind this hook's back (that would leak the previous blob's URL).
    staleTime: Infinity,
    gcTime: 0,
  });

  // Revoke the previous object URL once a new one supersedes it, and the current one on unmount
  // — TanStack Query's cache has no notion that this value owns a browser resource to release.
  const urlRef = useRef<string | null>(null);
  useEffect(() => {
    const nextUrl = query.data?.objectUrl ?? null;
    if (nextUrl && urlRef.current && urlRef.current !== nextUrl) {
      URL.revokeObjectURL(urlRef.current);
    }
    urlRef.current = nextUrl;
  }, [query.data?.objectUrl]);

  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  return query;
}
