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
        message: { type: "file_download_token_response", requestId: tokenRequestId, ok: true, token: "tok-1" },
      }),
    );
    await Promise.resolve();
    await Promise.resolve();

    // 2) Download request/response (server acks the request, then streams binary frames).
    const downloadRequestId = lastRequestId(fake.sentText);
    fake.push(
      JSON.stringify({
        type: "session",
        message: { type: "file_download_response", requestId: downloadRequestId, ok: true, stream: 1 },
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
        message: { type: "file_download_token_response", requestId: tokenRequestId, ok: true, token: "tok-2" },
      }),
    );
    await Promise.resolve();
    await Promise.resolve();

    const downloadRequestId = lastRequestId(fake.sentText);
    fake.push(
      JSON.stringify({
        type: "session",
        message: { type: "file_download_response", requestId: downloadRequestId, ok: true, stream: 1 },
      }),
    );
    await Promise.resolve();

    fake.pushBinary(encodeFileTransferFrame({ opcode: "Error", stream: 1, message: "expired token" }));

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
