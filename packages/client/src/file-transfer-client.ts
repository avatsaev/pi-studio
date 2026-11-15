import {
  encodeFileTransferFrame,
  type FileTransferFrame,
  nextFreeSlot,
  SLOT_SPACE,
} from "@av-pi-studio/protocol";

import { randomId, type DaemonClient } from "./daemon-client.js";

/**
 * Client-side demux for binary file downloads plus chunked uploads
 * (features/file-explorer-transfer.md § Binary transfer frames). Mirrors `TerminalStreamRouter`'s
 * inbound-frame-routing shape, but a download is a one-shot request/response rather than a
 * persistent per-slot subscription: request the download by path (and optional byte range), then
 * hand the `Begin → Chunk* → End` frames that follow to a sink or collect them. An upload is the
 * inverse: request an upload stream, then push `Begin → Chunk* → End` binary frames the server
 * writes to the target path.
 */

/** Matches the server's default chunk size (`FileTransferService` DEFAULT_CHUNK_BYTES). */
const UPLOAD_CHUNK_BYTES = 32 * 1024;

/**
 * Upload pacing: `upload` waits before each chunk while the transport reports more than this many
 * unsent bytes, so the socket queue stays within this plus one chunk. 1 MiB (32 chunks) is a
 * chosen value, not a measured one — big enough to keep a fast link busy across a poll interval,
 * small enough that a stalled link holds little memory and a cancel takes effect quickly.
 */
export const UPLOAD_HIGH_WATER_BYTES = 1024 * 1024;

/** How often `upload` re-reads the transport's buffered amount while it is congested. */
const UPLOAD_POLL_MS = 10;

/** What `FileTransferClient.upload` can stream from. */
export type UploadSource = Uint8Array | Blob | AsyncIterable<Uint8Array>;

export interface UploadOptions {
  /** Called after each chunk is queued; `sent` is cumulative, `total` is unknown (`undefined`) for an async iterable. */
  onProgress?(sent: number, total?: number): void;
  /** Aborting sends an `Error` frame for the stream and rejects `upload` with an `AbortError`. */
  signal?: AbortSignal;
}

export interface FileTransferClientOptions {
  /** Override {@link UPLOAD_HIGH_WATER_BYTES} (tests). */
  highWaterBytes?: number;
  /** Override the pacing timer (tests); resolves after `ms`. */
  sleep?(ms: number): Promise<void>;
}

/** What a download reports besides its bytes, as announced by the daemon's `Begin` frame. */
export interface DownloadResult {
  fileName?: string;
  mimeType?: string;
  /** The whole file's size when the transfer began — not the range's. */
  totalBytes: number;
  /** The file's modification time (ms) when the transfer began. */
  mtimeMs: number;
  /** First byte of the range, as served. */
  offset: number;
  /** Bytes in the range, as served (clamped to the end of the file). */
  length: number;
}

/** `FileTransferClient.download`'s result: the range's bytes plus {@link DownloadResult}. */
export interface DownloadedFile extends DownloadResult {
  bytes: Uint8Array;
}

export interface DownloadOptions {
  /** First byte to read; default 0. */
  offset?: number;
  /** Bytes to read from `offset`; default (and cap) is to the end of the file. */
  length?: number;
  /** Refuse (`changed`) unless the file still has this size and modification time. */
  ifUnchanged?: { size: number; mtimeMs: number };
  /** Aborting sends a cancel request for the stream and rejects with an `AbortError`. */
  signal?: AbortSignal;
  /** After each chunk: bytes received so far in this range, and the range's length. */
  onProgress?(received: number, length: number): void;
}

type FileTransferBeginMeta = Extract<FileTransferFrame, { opcode: "Begin" }>["meta"];

/** The message of the rejection when the daemon predates ranged downloads. */
const RANGES_UNSUPPORTED =
  "This daemon does not support file downloads by path and range (feature fileDownloadRanges): update the daemon.";

interface PendingDownload {
  sink: (chunk: Uint8Array) => void;
  onProgress: ((received: number, length: number) => void) | undefined;
  /** Set by `Begin`. */
  info: DownloadResult | undefined;
  received: number;
  progressed: boolean;
  /** The caller has its answer; the id is still held until the daemon is done with it. */
  settled: boolean;
  detachAbort: (() => void) | null;
  resolve: (result: DownloadResult) => void;
  reject: (error: Error) => void;
}

interface DownloadRequestResponse {
  ok: boolean;
  error?: string;
}

interface DownloadCancelResponse {
  ok: boolean;
  error?: string;
}

interface UploadRequestResponse {
  ok: boolean;
  stream?: number;
  error?: string;
}

/** One in-flight `upload`: a promise that rejects at the first failure (abort, drop, daemon error). */
interface UploadRun {
  readonly failure: Promise<never>;
  fail(error: Error): void;
  /** Throws the recorded failure, if any. */
  check(): void;
}

function createRun(): UploadRun {
  // `new Promise`, not `Promise.withResolvers`: this SDK ships to browsers and React Native
  // runtimes older than ES2024 (and compiles with `lib: ES2023`).
  let reject!: (error: Error) => void;
  const promise = new Promise<never>((_, rej) => {
    reject = rej;
  });
  promise.catch(() => {}); // only ever raced: never an unhandled rejection
  let failed: Error | undefined;
  return {
    failure: promise,
    fail(error) {
      if (failed) return;
      failed = error;
      reject(error);
    },
    check() {
      if (failed) throw failed;
    },
  };
}

function abortError(what: "upload" | "download"): DOMException {
  return new DOMException(`The ${what} was aborted`, "AbortError");
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** `Begin`'s range metadata, or null when the daemon left a field out. */
function downloadResult(meta: FileTransferBeginMeta): DownloadResult | null {
  const { fileName, mimeType, totalBytes, mtimeMs, offset, length } = meta;
  if (
    totalBytes === undefined ||
    mtimeMs === undefined ||
    offset === undefined ||
    length === undefined
  ) {
    return null;
  }
  return {
    ...(fileName === undefined ? {} : { fileName }),
    ...(mimeType === undefined ? {} : { mimeType }),
    totalBytes,
    mtimeMs,
    offset,
    length,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function* sliceBytes(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < bytes.length; offset += UPLOAD_CHUNK_BYTES) {
    yield bytes.subarray(offset, offset + UPLOAD_CHUNK_BYTES);
  }
}

/** Reads one chunk at a time — the whole file is never in memory. */
async function* sliceBlob(blob: Blob): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < blob.size; offset += UPLOAD_CHUNK_BYTES) {
    yield new Uint8Array(await blob.slice(offset, offset + UPLOAD_CHUNK_BYTES).arrayBuffer());
  }
}

/** Re-cuts whatever the iterable yields into chunks of at most `UPLOAD_CHUNK_BYTES`. */
async function* splitItems(items: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
  for await (const item of items) yield* sliceBytes(item);
}

function uploadChunks(source: UploadSource): {
  total: number | undefined;
  chunks: AsyncIterable<Uint8Array>;
} {
  if (source instanceof Uint8Array) return { total: source.length, chunks: sliceBytes(source) };
  if (typeof Blob !== "undefined" && source instanceof Blob) {
    return { total: source.size, chunks: sliceBlob(source) };
  }
  return { total: undefined, chunks: splitItems(source as AsyncIterable<Uint8Array>) };
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
  /** Present only while a download is pending: rejects them when the connection leaves `open`. */
  private detachState: (() => void) | null = null;
  private readonly uploads = new Set<UploadRun>();
  private readonly highWaterBytes: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly daemon: DaemonClient,
    options: FileTransferClientOptions = {},
  ) {
    this.highWaterBytes = options.highWaterBytes ?? UPLOAD_HIGH_WATER_BYTES;
    this.sleep = options.sleep ?? defaultSleep;
  }

  /** Uploads that have not settled yet (0 once every upload has resolved, rejected, or been aborted). */
  get pendingUploads(): number {
    return this.uploads.size;
  }

  /**
   * Downloads still holding a stream id: in flight, or aborted and waiting for the daemon's last
   * frame. 0 once every download has finished and the daemon is done with its stream.
   */
  get pendingDownloads(): number {
    return this.pending.size;
  }

  /** Begin routing inbound file-transfer frames. Idempotent. */
  start(): void {
    if (this.detach) return;
    this.detach = this.daemon.onFileTransferFrame((frame) => this.dispatch(frame));
  }

  /** Stop routing inbound frames. Any downloads and uploads still pending are rejected. */
  stop(): void {
    this.detach?.();
    this.detach = null;
    this.failDownloads(new Error("file transfer router stopped"));
    for (const run of this.uploads) run.fail(new Error("file transfer router stopped"));
  }

  /**
   * Download a byte range of the file at `path` into `sink`, which is called once per `Chunk` in
   * wire order. The client keeps no reference to a chunk after the call, so memory stays at about
   * one chunk however large the range is. With no `offset`/`length` the whole file is requested.
   *
   * - **`sink` is synchronous.** Frames are handled in arrival order on the transport's delivery
   *   path, so the sink cannot make the daemon wait. A consumer that must wait (writing to disk)
   *   has to buffer, or pace itself by asking for ranges one after the other. A sink (or
   *   `onProgress`) that throws aborts the download: the daemon is told to stop and this rejects
   *   with that error.
   * - **Resolves** after `End` with the range's metadata, taken from the `Begin` frame:
   *   `{ fileName?, mimeType?, totalBytes, mtimeMs, offset, length }`. `totalBytes`/`mtimeMs`
   *   describe the whole file when the transfer began; keep them to resume with `ifUnchanged`.
   * - **`onProgress(received, length)`** fires after every chunk with the bytes received so far in
   *   this range (monotonic) and the range length; it ends at `length`.
   * - **Rejects** with the daemon's error code when the request is refused (`not_found`,
   *   `changed`, `stream_in_use`, …), with the `Error` frame's message (`read_failed`, `changed`,
   *   `cancelled`) when the transfer fails midway, and when the connection closes or {@link stop}
   *   is called. It rejects before sending anything when the daemon did not advertise
   *   `fileDownloadRanges`.
   * - **Abort.** `signal` aborting rejects with an `AbortError` and sends
   *   `file_download_cancel_request { stream }`. The stream id is held until the daemon has said
   *   nothing more will arrive on it (a terminal frame, or a refusal), so a late frame can never
   *   reach a later download that reuses the id; frames that do arrive meanwhile are ignored.
   *
   * The stream id is registered BEFORE the request is sent: the daemon answers first and streams
   * right after, and a frame for an unregistered id would be dropped.
   */
  async downloadTo(
    path: string,
    sink: (chunk: Uint8Array) => void,
    options: DownloadOptions = {},
  ): Promise<DownloadResult> {
    const { offset, length, ifUnchanged, signal, onProgress } = options;
    if (!this.daemon.hasFeature("fileDownloadRanges")) throw new Error(RANGES_UNSUPPORTED);
    if (signal?.aborted) throw abortError("download");
    if (this.daemon.state !== "open") throw new Error("connection is not open");

    // Stream ids live in a single frame-header byte, so they are recycled as transfers finish;
    // an ever-incrementing counter would emit 256 and be rejected by the codec from then on.
    const stream = nextFreeSlot(this.pending, this.streamCursor);
    if (stream === null) throw new Error("no free download stream");
    this.streamCursor = (stream + 1) % SLOT_SPACE;

    return await new Promise<DownloadResult>((resolve, reject) => {
      const entry: PendingDownload = {
        sink,
        onProgress,
        info: undefined,
        received: 0,
        progressed: false,
        settled: false,
        detachAbort: null,
        resolve,
        reject,
      };
      this.pending.set(stream, entry);
      this.watchConnection();
      if (signal) {
        const onAbort = (): void => this.abortDownload(stream, entry, abortError("download"));
        signal.addEventListener("abort", onAbort, { once: true });
        entry.detachAbort = () => signal.removeEventListener("abort", onAbort);
      }

      // The response only says yes or no: the range metadata arrives in-band on `Begin`, which
      // may be dispatched before this continuation runs.
      this.daemon
        .request<DownloadRequestResponse>("file_download_request", {
          path,
          stream,
          offset,
          length,
          ifUnchanged,
        })
        .then(
          (response) => {
            if (response.ok) return;
            // A refused request streams nothing, so nothing else would free the id.
            this.finish(entry, { error: new Error(response.error ?? "download request failed") });
            this.release(stream, entry);
          },
          (error: unknown) => {
            // Timed out or socket killed: no frame will ever release the id.
            this.finish(entry, { error: asError(error) });
            this.release(stream, entry);
          },
        );
    });
  }

  /**
   * Download the file at `path` (or the range in `options`) into one buffer: {@link downloadTo}
   * collecting the chunks. Prefer `downloadTo` for anything large.
   */
  async download(path: string, options: DownloadOptions = {}): Promise<DownloadedFile> {
    const chunks: Uint8Array[] = [];
    const result = await this.downloadTo(
      path,
      (chunk) => {
        chunks.push(chunk);
      },
      options,
    );
    return { ...result, bytes: concat(chunks) };
  }

  /** Settle a download for its caller, once. The stream id is released separately. */
  private finish(
    entry: PendingDownload,
    outcome: { error: Error } | { result: DownloadResult },
  ): void {
    if (entry.settled) return;
    entry.settled = true;
    entry.detachAbort?.();
    entry.detachAbort = null;
    if ("error" in outcome) entry.reject(outcome.error);
    else entry.resolve(outcome.result);
  }

  /** Give a download's stream id back — only if it still belongs to `entry`. */
  private release(stream: number, entry: PendingDownload): void {
    if (this.pending.get(stream) !== entry) return;
    this.pending.delete(stream);
    if (this.pending.size === 0) this.unwatchConnection();
  }

  /**
   * Reject a download now and tell the daemon to stop it. The id stays claimed until the daemon
   * has nothing more to send on it: a terminal frame (see `dispatch`), a refused request, or a
   * `not_found` cancel (nothing active — whatever it sent is already behind us on the socket).
   */
  private abortDownload(stream: number, entry: PendingDownload, error: Error): void {
    if (entry.settled) return;
    this.finish(entry, { error });
    if (this.daemon.state !== "open") {
      this.release(stream, entry);
      return;
    }
    void this.daemon
      .request<DownloadCancelResponse>("file_download_cancel_request", { stream })
      .then(
        (response) => {
          if (!response.ok) this.release(stream, entry);
        },
        () => this.release(stream, entry),
      );
  }

  /** Reject every download and free every id (stop, or the connection is gone). */
  private failDownloads(error: Error): void {
    const entries = [...this.pending.values()];
    this.pending.clear();
    this.unwatchConnection();
    for (const entry of entries) this.finish(entry, { error });
  }

  /** Watch the connection only while a download is pending, so an idle client holds no listener. */
  private watchConnection(): void {
    if (this.detachState) return;
    this.detachState = this.daemon.onStateChange((state) => {
      if (state !== "open") this.failDownloads(new Error(`connection ${state} during download`));
    });
  }

  private unwatchConnection(): void {
    this.detachState?.();
    this.detachState = null;
  }

  /**
   * Upload `source` to `path` on the daemon: requests an upload stream, then pushes
   * `Begin → Chunk* → End` binary frames the server writes to disk (creating parent dirs,
   * overwriting any existing file). The server keys the transfer by `transferId`, which the
   * `Begin` frame must echo.
   *
   * - **Streaming.** A `Blob` is sliced and read chunk by chunk and an async iterable is pulled one
   *   item at a time, so memory stays at about one chunk (plus the pacing window) regardless of the
   *   file size. `total` in `onProgress` is the byte length for a `Uint8Array`/`Blob` and
   *   `undefined` for an async iterable.
   * - **Pacing.** Before each chunk it waits while `transport.bufferedAmount` is above
   *   {@link UPLOAD_HIGH_WATER_BYTES}; a transport that does not report it is never congested.
   * - **Completion.** With the daemon's `fileTransferAck` feature it resolves when the matching
   *   `file_upload_complete` push arrives and rejects with the daemon's error when `ok` is false;
   *   there is no timeout on that wait. Without it, it resolves once the transport's buffer has
   *   drained after `End` (the bytes have left this machine, not necessarily reached the disk).
   * - **Cancel.** `signal` aborting sends an `Error` frame for the stream (so the daemon frees it)
   *   and rejects with an `AbortError`. A dropped connection or {@link stop} rejects too.
   *   Whatever way it ends, no listener or stream is left behind.
   */
  async upload(path: string, source: UploadSource, options: UploadOptions = {}): Promise<void> {
    const { onProgress, signal } = options;
    if (signal?.aborted) throw abortError("upload");

    const run = createRun();
    this.uploads.add(run);
    const cleanups: Array<() => void> = [];
    let stream: number | undefined;
    let endSent = false;
    let daemonDone = false;
    try {
      if (signal) {
        const onAbort = (): void => run.fail(abortError("upload"));
        signal.addEventListener("abort", onAbort, { once: true });
        cleanups.push(() => signal.removeEventListener("abort", onAbort));
      }
      cleanups.push(
        this.daemon.onStateChange((state) => {
          if (state !== "open") run.fail(new Error(`connection ${state} during upload`));
        }),
      );
      if (this.daemon.state !== "open") throw new Error("connection is not open");

      const transferId = randomId();
      const ack = this.daemon.hasFeature("fileTransferAck");
      const request = this.daemon.request<UploadRequestResponse>("file_upload_request", {
        path,
        transferId,
        ...(ack ? { ack: true } : {}),
      });
      let response: UploadRequestResponse;
      try {
        response = await Promise.race([request, run.failure]);
      } catch (error) {
        // The daemon may still answer and hand out a stream nobody will use — give it back.
        void request.then(
          (late) => {
            if (late.ok && late.stream !== undefined)
              this.sendUploadError(late.stream, "client_error");
          },
          () => {},
        );
        throw error;
      }
      if (!response.ok || response.stream === undefined) {
        throw new Error(response.error ?? "upload request failed");
      }
      stream = response.stream;

      // Registered before any frame is sent, so an early failure (or the final ack) cannot be missed.
      let complete!: () => void;
      const completed = new Promise<void>((resolve) => {
        complete = resolve;
      });
      if (ack) {
        cleanups.push(
          this.daemon.onSessionMessage((message) => {
            if (message.type !== "file_upload_complete" || message.transferId !== transferId)
              return;
            daemonDone = true; // the daemon freed the stream: nothing left for us to cancel
            if (message.ok) complete();
            else run.fail(new Error(message.error ?? "upload failed"));
          }),
        );
      }

      this.daemon.sendBinary(
        encodeFileTransferFrame({ opcode: "Begin", stream, meta: { transferId } }),
      );
      const { total, chunks } = uploadChunks(source);
      const iterator = chunks[Symbol.asyncIterator]();
      cleanups.push(() => {
        void Promise.resolve(iterator.return?.()).catch(() => {});
      });
      let sent = 0;
      for (;;) {
        await this.waitWhile(() => (this.daemon.bufferedAmount ?? 0) > this.highWaterBytes, run);
        const next = iterator.next();
        next.catch(() => {}); // if the race below is lost to a failure, `next` must not go unhandled
        const step = await Promise.race([next, run.failure]);
        if (step.done) break;
        run.check();
        this.daemon.sendBinary(
          encodeFileTransferFrame({ opcode: "Chunk", stream, data: step.value }),
        );
        sent += step.value.length;
        onProgress?.(sent, total);
      }
      if (sent === 0) onProgress?.(0, total);

      run.check();
      this.daemon.sendBinary(encodeFileTransferFrame({ opcode: "End", stream, ok: true }));
      endSent = true;
      if (ack) await Promise.race([completed, run.failure]);
      else await this.waitWhile(() => (this.daemon.bufferedAmount ?? 0) > 0, run);
    } catch (error) {
      // Before `End` the daemon still holds the stream and an open file; tell it to let go.
      if (stream !== undefined && !endSent && !daemonDone) {
        this.sendUploadError(stream, isAbortError(error) ? "client_aborted" : "client_error");
      }
      throw error;
    } finally {
      for (const cleanup of cleanups) cleanup();
      this.uploads.delete(run);
    }
  }

  /** Poll `condition` on a timer until it clears, giving up as soon as the upload has failed. */
  private async waitWhile(condition: () => boolean, run: UploadRun): Promise<void> {
    while (condition()) {
      run.check();
      await Promise.race([this.sleep(UPLOAD_POLL_MS), run.failure]);
    }
  }

  /** Best-effort `Error` frame for an upload stream; a dead connection has nothing to tell. */
  private sendUploadError(stream: number, message: string): void {
    if (this.daemon.state !== "open") return;
    try {
      this.daemon.sendBinary(encodeFileTransferFrame({ opcode: "Error", stream, message }));
    } catch {
      /* the socket died under us — the daemon frees the stream when it notices */
    }
  }

  private dispatch(frame: FileTransferFrame): void {
    const entry = this.pending.get(frame.stream);
    if (!entry) return; // not a download stream we're tracking (e.g. an upload) — ignore
    // Everything below runs synchronously and in arrival order (see `transport.ts`): a frame that
    // is handled later than its successors is a truncated download.
    switch (frame.opcode) {
      case "Begin": {
        if (entry.settled) return;
        const info = downloadResult(frame.meta);
        if (!info) {
          this.abortDownload(
            frame.stream,
            entry,
            new Error("daemon sent a Begin frame without the range"),
          );
          return;
        }
        entry.info = info;
        return;
      }
      case "Chunk": {
        if (entry.settled) return; // aborted: the daemon may still have frames in flight
        const { info } = entry;
        if (!info) {
          this.abortDownload(frame.stream, entry, new Error("daemon sent a Chunk before Begin"));
          return;
        }
        try {
          entry.sink(frame.data);
          entry.received += frame.data.length;
          entry.progressed = true;
          entry.onProgress?.(entry.received, info.length);
        } catch (error) {
          this.abortDownload(frame.stream, entry, asError(error));
        }
        return;
      }
      case "End": {
        this.release(frame.stream, entry);
        if (entry.settled) return;
        const { info } = entry;
        if (!frame.ok) {
          this.finish(entry, { error: new Error("download failed") });
        } else if (!info) {
          this.finish(entry, { error: new Error("download ended before Begin") });
        } else if (entry.received !== info.length) {
          this.finish(entry, {
            error: new Error(`download ended after ${entry.received} of ${info.length} bytes`),
          });
        } else {
          try {
            // An empty range sends no `Chunk`; progress still ends at `length`.
            if (!entry.progressed) entry.onProgress?.(0, info.length);
          } catch (error) {
            this.finish(entry, { error: asError(error) });
            return;
          }
          this.finish(entry, { result: info });
        }
        return;
      }
      case "Error":
        this.release(frame.stream, entry);
        this.finish(entry, { error: new Error(frame.message) });
        return;
    }
  }
}
