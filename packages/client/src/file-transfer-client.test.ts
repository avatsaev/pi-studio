import { describe, expect, it, vi } from "vitest";

import { decodeFileTransferFrame, encodeFileTransferFrame } from "@av-pi-studio/protocol";

import { DaemonClient } from "./daemon-client.js";
import { FileTransferClient } from "./file-transfer-client.js";
import type { Transport } from "./transport.js";

interface FakeTransport {
  transport: Transport;
  sentText: string[];
  sentBinary: Uint8Array[];
  push: (data: string) => void;
  pushBinary: (bytes: Uint8Array) => void;
  /** Called synchronously inside `sendText` for every session message the client sends. */
  hooks: { onSession?: (message: SentMessage) => void };
}

function makeFakeTransport(features: Record<string, boolean> = {}): FakeTransport {
  const sentText: string[] = [];
  const sentBinary: Uint8Array[] = [];
  const hooks: FakeTransport["hooks"] = {};
  const transport: Transport = {
    onMessage: null,
    onClose: null,
    onError: null,
    get isOpen() {
      return true;
    },
    connect: () => {
      return Promise.resolve();
    },
    sendText: (data) => {
      sentText.push(data);
      const parsed = JSON.parse(data) as { type?: string; message?: SentMessage };
      if (parsed.type === "hello") {
        queueMicrotask(() =>
          transport.onMessage?.(
            JSON.stringify({
              type: "status",
              payload: { status: "server_info", serverId: "srv-1", capabilities: {}, features },
            }),
          ),
        );
      } else if (parsed.type === "session" && parsed.message) {
        hooks.onSession?.(parsed.message);
      }
    },
    sendBinary: (data) => {
      sentBinary.push(data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer));
    },
    close: () => {},
  };
  return {
    transport,
    sentText,
    sentBinary,
    hooks,
    push: (data) => transport.onMessage?.(data),
    pushBinary: (bytes) =>
      transport.onMessage?.(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      ),
  };
}

function makeClient(transport: Transport): DaemonClient {
  return new DaemonClient({
    url: "ws://t/ws",
    clientId: "c1",
    clientType: "cli",
    transport,
    rpcTimeoutMs: 0,
  });
}

/** Pulls the requestId the client generated for its Nth-from-end sent session message. */
function lastRequestId(sentText: string[]): string {
  const sent = JSON.parse(sentText.at(-1)!) as { message: { requestId: string } };
  return sent.message.requestId;
}

/** A session message the client sent. */
interface SentMessage {
  type: string;
  requestId: string;
  path?: string;
  stream?: number;
  offset?: number;
  length?: number;
  ifUnchanged?: { size: number; mtimeMs: number };
}

function sessionMessages(fake: { sentText: string[] }): SentMessage[] {
  return fake.sentText
    .map((text) => JSON.parse(text) as { type: string; message?: SentMessage })
    .flatMap((envelope) =>
      envelope.type === "session" && envelope.message ? [envelope.message] : [],
    );
}

function lastSent(fake: { sentText: string[] }): SentMessage {
  return sessionMessages(fake).at(-1)!;
}

/** Drain queued microtasks — the client's RPC plumbing is promise-based, never timer-based. */
async function drain(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

interface Rig {
  fake: FakeTransport;
  client: DaemonClient;
  transfer: FileTransferClient;
}

async function makeRig(
  features: Record<string, boolean> = { fileDownloadRanges: true },
): Promise<Rig> {
  const fake = makeFakeTransport(features);
  const client = makeClient(fake.transport);
  await client.connect();
  const transfer = new FileTransferClient(client);
  transfer.start();
  return { fake, client, transfer };
}

/** The range the daemon says it serves. */
interface Served {
  totalBytes: number;
  mtimeMs: number;
  offset: number;
  length: number;
}

const MTIME = 1_700_000_000_123;

function served(offset: number, length: number, totalBytes = offset + length): Served {
  return { totalBytes, mtimeMs: MTIME, offset, length };
}

function reply(fake: FakeTransport, request: SentMessage, type: string, fields: object): void {
  fake.push(
    JSON.stringify({ type: "session", message: { type, requestId: request.requestId, ...fields } }),
  );
}

/** The daemon accepts `request`: the response goes out first, then `Begin`. */
function accept(fake: FakeTransport, request: SentMessage, range: Served): void {
  const stream = request.stream!;
  reply(fake, request, "file_download_response", {
    ok: true,
    stream,
    transferId: "dl",
    ...range,
  });
  fake.pushBinary(
    encodeFileTransferFrame({
      opcode: "Begin",
      stream,
      meta: { transferId: "dl", fileName: "photo.png", mimeType: "image/png", ...range },
    }),
  );
}

function chunk(fake: FakeTransport, stream: number, data: Uint8Array): void {
  fake.pushBinary(encodeFileTransferFrame({ opcode: "Chunk", stream, data }));
}

function end(fake: FakeTransport, stream: number): void {
  fake.pushBinary(encodeFileTransferFrame({ opcode: "End", stream, ok: true }));
}

/** Serve `bytes` as one range, in chunks of `chunkSize`. */
function serve(
  fake: FakeTransport,
  request: SentMessage,
  bytes: Uint8Array,
  range: Served = served(request.offset ?? 0, bytes.length),
  chunkSize = 3,
): void {
  accept(fake, request, range);
  for (let at = 0; at < bytes.length; at += chunkSize) {
    chunk(fake, request.stream!, bytes.subarray(at, at + chunkSize));
  }
  end(fake, request.stream!);
}

describe("FileTransferClient — download", () => {
  it("requests the download by path and assembles Begin→Chunk*→End into one buffer", async () => {
    const { fake, transfer } = await makeRig();

    const downloadPromise = transfer.download("/tmp/photo.png");

    const request = lastSent(fake);
    expect(request).toMatchObject({ type: "file_download_request", path: "/tmp/photo.png" });
    expect(request.stream).toBeGreaterThanOrEqual(0);
    expect(request.offset).toBeUndefined();
    expect(request.length).toBeUndefined();
    serve(fake, request, new Uint8Array([1, 2, 3, 4, 5]));

    const file = await downloadPromise;
    expect(Array.from(file.bytes)).toEqual([1, 2, 3, 4, 5]);
    expect(file).toMatchObject({
      fileName: "photo.png",
      mimeType: "image/png",
      totalBytes: 5,
      mtimeMs: MTIME,
      offset: 0,
      length: 5,
    });
    expect(sessionMessages(fake).map((m) => m.type)).toEqual(["file_download_request"]);
  });

  it("returns exactly the requested range, with the file's totals and the offset served", async () => {
    const { fake, transfer } = await makeRig();
    const ifUnchanged = { size: 100, mtimeMs: MTIME };

    const downloadPromise = transfer.download("/tmp/big.bin", {
      offset: 10,
      length: 4,
      ifUnchanged,
    });

    const request = lastSent(fake);
    expect(request).toMatchObject({ offset: 10, length: 4, ifUnchanged });
    serve(fake, request, new Uint8Array([11, 12, 13, 14]), served(10, 4, 100));

    const file = await downloadPromise;
    expect(Array.from(file.bytes)).toEqual([11, 12, 13, 14]);
    expect(file).toMatchObject({ totalBytes: 100, mtimeMs: MTIME, offset: 10, length: 4 });
  });

  it("registers the stream before it sends the request, so a fast daemon's frames are not lost", async () => {
    // The daemon answers first and streams right after; here everything is delivered while
    // `sendText` is still on the stack, before the client could have registered anything after it.
    const { fake, transfer } = await makeRig();
    fake.hooks.onSession = (request) => {
      if (request.type === "file_download_request") serve(fake, request, new Uint8Array([7, 8]));
    };

    const file = await transfer.download("/tmp/fast.bin");

    expect(Array.from(file.bytes)).toEqual([7, 8]);
  });

  it("hands each chunk to the sink in wire order and keeps none: several MiB through a discarding sink", async () => {
    const { fake, transfer } = await makeRig();
    const CHUNK = 32 * 1024;
    const COUNT = 256; // 8 MiB
    const total = CHUNK * COUNT;
    let nextIndex = 0;
    let bytes = 0;
    let outOfOrder = 0;
    const progress: Array<[number, number]> = [];

    const downloadPromise = transfer.downloadTo(
      "/tmp/huge.bin",
      (data) => {
        if (data[0] !== nextIndex % 251) outOfOrder++;
        nextIndex++;
        bytes += data.length;
      },
      { onProgress: (received, length) => progress.push([received, length]) },
    );
    const request = lastSent(fake);
    accept(fake, request, served(0, total));
    for (let i = 0; i < COUNT; i++)
      chunk(fake, request.stream!, new Uint8Array(CHUNK).fill(i % 251));
    end(fake, request.stream!);

    const result = await downloadPromise;
    expect(result).toMatchObject({ totalBytes: total, offset: 0, length: total });
    expect(nextIndex).toBe(COUNT);
    expect(outOfOrder).toBe(0);
    expect(bytes).toBe(total);
    expect(transfer.pendingDownloads).toBe(0);
    expect(progress).toHaveLength(COUNT);
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]![0]).toBeGreaterThan(progress[i - 1]![0]);
    }
    expect(progress.at(-1)).toEqual([total, total]);
  });

  it("reports progress ending at the length, including (0, 0) for an empty range", async () => {
    const { fake, transfer } = await makeRig();
    const progress: Array<[number, number]> = [];

    const downloadPromise = transfer.download("/tmp/empty.bin", {
      onProgress: (received, length) => progress.push([received, length]),
    });
    serve(fake, lastSent(fake), new Uint8Array(0));

    expect((await downloadPromise).bytes).toHaveLength(0);
    expect(progress).toEqual([[0, 0]]);
  });

  it("rejects when the transfer ends short of the range it announced", async () => {
    const { fake, transfer } = await makeRig();

    const downloadPromise = transfer.download("/tmp/short.bin");
    const request = lastSent(fake);
    accept(fake, request, served(0, 10));
    chunk(fake, request.stream!, new Uint8Array(4));
    end(fake, request.stream!);

    await expect(downloadPromise).rejects.toThrow("download ended after 4 of 10 bytes");
    expect(transfer.pendingDownloads).toBe(0);
  });

  it("rejects on an Error frame with its message and frees the id", async () => {
    const { fake, transfer } = await makeRig();

    const downloadPromise = transfer.download("/tmp/gone.png");
    const request = lastSent(fake);
    accept(fake, request, served(0, 10));
    fake.pushBinary(
      encodeFileTransferFrame({ opcode: "Error", stream: request.stream!, message: "read_failed" }),
    );

    await expect(downloadPromise).rejects.toThrow("read_failed");
    expect(transfer.pendingDownloads).toBe(0);
  });

  it.each(["not_found", "changed", "stream_in_use", "range_not_satisfiable"])(
    "rejects with the daemon's code when the request is refused (%s) and leaves nothing pending",
    async (code) => {
      const { fake, transfer } = await makeRig();

      const downloadPromise = transfer.download("/tmp/x.bin");
      reply(fake, lastSent(fake), "file_download_response", { ok: false, error: code });

      await expect(downloadPromise).rejects.toThrow(code);
      expect(transfer.pendingDownloads).toBe(0);
    },
  );

  it("recycles stream ids so a long-lived connection never emits one past 255", async () => {
    // The stream id is a single frame-header byte. `nextStream++` handed out 256 on the 256th
    // download of a session and every download after that died in the codec.
    const { fake, transfer } = await makeRig();

    for (let i = 0; i < 300; i++) {
      const downloadPromise = transfer.download(`/tmp/f-${i}.bin`);
      const request = lastSent(fake);
      expect(request.stream).toBeGreaterThanOrEqual(0);
      expect(request.stream).toBeLessThan(256);
      serve(fake, request, new Uint8Array(0));
      await downloadPromise;
    }
  });

  it("releases the stream id when the download request never completes", async () => {
    // A refused request streams no `End`, so nothing else frees the id — without an explicit
    // release, 256 failures would exhaust the pool for the life of the connection.
    const { fake, transfer } = await makeRig();

    for (let i = 0; i < 300; i++) {
      const downloadPromise = transfer.download(`/tmp/f-${i}.bin`);
      reply(fake, lastSent(fake), "rpc_error", { code: "handler_error", message: "boom" });
      await expect(downloadPromise).rejects.toThrow("boom");
    }
    expect(transfer.pendingDownloads).toBe(0);
  });

  it("rejects without sending anything when the daemon lacks fileDownloadRanges", async () => {
    const { fake, transfer } = await makeRig({});
    const sink = vi.fn();

    const whole = transfer.download("/tmp/photo.png");
    const ranged = transfer.downloadTo("/tmp/photo.png", sink, { offset: 5 });

    for (const attempt of [whole, ranged]) {
      await expect(attempt).rejects.toThrow(/fileDownloadRanges/);
      await expect(attempt).rejects.toThrow(/update the daemon/i);
    }
    expect(sessionMessages(fake)).toEqual([]);
    expect(fake.sentBinary).toEqual([]);
    expect(sink).not.toHaveBeenCalled();
    expect(transfer.pendingDownloads).toBe(0);
  });

  it("rejects an already-aborted signal without sending anything", async () => {
    const { fake, transfer } = await makeRig();

    await expect(
      transfer.download("/tmp/a.bin", { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(sessionMessages(fake)).toEqual([]);
  });

  it("rejects the in-flight downloads when the connection drops, and when the router stops", async () => {
    const { fake, transfer } = await makeRig();

    const dropped = transfer.download("/tmp/a.bin");
    const droppedRequest = lastSent(fake);
    accept(fake, droppedRequest, served(0, 10));
    chunk(fake, droppedRequest.stream!, new Uint8Array(4));
    fake.transport.onClose?.(1006, "link lost");

    await expect(dropped).rejects.toThrow(/connection closed/);
    expect(transfer.pendingDownloads).toBe(0);

    const { transfer: other, fake: otherFake } = await makeRig();
    const stopped = other.download("/tmp/b.bin");
    accept(otherFake, lastSent(otherFake), served(0, 10));
    other.stop();

    await expect(stopped).rejects.toThrow("file transfer router stopped");
    expect(other.pendingDownloads).toBe(0);
  });

  describe("abort", () => {
    it("rejects with AbortError, sends the cancel request, and frees the id once the daemon is done", async () => {
      const { fake, transfer } = await makeRig();
      const controller = new AbortController();
      const sink = vi.fn();

      const downloadPromise = transfer.downloadTo("/tmp/a.bin", sink, {
        signal: controller.signal,
      });
      const request = lastSent(fake);
      accept(fake, request, served(0, 10));
      chunk(fake, request.stream!, new Uint8Array(4));
      expect(sink).toHaveBeenCalledTimes(1);

      controller.abort();

      const rejection = await downloadPromise.catch((error: unknown) => error);
      expect(rejection).toBeInstanceOf(DOMException);
      expect(rejection).toMatchObject({ name: "AbortError" });
      const cancel = lastSent(fake);
      expect(cancel).toMatchObject({
        type: "file_download_cancel_request",
        stream: request.stream,
      });

      // Frames the daemon already had in flight are ignored…
      chunk(fake, request.stream!, new Uint8Array(4));
      expect(sink).toHaveBeenCalledTimes(1);
      // …and the id stays claimed (a reuse would receive them) until the daemon's last frame.
      expect(transfer.pendingDownloads).toBe(1);
      reply(fake, cancel, "file_download_cancel_response", { ok: true });
      fake.pushBinary(
        encodeFileTransferFrame({ opcode: "Error", stream: request.stream!, message: "cancelled" }),
      );
      await drain();
      expect(transfer.pendingDownloads).toBe(0);
    });

    it("frees the id at once when the daemon has nothing to cancel, so ids can be reused", async () => {
      const { fake, transfer } = await makeRig();

      for (let i = 0; i < 300; i++) {
        const controller = new AbortController();
        const downloadPromise = transfer.downloadTo(`/tmp/f-${i}.bin`, () => {}, {
          signal: controller.signal,
        });
        const request = lastSent(fake);
        expect(request.stream).toBeLessThan(256);
        controller.abort();
        await expect(downloadPromise).rejects.toMatchObject({ name: "AbortError" });
        reply(fake, lastSent(fake), "file_download_cancel_response", {
          ok: false,
          error: "not_found",
        });
        await drain();
        expect(transfer.pendingDownloads).toBe(0);
      }
    });

    it("aborting before the daemon has answered the request still ends cleanly", async () => {
      const { fake, transfer } = await makeRig();
      const controller = new AbortController();

      const downloadPromise = transfer.downloadTo("/tmp/a.bin", () => {}, {
        signal: controller.signal,
      });
      const request = lastSent(fake);
      controller.abort();
      await expect(downloadPromise).rejects.toMatchObject({ name: "AbortError" });
      const cancel = lastSent(fake);
      expect(cancel.type).toBe("file_download_cancel_request");

      // The daemon refuses the (by now moot) request, so no frame will ever release the id.
      reply(fake, request, "file_download_response", { ok: false, error: "not_found" });
      reply(fake, cancel, "file_download_cancel_response", { ok: true });
      await drain();
      expect(transfer.pendingDownloads).toBe(0);
    });

    it("a throwing sink aborts the download: it cancels the stream and rejects with the sink's error", async () => {
      const { fake, transfer } = await makeRig();
      let calls = 0;

      const downloadPromise = transfer.downloadTo("/tmp/a.bin", () => {
        calls++;
        throw new Error("disk full");
      });
      const request = lastSent(fake);
      accept(fake, request, served(0, 10));
      chunk(fake, request.stream!, new Uint8Array(4));
      chunk(fake, request.stream!, new Uint8Array(4));

      await expect(downloadPromise).rejects.toThrow("disk full");
      expect(calls).toBe(1);
      expect(lastSent(fake)).toMatchObject({
        type: "file_download_cancel_request",
        stream: request.stream,
      });
    });
  });
});

describe("FileTransferClient — upload", () => {
  it("requests an upload stream, then pushes Begin→Chunk*→End for the assigned stream", async () => {
    const fake = makeFakeTransport();
    const client = makeClient(fake.transport);
    await client.connect();
    const transfer = new FileTransferClient(client);
    transfer.start();

    // > one chunk (32 KiB) → multiple Chunk frames.
    const bytes = new Uint8Array(70_000).map((_, i) => i % 251);
    const uploadPromise = transfer.upload("/tmp/out.bin", bytes);

    const requestId = lastRequestId(fake.sentText);
    const request = JSON.parse(fake.sentText.at(-1)!) as {
      message: { type: string; path: string; transferId: string };
    };
    expect(request.message.type).toBe("file_upload_request");
    expect(request.message.path).toBe("/tmp/out.bin");
    const transferId = request.message.transferId;
    expect(transferId).toBeTruthy();

    fake.push(
      JSON.stringify({
        type: "session",
        message: { type: "file_upload_response", requestId, ok: true, stream: 7 },
      }),
    );

    await uploadPromise;

    const frames = fake.sentBinary.map((b) => decodeFileTransferFrame(b));
    expect(frames[0]).toMatchObject({ opcode: "Begin", stream: 7 });
    if (frames[0]?.opcode === "Begin") expect(frames[0].meta.transferId).toBe(transferId);
    expect(frames.at(-1)).toEqual({ opcode: "End", stream: 7, ok: true });
    const chunks = frames.filter(
      (f): f is Extract<typeof f, { opcode: "Chunk" }> => f.opcode === "Chunk",
    );
    expect(chunks.length).toBe(3); // 70000 / 32768 → 3 chunks
    const reassembled = chunks.flatMap((c) => Array.from(c.data));
    expect(reassembled).toEqual(Array.from(bytes));
  });

  it("rejects when the upload request is refused", async () => {
    const fake = makeFakeTransport();
    const client = makeClient(fake.transport);
    await client.connect();
    const transfer = new FileTransferClient(client);
    transfer.start();

    const uploadPromise = transfer.upload("", new Uint8Array([1]));
    const requestId = lastRequestId(fake.sentText);
    fake.push(
      JSON.stringify({
        type: "session",
        message: { type: "file_upload_response", requestId, ok: false, error: "missing_fields" },
      }),
    );

    await expect(uploadPromise).rejects.toThrow("missing_fields");
  });
});
