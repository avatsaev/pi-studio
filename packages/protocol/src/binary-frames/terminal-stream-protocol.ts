import { z } from "zod";

/**
 * Terminal stream binary frame codec (architecture/websocket-protocol.md § Binary frames,
 * features/terminals.md § Binary stream protocol).
 *
 * Frame layout: `[1-byte opcode][1-byte slot][payload]`.
 *  - `slot` demuxes multiple terminals on one socket (0–255).
 *  - Output/Input/Snapshot/Restore payloads are raw bytes (pass-through).
 *  - Resize payload is UTF-8 JSON `{ rows, cols }`.
 *
 * Uses `Uint8Array` (not Node `Buffer`) so the codec runs in browser/RN as well as Node.
 */

/** Terminal frame opcodes. `Restore` value is TODO(verify) against the live codec. */
export const TerminalOpcode = {
  Output: 0x01,
  Input: 0x02,
  Resize: 0x03,
  Snapshot: 0x04,
  Restore: 0x05,
} as const;

export type TerminalOpcodeName = keyof typeof TerminalOpcode;
export type TerminalOpcodeValue = (typeof TerminalOpcode)[TerminalOpcodeName];

const OPCODE_BY_VALUE: Record<number, TerminalOpcodeName> = Object.fromEntries(
  Object.entries(TerminalOpcode).map(([name, value]) => [value, name as TerminalOpcodeName]),
);

/** Resize payload schema (`{ rows, cols }`, non-negative integers). */
export const terminalResizeSchema = z.object({
  rows: z.number().int().nonnegative(),
  cols: z.number().int().nonnegative(),
});
export type TerminalResize = z.infer<typeof terminalResizeSchema>;

export type TerminalFrame =
  | { opcode: "Output"; slot: number; data: Uint8Array }
  | { opcode: "Input"; slot: number; data: Uint8Array }
  | { opcode: "Resize"; slot: number; rows: number; cols: number }
  | { opcode: "Snapshot"; slot: number; data: Uint8Array }
  | { opcode: "Restore"; slot: number; data: Uint8Array };

/** Thrown when a frame cannot be decoded (too short, unknown opcode, bad payload). */
export class TerminalFrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TerminalFrameError";
  }
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function assertSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 0 || slot > 0xff) {
    throw new TerminalFrameError(`slot must be an integer 0–255, got ${slot}`);
  }
}

function frameWithPayload(opcodeValue: number, slot: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(2 + payload.length);
  out[0] = opcodeValue;
  out[1] = slot;
  out.set(payload, 2);
  return out;
}

/** Encode a typed terminal frame to bytes. */
export function encodeTerminalFrame(frame: TerminalFrame): Uint8Array {
  assertSlot(frame.slot);
  switch (frame.opcode) {
    case "Output":
      return frameWithPayload(TerminalOpcode.Output, frame.slot, frame.data);
    case "Input":
      return frameWithPayload(TerminalOpcode.Input, frame.slot, frame.data);
    case "Snapshot":
      return frameWithPayload(TerminalOpcode.Snapshot, frame.slot, frame.data);
    case "Restore":
      return frameWithPayload(TerminalOpcode.Restore, frame.slot, frame.data);
    case "Resize": {
      const json = JSON.stringify(
        terminalResizeSchema.parse({ rows: frame.rows, cols: frame.cols }),
      );
      return frameWithPayload(TerminalOpcode.Resize, frame.slot, textEncoder.encode(json));
    }
  }
}

/** Decode bytes into a typed terminal frame. Throws `TerminalFrameError` on invalid input. */
export function decodeTerminalFrame(bytes: Uint8Array): TerminalFrame {
  if (bytes.length < 2) {
    throw new TerminalFrameError(`frame too short: ${bytes.length} bytes (need ≥ 2)`);
  }
  const opcodeValue = bytes[0] as number;
  const slot = bytes[1] as number;
  const opcode = OPCODE_BY_VALUE[opcodeValue];
  if (!opcode) {
    throw new TerminalFrameError(`unknown terminal opcode 0x${opcodeValue.toString(16)}`);
  }
  const payload = bytes.subarray(2);

  if (opcode === "Resize") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(textDecoder.decode(payload));
    } catch {
      throw new TerminalFrameError("resize payload is not valid JSON");
    }
    const result = terminalResizeSchema.safeParse(parsed);
    if (!result.success) {
      throw new TerminalFrameError("resize payload is not { rows, cols }");
    }
    return { opcode: "Resize", slot, rows: result.data.rows, cols: result.data.cols };
  }

  // Output/Input/Snapshot/Restore: raw bytes pass through (copied so callers own the buffer).
  return { opcode, slot, data: payload.slice() };
}

/** Returns the decoded frame, or `null` instead of throwing (safe handling of unknown opcodes). */
export function tryDecodeTerminalFrame(bytes: Uint8Array): TerminalFrame | null {
  try {
    return decodeTerminalFrame(bytes);
  } catch {
    return null;
  }
}
