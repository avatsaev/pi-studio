import { describe, expect, it, vi } from "vitest";

import { decodeFileTransferFrame, type FileTransferFrame } from "@av-pi-studio/protocol";

import { DaemonClient } from "./daemon-client.js";
import {
  FileTransferClient,
  UPLOAD_HIGH_WATER_BYTES,
  type FileTransferClientOptions,
} from "./file-transfer-client.js";
import type { Transport } from "./transport.js";

/**
 * Paced, cancellable, acknowledged `FileTransferClient.upload` (sprint-096/task-004) against a
 * fake transport whose `bufferedAmount` is scripted: every `sendBinary` adds the frame's bytes, and
 * the injected pacing `sleep` drains `drainPerSleep` of them (so "the link" only makes progress
 * when the client waits).
 */

const CHUNK = 32 * 1024;
const HIGH_WATER = 4 * CHUNK;

interface Rig {
  client: DaemonClient;
  files: FileTransferClient;
  /** Every session message the client sent, in order. */
  requests: Array<Record<string, unknown>>;
  frames: FileTransferFrame[];
  /** The largest `bufferedAmount` seen at any moment. */
  maxBuffered: () => number;
  buffered: () => number;
  sleeps: () => number;
  push: (message: Record<string, unknown>) => void;
  drop: () => void;
  /** Live `onSessionMessage` + `onStateChange` subscriptions held by the client. */
  listeners: () => number;
}

interface RigOptions {
  /** The daemon advertises `fileTransferAck`. */
  ack?: boolean;
  /** Bytes the scripted link drains per pacing sleep (0 = a stalled link). */
  drainPerSleep?: number;
  /** The transport has no `bufferedAmount` property at all. */
  unreportedBuffer?: boolean;
  /** The daemon client's RPC timeout in ms (default 0 = none). */
  rpcTimeoutMs?: number;
  client?: FileTransferClientOptions;
}

async function makeRig(opts: RigOptions = {}): Promise<Rig> {
  const requests: Array<Record<string, unknown>> = [];
  const frames: FileTransferFrame[] = [];
  let buffered = 0;
  let maxBuffered = 0;
  let sleeps = 0;
  const drainPerSleep = opts.drainPerSleep ?? 3 * CHUNK;

  const transport: Transport = {
    onMessage: null,
    onClose: null,
    onError: null,
    isOpen: true,
    connect: () => Promise.resolve(),
    sendText: (data) => {
      const envelope = JSON.parse(data) as { type: string; message?: Record<string, unknown> };
      if (envelope.type === "hello") {
        queueMicrotask(() =>
          transport.onMessage?.(
            JSON.stringify({
              type: "status",
              payload: {
                status: "server_info",
                serverId: "srv-1",
                capabilities: {},
                features: { fileTransferAck: opts.ack === true },
              },
            }),
          ),
        );
        return;
      }
      const message = envelope.message;
      if (envelope.type !== "session" || !message) return;
      requests.push(message);
      if (message.type === "file_upload_request") {
        queueMicrotask(() =>
          transport.onMessage?.(
            JSON.stringify({
              type: "session",
              message: {
                type: "file_upload_response",
                requestId: message.requestId,
                ok: true,
                stream: 9,
              },
            }),
          ),
        );
      }
    },
    sendBinary: (data) => {
      frames.push(decodeFileTransferFrame(data));
      buffered += data.length;
      maxBuffered = Math.max(maxBuffered, buffered);
    },
    close: () => {},
  };
  if (!opts.unreportedBuffer) {
    Object.defineProperty(transport, "bufferedAmount", { get: () => buffered });
  }

  const client = new DaemonClient({
    url: "ws://t/ws",
    clientId: "c1",
    clientType: "cli",
    transport,
    rpcTimeoutMs: opts.rpcTimeoutMs ?? 0,
  });
  await client.connect();

  let listeners = 0;
  const wrap = <H>(subscribe: (handler: H) => () => void): ((handler: H) => () => void) => {
    return (handler) => {
      listeners++;
      const off = subscribe(handler);
      return () => {
        listeners--;
        off();
      };
    };
  };
  client.onSessionMessage = wrap(client.onSessionMessage.bind(client));
  client.onStateChange = wrap(client.onStateChange.bind(client));

  const files = new FileTransferClient(client, {
    highWaterBytes: HIGH_WATER,
    sleep: async () => {
      sleeps++;
      buffered = Math.max(0, buffered - drainPerSleep);
      await Promise.resolve();
    },
    ...opts.client,
  });
  files.start();

  return {
    client,
    files,
    requests,
    frames,
    maxBuffered: () => maxBuffered,
    buffered: () => buffered,
    sleeps: () => sleeps,
    push: (message) => transport.onMessage?.(JSON.stringify({ type: "session", message })),
    drop: () => transport.onClose?.(1006, "link lost"),
    listeners: () => listeners,
  };
}

function patternBytes(length: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(length).map((_, i) => (i * 7 + 3) % 251);
}

function chunksOf(frames: FileTransferFrame[]): Uint8Array[] {
  return frames.flatMap((f) => (f.opcode === "Chunk" ? [f.data] : []));
}

/** Byte-for-byte equality without vitest's slow element-wise diff on megabyte buffers. */
function expectBytes(actual: Uint8Array, expected: Uint8Array): void {
  expect(Buffer.from(actual).equals(Buffer.from(expected))).toBe(true);
}

function joined(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** Let promise-based plumbing (and the fake's microtask sleeps) run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

function complete(
  rig: Rig,
  fields: { ok: boolean; error?: string; transferId?: string; bytesWritten?: number },
): void {
  const request = rig.requests.find((r) => r.type === "file_upload_request");
  rig.push({
    type: "file_upload_complete",
    transferId: fields.transferId ?? request?.transferId,
    stream: 9,
    ok: fields.ok,
    bytesWritten: fields.bytesWritten ?? 0,
    ...(fields.error === undefined ? {} : { error: fields.error }),
  });
}

describe("FileTransferClient.upload — pacing", () => {
  it("never queues more than the high-water mark plus one frame, for a source many times larger", async () => {
    const rig = await makeRig();
    const bytes = patternBytes(HIGH_WATER * 8 + 1234);

    await rig.files.upload("/tmp/big.bin", bytes);

    const largestFrame = Math.max(
      ...rig.frames.map((f) => (f.opcode === "Chunk" ? f.data.length : 0)),
    );
    expect(largestFrame).toBe(CHUNK);
    expect(rig.sleeps()).toBeGreaterThan(0); // the client really did wait
    // Before each send the buffer was <= HIGH_WATER, so after it: <= HIGH_WATER + one frame.
    expect(rig.maxBuffered()).toBeLessThanOrEqual(HIGH_WATER + CHUNK + 16);
    expectBytes(joined(chunksOf(rig.frames)), bytes);
    expect(rig.buffered()).toBe(0); // no-flag fallback waited for the buffer to empty
  });

  it("does not wait on a transport that does not report a buffered amount", async () => {
    const rig = await makeRig({ unreportedBuffer: true });
    const bytes = patternBytes(HIGH_WATER * 3);

    await rig.files.upload("/tmp/x.bin", bytes);

    expect(rig.sleeps()).toBe(0);
    expectBytes(joined(chunksOf(rig.frames)), bytes);
  });

  it("defaults the high-water mark to 1 MiB", () => {
    expect(UPLOAD_HIGH_WATER_BYTES).toBe(1024 * 1024);
  });
});

describe("FileTransferClient.upload — sources and progress", () => {
  it("reports monotonic progress ending at the total for a Uint8Array", async () => {
    const rig = await makeRig();
    const bytes = patternBytes(CHUNK * 5 + 17);
    const seen: Array<[number, number | undefined]> = [];

    await rig.files.upload("/tmp/a", bytes, {
      onProgress: (sent, total) => seen.push([sent, total]),
    });

    expect(seen.length).toBe(6);
    const sentSoFar = seen.map(([sent]) => sent);
    expect(sentSoFar).toEqual(sentSoFar.toSorted((a, b) => a - b));
    expect(new Set(seen.map(([, total]) => total))).toEqual(new Set([bytes.length]));
    expect(seen.at(-1)).toEqual([bytes.length, bytes.length]);
  });

  it("streams a Blob in chunk-sized slices and never reads the whole file at once", async () => {
    const rig = await makeRig();
    const bytes = patternBytes(CHUNK * 3 + 5);
    const blob = new Blob([bytes]);
    const sliceSizes: number[] = [];
    const slice = blob.slice.bind(blob);
    blob.slice = (start, end, type) => {
      const part = slice(start, end, type);
      sliceSizes.push(part.size);
      return part;
    };
    blob.arrayBuffer = () => Promise.reject(new Error("whole-file read"));
    const seen: Array<[number, number | undefined]> = [];

    await rig.files.upload("/tmp/b", blob, {
      onProgress: (sent, total) => seen.push([sent, total]),
    });

    expect(sliceSizes).toEqual([CHUNK, CHUNK, CHUNK, 5]);
    expectBytes(joined(chunksOf(rig.frames)), bytes);
    expect(seen.at(-1)).toEqual([bytes.length, bytes.length]);
  });

  it("streams an async iterable (re-cutting oversized items) with an unknown total", async () => {
    const rig = await makeRig();
    const parts = [patternBytes(CHUNK + 100), patternBytes(10), patternBytes(CHUNK * 2)];
    async function* source(): AsyncGenerator<Uint8Array> {
      for (const part of parts) {
        await Promise.resolve();
        yield part;
      }
    }
    const seen: Array<[number, number | undefined]> = [];

    await rig.files.upload("/tmp/c", source(), {
      onProgress: (sent, total) => seen.push([sent, total]),
    });

    const chunks = chunksOf(rig.frames);
    expect(chunks.every((c) => c.length <= CHUNK)).toBe(true);
    expectBytes(joined(chunks), joined(parts));
    expect(seen.every(([, total]) => total === undefined)).toBe(true);
    expect(seen.at(-1)?.[0]).toBe(joined(parts).length);
  });

  it("reports 0 of 0 and sends Begin then End for an empty source", async () => {
    const rig = await makeRig();
    const seen: Array<[number, number | undefined]> = [];

    await rig.files.upload("/tmp/empty", new Uint8Array(0), {
      onProgress: (sent, total) => seen.push([sent, total]),
    });

    expect(rig.frames.map((f) => f.opcode)).toEqual(["Begin", "End"]);
    expect(seen).toEqual([[0, 0]]);
  });
});

describe("FileTransferClient.upload — completion", () => {
  it("with fileTransferAck: asks for the ack and resolves only when file_upload_complete arrives", async () => {
    const rig = await makeRig({ ack: true });
    let settled = false;
    const upload = rig.files.upload("/tmp/ack.bin", patternBytes(CHUNK * 2)).then(() => {
      settled = true;
    });
    await settle();

    expect(rig.requests.find((r) => r.type === "file_upload_request")?.ack).toBe(true);
    expect(rig.frames.at(-1)).toEqual({ opcode: "End", stream: 9, ok: true });
    expect(settled).toBe(false); // End was sent, but nothing says the file is on disk yet

    // A push for some other transfer does not count.
    complete(rig, { ok: true, transferId: "someone-else" });
    await settle();
    expect(settled).toBe(false);

    complete(rig, { ok: true, bytesWritten: CHUNK * 2 });
    await upload;
    expect(settled).toBe(true);
    expect(rig.files.pendingUploads).toBe(0);
    expect(rig.listeners()).toBe(0);
  });

  it("with fileTransferAck: no RPC-style timeout cuts off a slow acknowledgement", async () => {
    vi.useFakeTimers();
    try {
      const rig = await makeRig({ ack: true, rpcTimeoutMs: 50 });
      const upload = rig.files.upload("/tmp/slow.bin", patternBytes(10));
      await settle();

      vi.advanceTimersByTime(10 * 60_000); // far past any RPC timeout
      await settle();
      complete(rig, { ok: true, bytesWritten: 10 });

      await expect(upload).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("with fileTransferAck: rejects with the daemon's error when ok is false", async () => {
    const rig = await makeRig({ ack: true });
    const upload = rig.files.upload("/tmp/nope.bin", patternBytes(100));
    const outcome = expect(upload).rejects.toThrow("write_failed (ENOSPC)");
    await settle();

    complete(rig, { ok: false, error: "write_failed (ENOSPC)" });

    await outcome;
    expect(rig.files.pendingUploads).toBe(0);
    expect(rig.listeners()).toBe(0);
  });

  it("with fileTransferAck: a failure push mid-transfer stops sending without an Error frame", async () => {
    const rig = await makeRig({ ack: true, drainPerSleep: 0 });
    const upload = rig.files.upload("/tmp/early.bin", patternBytes(HIGH_WATER * 3));
    const outcome = expect(upload).rejects.toThrow("open_failed (EACCES)");
    await settle(); // blocked on pacing: the link never drains

    complete(rig, { ok: false, error: "open_failed (EACCES)" });

    await outcome;
    expect(rig.frames.some((f) => f.opcode === "Error" || f.opcode === "End")).toBe(false);
  });

  it("without the flag: sends no ack request and resolves after the buffer drains, with the right bytes", async () => {
    const rig = await makeRig({ ack: false });
    const bytes = patternBytes(CHUNK * 3);

    await rig.files.upload("/tmp/plain.bin", bytes);

    expect(rig.requests.find((r) => r.type === "file_upload_request")).not.toHaveProperty("ack");
    expect(rig.buffered()).toBe(0);
    expectBytes(joined(chunksOf(rig.frames)), bytes);
    expect(rig.frames.at(-1)).toEqual({ opcode: "End", stream: 9, ok: true });
    expect(rig.listeners()).toBe(0);
  });
});

describe("FileTransferClient.upload — cancel and connection loss", () => {
  it("an abort mid-transfer sends an Error frame, rejects with AbortError, and leaves nothing pending", async () => {
    const rig = await makeRig({ ack: true, drainPerSleep: 0 });
    const controller = new AbortController();
    const upload = rig.files.upload("/tmp/abort.bin", patternBytes(HIGH_WATER * 4), {
      signal: controller.signal,
    });
    const outcome = expect(upload).rejects.toMatchObject({ name: "AbortError" });
    await settle(); // the link is stalled, so the client is parked in its pacing wait
    expect(rig.sleeps()).toBeGreaterThan(0);
    expect(rig.files.pendingUploads).toBe(1);

    controller.abort();

    await outcome;
    expect(rig.frames.at(-1)).toMatchObject({ opcode: "Error", stream: 9 });
    expect(rig.frames.some((f) => f.opcode === "End")).toBe(false);
    expect(rig.files.pendingUploads).toBe(0);
    expect(rig.listeners()).toBe(0);
    // A late completion for the cancelled transfer is ignored, not an error.
    complete(rig, { ok: false, error: "client_aborted" });
    await settle();
  });

  it("an already-aborted signal rejects before anything is sent", async () => {
    const rig = await makeRig();
    const controller = new AbortController();
    controller.abort();

    await expect(
      rig.files.upload("/tmp/x", patternBytes(10), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(rig.requests).toEqual([]);
    expect(rig.frames).toEqual([]);
  });

  it("an abort while waiting for the upload stream hands the stream back when it arrives", async () => {
    const rig = await makeRig();
    const controller = new AbortController();
    const upload = rig.files.upload("/tmp/early-abort", patternBytes(10), {
      signal: controller.signal,
    });
    const outcome = expect(upload).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(); // before the daemon's microtask-delayed response

    await outcome;
    await settle();
    expect(rig.frames).toEqual([{ opcode: "Error", stream: 9, message: "client_error" }]);
    expect(rig.files.pendingUploads).toBe(0);
    expect(rig.listeners()).toBe(0);
  });

  it("a connection drop mid-upload rejects and leaves nothing pending", async () => {
    const rig = await makeRig({ ack: true, drainPerSleep: 0 });
    const upload = rig.files.upload("/tmp/drop.bin", patternBytes(HIGH_WATER * 4));
    const outcome = expect(upload).rejects.toThrow(/closed/);
    await settle();
    expect(rig.files.pendingUploads).toBe(1);

    rig.drop();

    await outcome;
    expect(rig.frames.some((f) => f.opcode === "Error")).toBe(false); // nobody to tell
    expect(rig.files.pendingUploads).toBe(0);
    expect(rig.listeners()).toBe(0);
  });

  it("a connection drop while waiting for the acknowledgement rejects", async () => {
    const rig = await makeRig({ ack: true });
    const upload = rig.files.upload("/tmp/drop-ack.bin", patternBytes(100));
    const outcome = expect(upload).rejects.toThrow(/closed/);
    await settle();
    expect(rig.frames.at(-1)).toMatchObject({ opcode: "End" });

    rig.drop();

    await outcome;
    expect(rig.files.pendingUploads).toBe(0);
    expect(rig.listeners()).toBe(0);
  });

  it("stop() rejects an upload in flight", async () => {
    const rig = await makeRig({ ack: true, drainPerSleep: 0 });
    const upload = rig.files.upload("/tmp/stop.bin", patternBytes(HIGH_WATER * 4));
    const outcome = expect(upload).rejects.toThrow("file transfer router stopped");
    await settle();

    rig.files.stop();

    await outcome;
    expect(rig.files.pendingUploads).toBe(0);
  });

  it("rejects and releases the stream when the source iterable throws", async () => {
    const rig = await makeRig();
    async function* broken(): AsyncGenerator<Uint8Array> {
      yield patternBytes(10);
      throw new Error("disk read failed");
    }

    await expect(rig.files.upload("/tmp/broken", broken())).rejects.toThrow("disk read failed");

    expect(rig.frames.at(-1)).toMatchObject({ opcode: "Error", stream: 9 });
    expect(rig.files.pendingUploads).toBe(0);
  });
});
