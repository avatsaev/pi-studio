import { describe, expect, it } from "vitest";

import {
  decodeTerminalFrame,
  encodeTerminalFrame,
  TerminalFrameError,
  TerminalOpcode,
  tryDecodeTerminalFrame,
} from "./terminal-stream-protocol.js";

describe("terminal stream codec", () => {
  it("round-trips an Output frame (opcode, slot, raw bytes)", () => {
    const data = new Uint8Array([0x68, 0x69, 0x0a]); // "hi\n"
    const encoded = encodeTerminalFrame({ opcode: "Output", slot: 7, data });
    expect(encoded[0]).toBe(TerminalOpcode.Output);
    expect(encoded[1]).toBe(7);
    const decoded = decodeTerminalFrame(encoded);
    expect(decoded.opcode).toBe("Output");
    expect(decoded.slot).toBe(7);
    if (decoded.opcode === "Output") expect(Array.from(decoded.data)).toEqual([0x68, 0x69, 0x0a]);
  });

  it("round-trips an Input frame", () => {
    const data = new Uint8Array([0x6c, 0x73]); // "ls"
    const decoded = decodeTerminalFrame(encodeTerminalFrame({ opcode: "Input", slot: 0, data }));
    expect(decoded.opcode).toBe("Input");
    if (decoded.opcode === "Input") expect(Array.from(decoded.data)).toEqual([0x6c, 0x73]);
  });

  it("encodes a Resize frame as JSON {rows, cols} and decodes back", () => {
    const encoded = encodeTerminalFrame({ opcode: "Resize", slot: 3, rows: 24, cols: 80 });
    expect(encoded[0]).toBe(TerminalOpcode.Resize);
    expect(encoded[1]).toBe(3);
    const payload = new TextDecoder().decode(encoded.subarray(2));
    expect(JSON.parse(payload)).toEqual({ rows: 24, cols: 80 });
    const decoded = decodeTerminalFrame(encoded);
    expect(decoded).toEqual({ opcode: "Resize", slot: 3, rows: 24, cols: 80 });
  });

  it("round-trips Snapshot and Restore frames", () => {
    const snap = decodeTerminalFrame(
      encodeTerminalFrame({ opcode: "Snapshot", slot: 1, data: new Uint8Array([1, 2, 3]) }),
    );
    expect(snap.opcode).toBe("Snapshot");
    const restore = decodeTerminalFrame(
      encodeTerminalFrame({ opcode: "Restore", slot: 2, data: new Uint8Array([9]) }),
    );
    expect(restore.opcode).toBe("Restore");
  });

  it("rejects an unknown opcode safely", () => {
    const bad = new Uint8Array([0x7f, 0x00, 0x01]);
    expect(() => decodeTerminalFrame(bad)).toThrow(TerminalFrameError);
    expect(tryDecodeTerminalFrame(bad)).toBeNull();
  });

  it("rejects a truncated frame and out-of-range slot", () => {
    expect(() => decodeTerminalFrame(new Uint8Array([0x01]))).toThrow(TerminalFrameError);
    expect(() =>
      encodeTerminalFrame({ opcode: "Output", slot: 999, data: new Uint8Array() }),
    ).toThrow(TerminalFrameError);
  });
});
