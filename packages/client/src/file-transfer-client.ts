import {
  encodeFileTransferFrame,
  type FileTransferFrame,
  nextFreeSlot,
  SLOT_SPACE,
} from "@av-pi-studio/protocol";

import { randomId, type DaemonClient } from "./daemon-client.js";

/**
 * Client-side demux + assembly for binary file downloads plus chunked uploads
 * (features/file-explorer-transfer.md § Binary transfer frames). Mirrors `TerminalStreamRouter`'s
 * inbound-frame-routing shape, but a download is a one-shot request/response rather than a
 * persistent per-slot subscription: request a token, request the download, await the assembled
 * bytes. An upload is the inverse: request an upload stream, then push `Begin → Chunk* → End`
 * binary frames the server writes to the target path.
 */

/** Matches the server's default chunk size (`FileTransferService` DEFAULT_CHUNK_BYTES). */
const UPLOAD_CHUNK_BYTES = 32 * 1024;

/** The daemon's `startDownload` rejection when a token is unknown, spent, or past its TTL. */
const EXPIRED_TOKEN = "invalid_or_expired_token";

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

interface UploadRequestResponse {
  ok: boolean;
  stream?: number;
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
  /** Rotating hand-out point in the one-byte stream id space — ids are a pool, not a counter. */
  private streamCursor = 1;
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
   *
   * Retries exactly once on an expired token. The daemon's TTL runs from the moment it ISSUES a
   * token, but the token only becomes usable once its response reaches us — queued behind every
   * `Chunk` frame already in flight on this one socket. A large transfer ahead of it can hand us
   * a token that is dead on arrival (relay makes this routine: base64-inflated frames, extra
   * hop). By the time we see the rejection that backlog has drained, so a second attempt lands on
   * a quiet socket; looping further would only spin on a genuinely broken link.
   */
  async download(path: string): Promise<DownloadedFile> {
    try {
      return await this.attemptDownload(path);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== EXPIRED_TOKEN) throw error;
      return await this.attemptDownload(path);
    }
  }

  private async attemptDownload(path: string): Promise<DownloadedFile> {
    const tokenResponse = await this.daemon.request<TokenResponse>("file_download_token_request", {
      path,
    });
    if (!tokenResponse.ok || !tokenResponse.token) {
      throw new Error(tokenResponse.error ?? "failed to issue download token");
    }

    // Stream ids live in a single frame-header byte, so they are recycled as transfers finish;
    // an ever-incrementing counter would emit 256 and be rejected by the codec from then on.
    const stream = nextFreeSlot(this.pending, this.streamCursor);
    if (stream === null) throw new Error("no free download stream");
    this.streamCursor = (stream + 1) % SLOT_SPACE;

    const result = new Promise<DownloadedFile>((resolve, reject) => {
      this.pending.set(stream, { chunks: [], meta: {}, resolve, reject });
    });

    let requestResponse: DownloadRequestResponse;
    try {
      requestResponse = await this.daemon.request<DownloadRequestResponse>(
        "file_download_request",
        { token: tokenResponse.token, stream },
      );
    } catch (error) {
      // A timed-out or socket-killed request never streams `End`, so release the id here or it
      // stays claimed for the life of the connection and eats the pool.
      this.pending.delete(stream);
      throw error;
    }
    if (!requestResponse.ok) {
      this.pending.delete(stream);
      throw new Error(requestResponse.error ?? "download request failed");
    }

    return result;
  }

  /**
   * Upload `bytes` to `path` on the daemon: requests an upload stream, then pushes
   * `Begin → Chunk* → End` binary frames the server writes to disk (creating parent dirs,
   * overwriting any existing file). The server keys the transfer by `transferId`, which the
   * `Begin` frame must echo. Resolves once every frame is flushed to the socket.
   */
  async upload(path: string, bytes: Uint8Array): Promise<void> {
    const transferId = randomId();
    const response = await this.daemon.request<UploadRequestResponse>("file_upload_request", {
      path,
      transferId,
    });
    if (!response.ok || response.stream === undefined) {
      throw new Error(response.error ?? "upload request failed");
    }
    const stream = response.stream;

    this.daemon.sendBinary(
      encodeFileTransferFrame({ opcode: "Begin", stream, meta: { transferId } }),
    );
    for (let offset = 0; offset < bytes.length; offset += UPLOAD_CHUNK_BYTES) {
      const data = bytes.subarray(offset, offset + UPLOAD_CHUNK_BYTES);
      this.daemon.sendBinary(encodeFileTransferFrame({ opcode: "Chunk", stream, data }));
    }
    this.daemon.sendBinary(encodeFileTransferFrame({ opcode: "End", stream, ok: true }));
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
