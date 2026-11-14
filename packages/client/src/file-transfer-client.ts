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

function abortError(): DOMException {
  return new DOMException("The upload was aborted", "AbortError");
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

  /** Begin routing inbound file-transfer frames. Idempotent. */
  start(): void {
    if (this.detach) return;
    this.detach = this.daemon.onFileTransferFrame((frame) => this.dispatch(frame));
  }

  /** Stop routing inbound frames. Any downloads and uploads still pending are rejected. */
  stop(): void {
    this.detach?.();
    this.detach = null;
    for (const [stream, pending] of this.pending) {
      pending.reject(new Error("file transfer router stopped"));
      this.pending.delete(stream);
    }
    for (const run of this.uploads) run.fail(new Error("file transfer router stopped"));
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
    if (signal?.aborted) throw abortError();

    const run = createRun();
    this.uploads.add(run);
    const cleanups: Array<() => void> = [];
    let stream: number | undefined;
    let endSent = false;
    let daemonDone = false;
    try {
      if (signal) {
        const onAbort = (): void => run.fail(abortError());
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
