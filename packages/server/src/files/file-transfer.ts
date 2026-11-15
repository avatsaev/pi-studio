import type { FileHandle } from "node:fs/promises";
import { mkdir, open, realpath, stat } from "node:fs/promises";
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
import { mimeHintForFile } from "./file-explorer.js";
import { expandHome } from "./resolve-path.js";

/**
 * Chunked file download (by path, optionally a byte range) + upload over the file-transfer binary
 * frame format (features/file-explorer-transfer.md § Binary transfer frames, § Behavior). A
 * download is answered first (`file_download_response`, with the file's size) and then streams
 * `Begin → Chunk* → End`; uploads consume the same frames and write to the target path.
 * Range, response ordering and errors: features/desktop-client-protocol-followups-2.md § 1.
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
  chunkBytes?: number;
  highWaterBytes?: number;
  lowWaterBytes?: number;
  /** How often a paused download re-reads the socket's queue. */
  drainPollMs?: number;
}

/** One download a session has accepted and not finished. Tracked from the moment it is accepted. */
interface ActiveDownload {
  /** Set by a cancel request (`cancelled`) or the session closing (`closed`); the stream stops. */
  stop: "cancelled" | "closed" | null;
  /** Wakes the read loop so it notices `stop`; set while one runs. */
  wake?: () => void;
  /** Set once the file is open, so closing the session can release it even before `run`. */
  handle?: FileHandle;
}

/** A download that passed validation: the file is open and every number is final. */
interface PreparedDownload {
  sessionId: string;
  active: ActiveDownload;
  stream: number;
  transferId: string;
  fileName: string;
  mimeType: string;
  /** The whole file's size. */
  totalBytes: number;
  /** Modification time truncated to whole milliseconds, so a client can echo it back exactly. */
  mtimeMs: number;
  offset: number;
  /** Bytes that will follow: the requested length clamped to the end of the file. */
  length: number;
  handle: FileHandle;
}

type DownloadOpenResult =
  | { ok: true; download: PreparedDownload }
  | {
      ok: false;
      error: string;
      stream?: number;
      /** `changed` only: the file's current size and modification time. */
      current?: { totalBytes: number; mtimeMs: number };
    };

/** How a streamed download ended. `closed` sends nothing further. */
type DownloadOutcome = "end" | "read_failed" | "changed" | "cancelled" | "closed";

/** Absent → `undefined`; a safe integer ≥ `min` → itself; anything else → `null` (invalid). */
function parseCount(value: unknown, min: number): number | null | undefined {
  if (value === undefined) return undefined;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min ? value : null;
}

function isMissing(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === "ENOENT";
}

/** `ifUnchanged` equals the file as it is now. Anything but `{ size, mtimeMs }` never does. */
function matchesFile(ifUnchanged: unknown, size: number, mtimeMs: number): boolean {
  if (typeof ifUnchanged !== "object" || ifUnchanged === null) return false;
  const expected = ifUnchanged as { size?: unknown; mtimeMs?: unknown };
  return expected.size === size && expected.mtimeMs === mtimeMs;
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
  private readonly chunkBytes: number;
  private readonly highWaterBytes: number;
  private readonly lowWaterBytes: number;
  private readonly drainPollMs: number;
  /** Pending uploads keyed by stream id. */
  private readonly uploads = new Map<number, PendingUpload>();
  /** Rotating hand-out point in the one-byte stream id space (see `nextFreeSlot`). */
  private streamCursor = 1;
  /** Accepted downloads by session id, then stream id: download ids are scoped to the session. */
  private readonly downloads = new Map<string, Map<number, ActiveDownload>>();
  /** Rotating hand-out point for a download the client did not number itself. */
  private downloadCursor = 1;

  constructor(deps: FileTransferDeps = {}) {
    this.chunkBytes = deps.chunkBytes ?? DEFAULT_CHUNK_BYTES;
    this.highWaterBytes = deps.highWaterBytes ?? DOWNLOAD_HIGH_WATER_BYTES;
    this.lowWaterBytes = deps.lowWaterBytes ?? DOWNLOAD_LOW_WATER_BYTES;
    this.drainPollMs = deps.drainPollMs ?? DEFAULT_DRAIN_POLL_MS;
  }

  /**
   * Answer a `file_download_request` from session `sessionId`. `response` is the
   * `file_download_response` to send; `run` is present only when the download was accepted, and
   * streams the file once called (after the response has gone out). The caller must call `run`
   * exactly once: it owns the open file.
   */
  async beginDownload(
    sessionId: string,
    message: Record<string, unknown>,
  ): Promise<{
    response: Record<string, unknown>;
    run?: (sink: (frame: Uint8Array) => void, pacing: DownloadPacing) => Promise<void>;
  }> {
    const opened = await this.openDownload(sessionId, message);
    if (!opened.ok) {
      return {
        response: {
          type: "file_download_response",
          ok: false,
          error: opened.error,
          ...(opened.stream === undefined ? {} : { stream: opened.stream }),
          ...opened.current,
        },
      };
    }
    const d = opened.download;
    return {
      response: {
        type: "file_download_response",
        ok: true,
        stream: d.stream,
        transferId: d.transferId,
        totalBytes: d.totalBytes,
        mtimeMs: d.mtimeMs,
        offset: d.offset,
        length: d.length,
      },
      run: (sink, pacing) => this.streamDownload(d, sink, pacing),
    };
  }

  /**
   * Stop `sessionId`'s download on `stream`: it sends `Error` `cancelled` and reads no further.
   * False when that session has no download on `stream` (never started, or already finished).
   */
  cancelDownload(sessionId: string, stream: number): boolean {
    const active = this.downloads.get(sessionId)?.get(stream);
    if (!active) return false;
    active.stop ??= "cancelled";
    active.wake?.();
    return true;
  }

  registerHandlers(registry: HandlerRegistry): void {
    registry.register("file_download_request", async (ctx) => {
      const { response, run } = await this.beginDownload(ctx.session.id, ctx.message);
      // The router sends the reply first and the stream starts after it, so a client always learns
      // the size and range before the first frame and a long transfer never holds the request open.
      if (run) {
        ctx.afterReply(
          () =>
            void run((frame) => ctx.session.sendBinary(frame), {
              bufferedAmount: () => ctx.session.bufferedAmount,
              isOpen: () => ctx.session.isOpen,
            }),
        );
      }
      return response;
    });

    registry.register("file_download_cancel_request", (ctx) => {
      const stream = ctx.message.stream;
      const cancelled = typeof stream === "number" && this.cancelDownload(ctx.session.id, stream);
      return cancelled
        ? { type: "file_download_cancel_response", ok: true }
        : { type: "file_download_cancel_response", ok: false, error: "not_found" };
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

  /**
   * Validate a download request, reserve its stream id on the session and open its file. Nothing is
   * sent: the caller answers first and then calls `streamDownload`, which owns (and closes) the
   * returned handle and releases the reservation.
   *
   * `offset` defaults to 0 and `length` to "to the end of the file"; `length` is clamped to it. An
   * `offset` equal to the size is a legal empty range, one beyond it is `range_not_satisfiable`.
   * `ifUnchanged` that does not equal the file's current size and modification time (a malformed
   * one never does) is `changed`.
   */
  private async openDownload(
    sessionId: string,
    message: Record<string, unknown>,
  ): Promise<DownloadOpenResult> {
    const path = message.path;
    if (typeof path !== "string" || path === "") return { ok: false, error: "missing_path" };

    const requestedStream = message.stream;
    if (
      requestedStream !== undefined &&
      !(
        typeof requestedStream === "number" &&
        Number.isInteger(requestedStream) &&
        requestedStream >= 0 &&
        requestedStream < SLOT_SPACE
      )
    ) {
      return { ok: false, error: "invalid_stream" };
    }

    const offset = parseCount(message.offset, 0);
    const requestedLength = parseCount(message.length, 1);
    if (offset === null || requestedLength === null) return { ok: false, error: "invalid_range" };

    // Check and reserve with no await in between: two requests for one id cannot both pass.
    let mine = this.downloads.get(sessionId);
    if (!mine) this.downloads.set(sessionId, (mine = new Map()));
    const stream = requestedStream ?? nextFreeSlot(mine, this.downloadCursor);
    if (stream === null) {
      this.releaseSession(sessionId, mine);
      return { ok: false, error: "no_free_stream" };
    }
    if (mine.has(stream)) return { ok: false, error: "stream_in_use", stream };
    if (requestedStream === undefined) this.downloadCursor = (stream + 1) % SLOT_SPACE;
    const active: ActiveDownload = { stop: null };
    mine.set(stream, active);

    const result = await this.openFile(sessionId, active, stream, path, {
      offset: offset ?? 0,
      requestedLength,
      ifUnchanged: message.ifUnchanged,
    });
    if (!result.ok) this.release(sessionId, stream, active);
    return result;
  }

  private async openFile(
    sessionId: string,
    active: ActiveDownload,
    stream: number,
    path: string,
    range: { offset: number; requestedLength: number | undefined; ifUnchanged: unknown },
  ): Promise<DownloadOpenResult> {
    let resolved: string;
    try {
      resolved = await realpath(expandHome(path));
    } catch {
      return { ok: false, error: "not_found", stream };
    }
    let handle: FileHandle;
    try {
      // Checked before opening: opening a FIFO or device for reading can block.
      if (!(await stat(resolved)).isFile()) return { ok: false, error: "not_a_file", stream };
      handle = await open(resolved, "r");
    } catch (err) {
      return { ok: false, error: isMissing(err) ? "not_found" : "unreadable", stream };
    }

    let handedOver = false;
    try {
      active.handle = handle;
      const info = await handle.stat();
      if (!info.isFile()) return { ok: false, error: "not_a_file", stream };
      if (range.offset > info.size) return { ok: false, error: "range_not_satisfiable", stream };
      const mtimeMs = Math.trunc(info.mtimeMs);
      if (range.ifUnchanged !== undefined && !matchesFile(range.ifUnchanged, info.size, mtimeMs)) {
        return {
          ok: false,
          error: "changed",
          stream,
          current: { totalBytes: info.size, mtimeMs },
        };
      }
      const available = info.size - range.offset;
      const download: PreparedDownload = {
        sessionId,
        active,
        stream,
        transferId: `dl-${stream}-${Date.now()}`,
        fileName: basename(resolved),
        mimeType: mimeHintForFile(resolved),
        totalBytes: info.size,
        mtimeMs,
        offset: range.offset,
        length: Math.min(range.requestedLength ?? available, available),
        handle,
      };
      handedOver = true;
      return { ok: true, download };
    } catch {
      return { ok: false, error: "unreadable", stream };
    } finally {
      if (!handedOver) await handle.close().catch(() => {});
    }
  }

  /** Forget a finished or rejected download. A no-op once the session's downloads were dropped. */
  private release(sessionId: string, stream: number, active: ActiveDownload): void {
    const mine = this.downloads.get(sessionId);
    if (!mine || mine.get(stream) !== active) return;
    mine.delete(stream);
    this.releaseSession(sessionId, mine);
  }

  private releaseSession(sessionId: string, mine: Map<number, ActiveDownload>): void {
    if (mine.size === 0 && this.downloads.get(sessionId) === mine) this.downloads.delete(sessionId);
  }

  /**
   * Stream an opened download as `Begin → Chunk* → End` binary frames, then close its file.
   *
   * The disk read pauses while the socket's queue is above the high-water mark, so a client that
   * reads slowly costs the daemon about that much memory, not the whole file. A read error, or a
   * file that ended before the announced length, sends one `Error` frame and no `End`; a socket
   * that closed mid-transfer ends it silently. Never rejects: it runs detached from the request.
   */
  private async streamDownload(
    d: PreparedDownload,
    sink: (frame: Uint8Array) => void,
    pacing: DownloadPacing,
  ): Promise<void> {
    try {
      if (d.active.stop === "closed" || !pacing.isOpen()) return;
      if (d.active.stop === "cancelled") {
        // Cancelled between the answer and the first frame: no `Begin` was promised yet.
        sink(encodeFileTransferFrame({ opcode: "Error", stream: d.stream, message: "cancelled" }));
        return;
      }
      sink(
        encodeFileTransferFrame({
          opcode: "Begin",
          stream: d.stream,
          meta: {
            transferId: d.transferId,
            fileName: d.fileName,
            mimeType: d.mimeType,
            totalBytes: d.totalBytes,
            mtimeMs: d.mtimeMs,
            offset: d.offset,
            length: d.length,
          },
        }),
      );
      const outcome = await this.pipeRange(d, sink, pacing);
      if (outcome === "closed") return;
      sink(
        encodeFileTransferFrame(
          outcome === "end"
            ? { opcode: "End", stream: d.stream, ok: true }
            : { opcode: "Error", stream: d.stream, message: outcome },
        ),
      );
    } catch {
      // A send to a socket that closed under us throws; there is nobody left to tell.
    } finally {
      this.release(d.sessionId, d.stream, d.active);
      await d.handle.close().catch(() => {});
    }
  }

  private pipeRange(
    d: PreparedDownload,
    sink: (frame: Uint8Array) => void,
    pacing: DownloadPacing,
  ): Promise<DownloadOutcome> {
    if (d.length === 0) return Promise.resolve("end");
    const { promise, resolve } = Promise.withResolvers<DownloadOutcome>();
    const rs = d.handle.createReadStream({
      start: d.offset,
      end: d.offset + d.length - 1,
      highWaterMark: this.chunkBytes,
      autoClose: false,
    });
    let sent = 0;
    let settled = false;
    const stopped = (): DownloadOutcome => (d.active.stop === "cancelled" ? "cancelled" : "closed");
    const finish = (outcome: DownloadOutcome): void => {
      if (settled) return;
      settled = true;
      d.active.wake = undefined;
      rs.destroy();
      resolve(outcome);
    };
    d.active.wake = () => {
      if (d.active.stop) finish(stopped());
    };
    rs.on("data", (chunk) => {
      if (settled) return;
      if (d.active.stop) return finish(stopped());
      if (!pacing.isOpen()) return finish("closed");
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      try {
        sink(
          encodeFileTransferFrame({
            opcode: "Chunk",
            stream: d.stream,
            data: new Uint8Array(bytes),
          }),
        );
      } catch {
        return finish("closed");
      }
      sent += bytes.length;
      const queued = pacing.bufferedAmount();
      if (queued !== undefined && queued > this.highWaterBytes) {
        rs.pause();
        void this.waitForDrain(pacing, () => settled).then((stillOpen) => {
          if (!stillOpen) finish("closed");
          else if (!settled) rs.resume();
        });
      }
    });
    // The range is bounded, so a short read means the file shrank after the size was announced.
    rs.on("end", () => finish(sent === d.length ? "end" : "changed"));
    rs.on("error", () => finish("read_failed"));
    return promise;
  }

  /**
   * Resolves `true` once the socket's queue is at or below the low-water mark; `false` if it closed
   * or the download ended (`ended`) while waiting.
   */
  private async waitForDrain(pacing: DownloadPacing, ended: () => boolean): Promise<boolean> {
    for (;;) {
      if (ended() || !pacing.isOpen()) return false;
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
   * handle is closed once frames already in flight finish; its downloads stop reading and lose
   * their stream id and file handle. Nothing is sent (the session is gone).
   */
  disposeSession(session: Session): void {
    for (const [stream, upload] of this.uploads) {
      if (upload.sessionId !== session.id) continue;
      this.uploads.delete(stream);
      upload.done = true;
      upload.chain = upload.chain.then(() => upload.handle?.close().catch(() => {}));
    }
    const mine = this.downloads.get(session.id);
    if (!mine) return;
    this.downloads.delete(session.id);
    for (const active of mine.values()) {
      active.stop = "closed";
      active.wake?.();
      void active.handle?.close().catch(() => {});
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
