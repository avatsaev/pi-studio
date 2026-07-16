import { describe, expect, it } from "vitest";

import { encodeFileTransferFrame } from "@av-pi-studio/protocol";

import { DaemonClient } from "./daemon-client.js";
import { FileTransferClient } from "./file-transfer-client.js";
import type { Transport } from "./transport.js";

function makeFakeTransport(): {
  transport: Transport;
  sentText: string[];
  push: (data: string) => void;
  pushBinary: (bytes: Uint8Array) => void;
} {
  const sentText: string[] = [];
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
    sendBinary: () => {},
    close: () => {},
  };
  return {
    transport,
    sentText,
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
