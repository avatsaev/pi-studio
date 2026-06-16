import { describe, expect, it } from "vitest";

import {
  decodeFileTransferFrame,
  encodeFileTransferFrame,
  FileTransferFrameError,
  type FileTransferFrame,
  tryDecodeFileTransferFrame,
} from "./file-transfer-protocol.js";

describe("file-transfer codec", () => {
  it("round-trips a multi-chunk transfer with an explicit completion marker", () => {
    const stream = 4;
    const chunkA = new Uint8Array([1, 2, 3]);
    const chunkB = new Uint8Array([4, 5]);

    const wire: Uint8Array[] = [
      encodeFileTransferFrame({
        opcode: "Begin",
        stream,
        meta: { transferId: "t1", fileName: "a.bin", totalBytes: 5 },
      }),
      encodeFileTransferFrame({ opcode: "Chunk", stream, data: chunkA }),
      encodeFileTransferFrame({ opcode: "Chunk", stream, data: chunkB }),
      encodeFileTransferFrame({ opcode: "End", stream, ok: true }),
    ];

    const decoded = wire.map(decodeFileTransferFrame);
    expect(decoded[0]).toMatchObject({ opcode: "Begin", stream });
    if (decoded[0]?.opcode === "Begin") {
      expect(decoded[0].meta.transferId).toBe("t1");
      expect(decoded[0].meta.fileName).toBe("a.bin");
    }

    // Reassemble payload from the chunk frames.
    const chunks = decoded.filter(
      (f): f is Extract<FileTransferFrame, { opcode: "Chunk" }> => f.opcode === "Chunk",
    );
    const reassembled = chunks.flatMap((c) => Array.from(c.data));
    expect(reassembled).toEqual([1, 2, 3, 4, 5]);

    // Explicit completion marker.
    const end = decoded[decoded.length - 1];
    expect(end?.opcode).toBe("End");
    if (end?.opcode === "End") expect(end.ok).toBe(true);
  });

  it("round-trips an Error frame", () => {
    const decoded = decodeFileTransferFrame(
      encodeFileTransferFrame({ opcode: "Error", stream: 0, message: "expired token" }),
    );
    expect(decoded).toEqual({ opcode: "Error", stream: 0, message: "expired token" });
  });

  it("rejects unknown opcodes / short frames safely", () => {
    expect(() => decodeFileTransferFrame(new Uint8Array([0xee, 0x00]))).toThrow(
      FileTransferFrameError,
    );
    expect(tryDecodeFileTransferFrame(new Uint8Array([0xee, 0x00]))).toBeNull();
    expect(() => decodeFileTransferFrame(new Uint8Array([0x11]))).toThrow(FileTransferFrameError);
  });
});
