import { describe, expect, it } from "vitest";

import { decodeFileTransferFrame, encodeFileTransferFrame } from "@av-pi-studio/protocol";

import { DaemonClient } from "./daemon-client.js";
import { FileTransferClient } from "./file-transfer-client.js";
import type { Transport } from "./transport.js";

function makeFakeTransport(): {
  transport: Transport;
  sentText: string[];
  sentBinary: Uint8Array[];
  push: (data: string) => void;
  pushBinary: (bytes: Uint8Array) => void;
} {
  const sentText: string[] = [];
  const sentBinary: Uint8Array[] = [];
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
      const parsed = JSON.parse(data) as { type?: string };
      if (parsed.type === "hello") {
        queueMicrotask(() =>
          transport.onMessage?.(
            JSON.stringify({
              type: "status",
              payload: { status: "server_info", serverId: "srv-1", capabilities: {}, features: {} },
            }),
          ),
        );
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

/** The session message body of the client's most recent send. */
interface SentMessage {
  type: string;
  requestId: string;
  token?: string;
  stream: number;
}
function lastSent(fake: { sentText: string[] }): SentMessage {
  const envelope = JSON.parse(fake.sentText.at(-1)!) as { message: SentMessage };
  return envelope.message;
}

/** Answer the pending `file_download_token_request` with `token`. */
function respondToken(
  fake: { sentText: string[]; push: (d: string) => void },
  token: string,
): void {
  fake.push(
    JSON.stringify({
      type: "session",
      message: {
        type: "file_download_token_response",
        requestId: lastRequestId(fake.sentText),
        ok: true,
        token,
      },
    }),
  );
}

/** Drain queued microtasks — the client's RPC plumbing is promise-based, never timer-based. */
async function drain(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe("FileTransferClient — download", () => {
  it("requests a token, requests the download, and assembles Begin→Chunk*→End into one buffer", async () => {
    const fake = makeFakeTransport();
    const client = makeClient(fake.transport);
    await client.connect();
    const transfer = new FileTransferClient(client);
    transfer.start();

    const downloadPromise = transfer.download("/tmp/photo.png");

    // 1) Token request/response.
    const tokenRequestId = lastRequestId(fake.sentText);
    fake.push(
      JSON.stringify({
        type: "session",
        message: {
          type: "file_download_token_response",
          requestId: tokenRequestId,
          ok: true,
          token: "tok-1",
        },
      }),
    );
    await Promise.resolve();
    await Promise.resolve();

    // 2) Download request/response (server acks the request, then streams binary frames).
    const downloadRequestId = lastRequestId(fake.sentText);
    fake.push(
      JSON.stringify({
        type: "session",
        message: {
          type: "file_download_response",
          requestId: downloadRequestId,
          ok: true,
          stream: 1,
        },
      }),
    );
    await Promise.resolve();

    // 3) Binary frames for stream 1.
    fake.pushBinary(
      encodeFileTransferFrame({
        opcode: "Begin",
        stream: 1,
        meta: { transferId: "dl-1", fileName: "photo.png", mimeType: "image/png" },
      }),
    );
    fake.pushBinary(
      encodeFileTransferFrame({ opcode: "Chunk", stream: 1, data: new Uint8Array([1, 2, 3]) }),
    );
    fake.pushBinary(
      encodeFileTransferFrame({ opcode: "Chunk", stream: 1, data: new Uint8Array([4, 5]) }),
    );
    fake.pushBinary(encodeFileTransferFrame({ opcode: "End", stream: 1, ok: true }));

    const file = await downloadPromise;
    expect(Array.from(file.bytes)).toEqual([1, 2, 3, 4, 5]);
    expect(file.fileName).toBe("photo.png");
    expect(file.mimeType).toBe("image/png");
  });

  it("rejects the download on an Error frame", async () => {
    const fake = makeFakeTransport();
    const client = makeClient(fake.transport);
    await client.connect();
    const transfer = new FileTransferClient(client);
    transfer.start();

    const downloadPromise = transfer.download("/tmp/gone.png");

    const tokenRequestId = lastRequestId(fake.sentText);
    fake.push(
      JSON.stringify({
        type: "session",
        message: {
          type: "file_download_token_response",
          requestId: tokenRequestId,
          ok: true,
          token: "tok-2",
        },
      }),
    );
    await Promise.resolve();
    await Promise.resolve();

    const downloadRequestId = lastRequestId(fake.sentText);
    fake.push(
      JSON.stringify({
        type: "session",
        message: {
          type: "file_download_response",
          requestId: downloadRequestId,
          ok: true,
          stream: 1,
        },
      }),
    );
    await Promise.resolve();

    fake.pushBinary(
      encodeFileTransferFrame({ opcode: "Error", stream: 1, message: "expired token" }),
    );

    await expect(downloadPromise).rejects.toThrow("expired token");
  });

  it("rejects when the token request itself fails", async () => {
    const fake = makeFakeTransport();
    const client = makeClient(fake.transport);
    await client.connect();
    const transfer = new FileTransferClient(client);
    transfer.start();

    const downloadPromise = transfer.download("/tmp/missing.png");
    const tokenRequestId = lastRequestId(fake.sentText);
    fake.push(
      JSON.stringify({
        type: "session",
        message: {
          type: "file_download_token_response",
          requestId: tokenRequestId,
          ok: false,
          error: "not_found",
        },
      }),
    );

    await expect(downloadPromise).rejects.toThrow("not_found");
  });

  it("retries once with a fresh token when the daemon reports an expired one", async () => {
    // The daemon's TTL runs from issue time, but the token only becomes usable once its response
    // has crossed a socket that may be saturated by an in-flight transfer's Chunk frames — so a
    // token can arrive already dead. The backlog has drained by the time we learn that, which is
    // exactly why one clean retry is enough.
    const fake = makeFakeTransport();
    const client = makeClient(fake.transport);
    await client.connect();
    const transfer = new FileTransferClient(client);
    transfer.start();

    const downloadPromise = transfer.download("/tmp/photo.png");
    await drain();
    respondToken(fake, "tok-stale");
    await drain();

    const staleAttempt = lastSent(fake);
    expect(staleAttempt).toMatchObject({ type: "file_download_request", token: "tok-stale" });
    fake.push(
      JSON.stringify({
        type: "session",
        message: {
          type: "file_download_response",
          requestId: staleAttempt.requestId,
          ok: false,
          error: "invalid_or_expired_token",
        },
      }),
    );
    await drain();

    expect(lastSent(fake).type).toBe("file_download_token_request");
    respondToken(fake, "tok-fresh");
    await drain();

    const retry = lastSent(fake);
    expect(retry).toMatchObject({ type: "file_download_request", token: "tok-fresh" });
    fake.push(
      JSON.stringify({
        type: "session",
        message: { type: "file_download_response", requestId: retry.requestId, ok: true },
      }),
    );
    await drain();
    fake.pushBinary(
      encodeFileTransferFrame({
        opcode: "Begin",
        stream: retry.stream,
        meta: { transferId: "dl-retry" },
      }),
    );
    fake.pushBinary(
      encodeFileTransferFrame({ opcode: "Chunk", stream: retry.stream, data: new Uint8Array([9]) }),
    );
    fake.pushBinary(encodeFileTransferFrame({ opcode: "End", stream: retry.stream, ok: true }));

    expect(Array.from((await downloadPromise).bytes)).toEqual([9]);
  });

  it("does not retry a rejection that a fresh token cannot fix", async () => {
    const fake = makeFakeTransport();
    const client = makeClient(fake.transport);
    await client.connect();
    const transfer = new FileTransferClient(client);
    transfer.start();

    const downloadPromise = transfer.download("/tmp/photo.png");
    await drain();
    respondToken(fake, "tok-1");
    await drain();

    const attempt = lastSent(fake);
    fake.push(
      JSON.stringify({
        type: "session",
        message: {
          type: "file_download_response",
          requestId: attempt.requestId,
          ok: false,
          error: "read_failed",
        },
      }),
    );

    await expect(downloadPromise).rejects.toThrow("read_failed");
    expect(fake.sentText.filter((t) => t.includes("file_download_token_request"))).toHaveLength(1);
  });

  it("recycles stream ids so a long-lived connection never emits one past 255", async () => {
    // The stream id is a single frame-header byte. `nextStream++` handed out 256 on the 256th
    // download of a session and every download after that died in the codec.
    const fake = makeFakeTransport();
    const client = makeClient(fake.transport);
    await client.connect();
    const transfer = new FileTransferClient(client);
    transfer.start();

    for (let i = 0; i < 300; i++) {
      const downloadPromise = transfer.download(`/tmp/f-${i}.bin`);
      await drain();
      respondToken(fake, `tok-${i}`);
      await drain();

      const attempt = lastSent(fake);
      expect(attempt.stream).toBeGreaterThanOrEqual(0);
      expect(attempt.stream).toBeLessThan(256);
      fake.push(
        JSON.stringify({
          type: "session",
          message: { type: "file_download_response", requestId: attempt.requestId, ok: true },
        }),
      );
      await drain();
      fake.pushBinary(
        encodeFileTransferFrame({
          opcode: "Begin",
          stream: attempt.stream,
          meta: { transferId: `dl-${i}` },
        }),
      );
      fake.pushBinary(encodeFileTransferFrame({ opcode: "End", stream: attempt.stream, ok: true }));
      await downloadPromise;
    }
  });

  it("releases the stream id when the download request never completes", async () => {
    // A rejected request streams no `End`, so nothing else frees the id — without an explicit
    // release, 256 failures would exhaust the pool for the life of the connection.
    const fake = makeFakeTransport();
    const client = makeClient(fake.transport);
    await client.connect();
    const transfer = new FileTransferClient(client);
    transfer.start();

    for (let i = 0; i < 300; i++) {
      const downloadPromise = transfer.download(`/tmp/f-${i}.bin`);
      await drain();
      respondToken(fake, `tok-${i}`);
      await drain();
      const attempt = lastSent(fake);
      fake.push(
        JSON.stringify({
          type: "session",
          message: {
            type: "rpc_error",
            requestId: attempt.requestId,
            code: "handler_error",
            message: "boom",
          },
        }),
      );
      await expect(downloadPromise).rejects.toThrow("boom");
    }
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
