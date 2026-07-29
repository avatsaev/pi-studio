import { createReadStream } from "node:fs";
import { mkdir, open, realpath } from "node:fs/promises";
import { basename, dirname } from "node:path";

import {
  encodeFileTransferFrame,
  type FileTransferFrame,
  tryDecodeFileTransferFrame,
} from "@av-pi-studio/protocol";

import type { Session } from "../ws/session.js";
import type { BinaryHandler, HandlerRegistry } from "../ws/router.js";
import { DownloadTokenStore } from "./download-token-store.js";
import { mimeHintForFile } from "./file-explorer.js";
import { expandHome } from "./resolve-path.js";

/**
 * Chunked file download (token-authorized) + upload over the file-transfer binary frame format
 * (features/file-explorer-transfer.md § Binary transfer frames, § Behavior). Downloads stream
 * `Begin → Chunk* → End`; uploads consume the same frames and write to the target path.
 */

const DEFAULT_CHUNK_BYTES = 32 * 1024;

export interface FileTransferDeps {
  tokenStore?: DownloadTokenStore;
  chunkBytes?: number;
}

interface PendingUpload {
  transferId: string;
  targetPath: string;
  handle: Awaited<ReturnType<typeof open>> | null;
  bytesWritten: number;
  /** Serializes frame processing for this stream (Begin must finish before Chunks write). */
  chain: Promise<void>;
}

export class FileTransferService {
  readonly tokenStore: DownloadTokenStore;
  private readonly chunkBytes: number;
  /** Pending uploads keyed by stream number. */
  private readonly uploads = new Map<number, PendingUpload>();
  private nextStream = 1;

  constructor(deps: FileTransferDeps = {}) {
    this.tokenStore = deps.tokenStore ?? new DownloadTokenStore();
    this.chunkBytes = deps.chunkBytes ?? DEFAULT_CHUNK_BYTES;
  }

  /** Issue a download token for a resolved path (also used by the file explorer for binary files). */
  issueDownloadToken = (resolvedPath: string): string => this.tokenStore.issue(resolvedPath).token;

  registerHandlers(registry: HandlerRegistry): void {
    registry.register("file_download_token_request", async (ctx) => {
      const path = String(ctx.message.path ?? "");
      let resolved: string;
      try {
        resolved = await realpath(expandHome(path));
      } catch {
        return { type: "file_download_token_response", ok: false, error: "not_found" };
      }
      const { token, expiresAt } = this.tokenStore.issue(resolved);
      return { type: "file_download_token_response", ok: true, token, expiresAt };
    });

    registry.register("file_download_request", async (ctx) => {
      const token = String(ctx.message.token ?? "");
      const stream = Number(ctx.message.stream ?? this.nextStream++);
      const result = await this.startDownload(token, stream, (frame) =>
        ctx.session.sendBinary(frame),
      );
      return { type: "file_download_response", stream, ...result };
    });

    registry.register("file_upload_request", (ctx) => {
      const targetPath = String(ctx.message.path ?? "");
      const transferId = String(ctx.message.transferId ?? "");
      if (!targetPath || !transferId) {
        return { type: "file_upload_response", ok: false, error: "missing_fields" };
      }
      const stream = this.nextStream++;
      this.uploads.set(stream, {
        transferId,
        targetPath,
        handle: null,
        bytesWritten: 0,
        chain: Promise.resolve(),
      });
      return { type: "file_upload_response", ok: true, stream };
    });
  }

  /**
   * Validate + consume the token, then stream the file as `Begin → Chunk* → End` binary frames.
   */
  async startDownload(
    token: string,
    stream: number,
    sink: (frame: Uint8Array) => void,
  ): Promise<{ ok: boolean; error?: string; transferId?: string }> {
    const path = this.tokenStore.consume(token);
    if (!path) return { ok: false, error: "invalid_or_expired_token" };

    const transferId = `dl-${stream}-${Date.now()}`;
    sink(
      encodeFileTransferFrame({
        opcode: "Begin",
        stream,
        meta: { transferId, fileName: basename(path), mimeType: mimeHintForFile(path) },
      }),
    );

    await new Promise<void>((resolve, reject) => {
      const rs = createReadStream(path, { highWaterMark: this.chunkBytes });
      rs.on("data", (chunk) => {
        const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        sink(encodeFileTransferFrame({ opcode: "Chunk", stream, data: new Uint8Array(bytes) }));
      });
      rs.on("end", () => resolve());
      rs.on("error", reject);
    }).catch(() => {
      sink(encodeFileTransferFrame({ opcode: "Error", stream, message: "read_failed" }));
    });

    sink(encodeFileTransferFrame({ opcode: "End", stream, ok: true }));
    return { ok: true, transferId };
  }

  /** Binary frame handler for upload streams (Begin → Chunk* → End). Frames are serialized per
   * stream so an in-flight `Begin` (open) completes before any `Chunk` writes. */
  binaryHandler(): BinaryHandler {
    return (_session: Session, bytes: Uint8Array) => {
      const frame = tryDecodeFileTransferFrame(bytes);
      if (!frame) return;
      const upload = this.uploads.get(frame.stream);
      if (!upload) return; // unknown/closed stream
      upload.chain = upload.chain.then(() => this.handleUploadFrame(frame));
    };
  }

  private async handleUploadFrame(frame: FileTransferFrame): Promise<void> {
    const upload = this.uploads.get(frame.stream);
    if (!upload) return; // unknown/closed stream

    switch (frame.opcode) {
      case "Begin": {
        if (frame.meta.transferId !== upload.transferId) return; // mismatched transfer
        await mkdir(dirname(upload.targetPath), { recursive: true });
        upload.handle = await open(upload.targetPath, "w");
        return;
      }
      case "Chunk": {
        if (!upload.handle) return;
        await upload.handle.write(Buffer.from(frame.data));
        upload.bytesWritten += frame.data.length;
        return;
      }
      case "End": {
        await upload.handle?.close();
        this.uploads.delete(frame.stream);
        return;
      }
      case "Error": {
        await upload.handle?.close();
        this.uploads.delete(frame.stream);
        return;
      }
    }
  }
}
