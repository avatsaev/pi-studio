import { type FileTransferFrame } from "@av-pi-studio/protocol";

import type { DaemonClient } from "./daemon-client.js";

/**
 * Client-side demux + assembly for binary file downloads (features/file-explorer-transfer.md
 * § Binary transfer frames). Mirrors `TerminalStreamRouter`'s inbound-frame-routing shape, but a
 * download is a one-shot request/response rather than a persistent per-slot subscription: request
 * a token, request the download, await the assembled bytes.
 */

export interface DownloadedFile {
  bytes: Uint8Array;
  fileName?: string;
  mimeType?: string;
}

interface PendingDownload {
  chunks: Uint8Array[];
  meta: { fileName?: string; mimeType?: string };
  resolve: (file: DownloadedFile) => void;
  reject: (error: Error) => void;
}

interface TokenResponse {
  ok: boolean;
  token?: string;
  error?: string;
}

interface DownloadRequestResponse {
  ok: boolean;
  error?: string;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export class FileTransferClient {
  private readonly pending = new Map<number, PendingDownload>();
  private nextStream = 1;
  private detach: (() => void) | null = null;

  constructor(private readonly daemon: DaemonClient) {}

  /** Begin routing inbound file-transfer frames. Idempotent. */
  start(): void {
    if (this.detach) return;
    this.detach = this.daemon.onFileTransferFrame((frame) => this.dispatch(frame));
  }

  /** Stop routing inbound frames. Any downloads still pending are rejected. */
  stop(): void {
    this.detach?.();
    this.detach = null;
    for (const [stream, pending] of this.pending) {
      pending.reject(new Error("file transfer router stopped"));
      this.pending.delete(stream);
    }
  }

  /**
   * Download the file at `path`: requests a single-use token, then requests the chunked
   * transfer, assembling `Begin → Chunk* → End` frames into one buffer.
   */
  async download(path: string): Promise<DownloadedFile> {
    const tokenResponse = await this.daemon.request<TokenResponse>(
      "file_download_token_request",
      { path },
    );
    if (!tokenResponse.ok || !tokenResponse.token) {
      throw new Error(tokenResponse.error ?? "failed to issue download token");
    }

    const stream = this.nextStream++;
    const result = new Promise<DownloadedFile>((resolve, reject) => {
      this.pending.set(stream, { chunks: [], meta: {}, resolve, reject });
    });

    const requestResponse = await this.daemon.request<DownloadRequestResponse>(
      "file_download_request",
      { token: tokenResponse.token, stream },
    );
    if (!requestResponse.ok) {
      this.pending.delete(stream);
      throw new Error(requestResponse.error ?? "download request failed");
    }

    return result;
  }

  private dispatch(frame: FileTransferFrame): void {
    const pending = this.pending.get(frame.stream);
    if (!pending) return; // not a download stream we're tracking (e.g. an upload) — ignore
    switch (frame.opcode) {
      case "Begin":
        pending.meta.fileName = frame.meta.fileName;
        pending.meta.mimeType = frame.meta.mimeType;
        return;
      case "Chunk":
        pending.chunks.push(frame.data);
        return;
      case "End":
        this.pending.delete(frame.stream);
        if (frame.ok) {
          pending.resolve({ bytes: concat(pending.chunks), ...pending.meta });
        } else {
          pending.reject(new Error("download failed"));
        }
        return;
      case "Error":
        this.pending.delete(frame.stream);
        pending.reject(new Error(frame.message));
        return;
    }
  }
}
