import { createReadStream } from "node:fs";
import { mkdir, open, realpath } from "node:fs/promises";
import { basename, dirname } from "node:path";

import {
  encodeFileTransferFrame,
  type FileTransferFrame,
  nextFreeSlot,
  SLOT_SPACE,
  tryDecodeFileTransferFrame,
  type FileUploadComplete,
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
 * Flow control, completion and stream ownership: features/desktop-client-protocol-followups.md § 2.
 */

const DEFAULT_CHUNK_BYTES = 32 * 1024;

/**
 * A download stops reading from disk while this many bytes are queued on the session's socket (32
 * default chunks) and resumes below the low mark. Chosen, not measured: big enough that the read
 * never starves a fast LAN link between polls, small enough that a stalled client costs the daemon
 * about a megabyte instead of the whole file. Injectable through `FileTransferDeps`.
 */
export const DOWNLOAD_HIGH_WATER_BYTES = 1024 * 1024;
export const DOWNLOAD_LOW_WATER_BYTES = 256 * 1024;
const DEFAULT_DRAIN_POLL_MS = 10;

export interface FileTransferDeps {
  tokenStore?: DownloadTokenStore;
  chunkBytes?: number;
  highWaterBytes?: number;
  lowWaterBytes?: number;
  /** How often a paused download re-reads the socket's queue. */
  drainPollMs?: number;
}

/** What a download needs to know about the socket it writes to. Absent means "do not pace". */
export interface DownloadPacing {
  /** Bytes queued and not yet flushed; `undefined` when the socket cannot say. */
  bufferedAmount(): number | undefined;
  /** False once the socket is closing or closed: the transfer ends without further frames. */
  isOpen(): boolean;
}

interface PendingUpload {
  transferId: string;
  targetPath: string;
  /** The session that opened the stream. Frames from any other session are ignored. */
  sessionId: string;
  /** `file_upload_request.ack`: send a `file_upload_complete` when the transfer ends. */
  ack: boolean;
  handle: Awaited<ReturnType<typeof open>> | null;
  bytesWritten: number;
  /** Serializes frame processing for this stream (Begin must finish before Chunks write). */
  chain: Promise<void>;
  /** Set once the stream is released (ended, failed or its session closed); later frames no-op. */
  done: boolean;
}

/** `open_failed (EACCES)`-style text: a stage plus the errno code, never a path or a stack. */
function failureText(stage: string, err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? `${stage}_failed (${code})` : `${stage}_failed`;
}

export class FileTransferService {
  readonly tokenStore: DownloadTokenStore;
  private readonly chunkBytes: number;
  private readonly highWaterBytes: number;
  private readonly lowWaterBytes: number;
  private readonly drainPollMs: number;
  /** Pending uploads keyed by stream id. */
  private readonly uploads = new Map<number, PendingUpload>();
  /** Rotating hand-out point in the one-byte stream id space (see `nextFreeSlot`). */
  private streamCursor = 1;

  constructor(deps: FileTransferDeps = {}) {
    this.tokenStore = deps.tokenStore ?? new DownloadTokenStore();
    this.chunkBytes = deps.chunkBytes ?? DEFAULT_CHUNK_BYTES;
    this.highWaterBytes = deps.highWaterBytes ?? DOWNLOAD_HIGH_WATER_BYTES;
    this.lowWaterBytes = deps.lowWaterBytes ?? DOWNLOAD_LOW_WATER_BYTES;
    this.drainPollMs = deps.drainPollMs ?? DEFAULT_DRAIN_POLL_MS;
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
      const stream =
        ctx.message.stream === undefined ? this.takeStream() : Number(ctx.message.stream);
      // Range-checked BEFORE the token is consumed: an out-of-range stream used to burn the
      // single-use token and only then throw out of `encodeFileTransferFrame`, leaving the
      // client's retry nothing to redeem.
      if (!Number.isInteger(stream) || stream < 0 || stream >= SLOT_SPACE) {
        return { type: "file_download_response", stream, ok: false, error: "invalid_stream" };
      }
      const result = await this.startDownload(
        token,
        stream,
        (frame) => ctx.session.sendBinary(frame),
        {
          bufferedAmount: () => ctx.session.bufferedAmount,
          isOpen: () => ctx.session.isOpen,
        },
      );
      return { type: "file_download_response", stream, ...result };
    });

    registry.register("file_upload_request", (ctx) => {
      const targetPath = String(ctx.message.path ?? "");
      const transferId = String(ctx.message.transferId ?? "");
      if (!targetPath || !transferId) {
        return { type: "file_upload_response", ok: false, error: "missing_fields" };
      }
      const stream = nextFreeSlot(this.uploads, this.streamCursor);
      if (stream === null) {
        return { type: "file_upload_response", ok: false, error: "no_free_stream" };
      }
      this.streamCursor = (stream + 1) % SLOT_SPACE;
      this.uploads.set(stream, {
        transferId,
        targetPath,
        sessionId: ctx.session.id,
        ack: ctx.message.ack === true,
        handle: null,
        bytesWritten: 0,
        chain: Promise.resolve(),
        done: false,
      });
      return { type: "file_upload_response", ok: true, stream };
    });
  }

  /** Hand out the next stream id for a transfer this service does not track (a download the
   *  client didn't number itself). Rotates through the one-byte space instead of counting past
   *  255, which `encodeFileTransferFrame` rejects outright. */
  private takeStream(): number {
    const stream = this.streamCursor;
    this.streamCursor = (stream + 1) % SLOT_SPACE;
    return stream;
  }

  /**
   * Validate + consume the token, then stream the file as `Begin → Chunk* → End` binary frames.
   *
   * With `pacing`, the disk read pauses while the socket's queue is above the high-water mark, so a
   * client that reads slowly costs the daemon about that much memory, not the whole file. A read
   * error sends one `Error` frame and stops (no `End`); a socket that closed mid-transfer ends it
   * silently.
   */
  async startDownload(
    token: string,
    stream: number,
    sink: (frame: Uint8Array) => void,
    pacing?: DownloadPacing,
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

    const outcome = await this.pipeFile(path, stream, sink, pacing);
    if (outcome === "closed") return { ok: false, error: "connection_closed", transferId };
    if (outcome === "error") {
      sink(encodeFileTransferFrame({ opcode: "Error", stream, message: "read_failed" }));
      return { ok: false, error: "read_failed", transferId };
    }
    sink(encodeFileTransferFrame({ opcode: "End", stream, ok: true }));
    return { ok: true, transferId };
  }

  private pipeFile(
    path: string,
    stream: number,
    sink: (frame: Uint8Array) => void,
    pacing: DownloadPacing | undefined,
  ): Promise<"end" | "error" | "closed"> {
    const { promise, resolve } = Promise.withResolvers<"end" | "error" | "closed">();
    const rs = createReadStream(path, { highWaterMark: this.chunkBytes });
    let settled = false;
    const finish = (outcome: "end" | "error" | "closed"): void => {
      if (settled) return;
      settled = true;
      rs.destroy();
      resolve(outcome);
    };
    rs.on("data", (chunk) => {
      if (settled) return;
      if (pacing && !pacing.isOpen()) return finish("closed");
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      sink(encodeFileTransferFrame({ opcode: "Chunk", stream, data: new Uint8Array(bytes) }));
      const queued = pacing?.bufferedAmount();
      if (pacing && queued !== undefined && queued > this.highWaterBytes) {
        rs.pause();
        void this.waitForDrain(pacing).then((stillOpen) => {
          if (!stillOpen) finish("closed");
          else if (!settled) rs.resume();
        });
      }
    });
    rs.on("end", () => finish("end"));
    rs.on("error", () => finish("error"));
    return promise;
  }

  /** Resolves `true` once the socket's queue is at or below the low-water mark; `false` if it closed. */
  private async waitForDrain(pacing: DownloadPacing): Promise<boolean> {
    for (;;) {
      if (!pacing.isOpen()) return false;
      const queued = pacing.bufferedAmount();
      if (queued === undefined || queued <= this.lowWaterBytes) return true;
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, this.drainPollMs);
      await promise;
    }
  }

  /** Binary frame handler for upload streams (Begin → Chunk* → End). Frames are serialized per
   * stream so an in-flight `Begin` (open) completes before any `Chunk` writes. A frame is applied
   * only if it comes from the session that opened the stream. */
  binaryHandler(): BinaryHandler {
    return (session: Session, bytes: Uint8Array) => {
      const frame = tryDecodeFileTransferFrame(bytes);
      if (!frame) return;
      const upload = this.uploads.get(frame.stream);
      if (!upload) return; // unknown/closed stream
      if (upload.sessionId !== session.id) return; // not this session's stream
      upload.chain = upload.chain.then(() => this.handleUploadFrame(session, upload, frame));
    };
  }

  /**
   * Release everything a session left open: its pending uploads lose their stream id and their file
   * handle is closed once frames already in flight finish. Nothing is sent (the session is gone).
   */
  disposeSession(session: Session): void {
    for (const [stream, upload] of this.uploads) {
      if (upload.sessionId !== session.id) continue;
      this.uploads.delete(stream);
      upload.done = true;
      upload.chain = upload.chain.then(() => upload.handle?.close().catch(() => {}));
    }
  }

  private async handleUploadFrame(
    session: Session,
    upload: PendingUpload,
    frame: FileTransferFrame,
  ): Promise<void> {
    if (upload.done) return; // released while this frame was queued
    let stage = "write";
    try {
      switch (frame.opcode) {
        case "Begin": {
          if (frame.meta.transferId !== upload.transferId) return; // mismatched transfer
          stage = "mkdir";
          await mkdir(dirname(upload.targetPath), { recursive: true });
          stage = "open";
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
          if (!upload.handle) return this.finishUpload(session, frame.stream, upload, "no_begin");
          stage = "close";
          const handle = upload.handle;
          upload.handle = null;
          await handle.close();
          return this.finishUpload(session, frame.stream, upload);
        }
        case "Error": {
          await upload.handle?.close();
          upload.handle = null;
          return this.finishUpload(session, frame.stream, upload, frame.message || "client_error");
        }
      }
    } catch (err) {
      // A failed Begin/Chunk/End: report it, free the stream, and leave whatever was written on
      // disk (deleting a partial file is a separate decision, see the spec).
      await upload.handle?.close().catch(() => {});
      upload.handle = null;
      this.finishUpload(session, frame.stream, upload, failureText(stage, err));
    }
  }

  /** Release the stream; push `file_upload_complete` if the client asked for it. */
  private finishUpload(
    session: Session,
    stream: number,
    upload: PendingUpload,
    error?: string,
  ): void {
    if (upload.done) return;
    upload.done = true;
    if (this.uploads.get(stream) === upload) this.uploads.delete(stream);
    if (!upload.ack || !session.isOpen) return;
    const message: FileUploadComplete = {
      type: "file_upload_complete",
      transferId: upload.transferId,
      stream,
      ok: error === undefined,
      bytesWritten: upload.bytesWritten,
      ...(error === undefined ? {} : { error }),
    };
    session.send({ type: "session", message });
  }
}
