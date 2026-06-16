import { z } from "zod";

/**
 * File-transfer binary frame codec (architecture/websocket-protocol.md § Binary frames,
 * features/file-explorer-transfer.md § Binary transfer frames). Separate from the terminal codec
 * but lives in the same module family.
 *
 * Frame layout: `[1-byte opcode][1-byte stream][payload]`.
 *  - `stream` multiplexes concurrent transfers on one socket (0–255).
 *  - A transfer is `Begin` (metadata header) → N × `Chunk` (raw bytes) → `End` (completion marker),
 *    or `Error` to abort.
 *
 * NOTE: exact opcode values / chunk sizing / completion marker are TODO(verify) against the live
 * codec; this is a faithful chunked-with-completion-marker reconstruction from the scope.
 */

export const FileTransferOpcode = {
  Begin: 0x10,
  Chunk: 0x11,
  End: 0x12,
  Error: 0x13,
} as const;

export type FileTransferOpcodeName = keyof typeof FileTransferOpcode;

const OPCODE_BY_VALUE: Record<number, FileTransferOpcodeName> = Object.fromEntries(
  Object.entries(FileTransferOpcode).map(([name, value]) => [
    value,
    name as FileTransferOpcodeName,
  ]),
);

/** Metadata header for a transfer (carried by the `Begin` frame as UTF-8 JSON). */
export const fileTransferBeginSchema = z.object({
  transferId: z.string(),
  fileName: z.string().optional(),
  mimeType: z.string().optional(),
  totalBytes: z.number().int().nonnegative().optional(),
});
export type FileTransferBegin = z.infer<typeof fileTransferBeginSchema>;

export type FileTransferFrame =
  | { opcode: "Begin"; stream: number; meta: FileTransferBegin }
  | { opcode: "Chunk"; stream: number; data: Uint8Array }
  | { opcode: "End"; stream: number; ok: boolean }
  | { opcode: "Error"; stream: number; message: string };

export class FileTransferFrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileTransferFrameError";
  }
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function assertStream(stream: number): void {
  if (!Number.isInteger(stream) || stream < 0 || stream > 0xff) {
    throw new FileTransferFrameError(`stream must be an integer 0–255, got ${stream}`);
  }
}

function frame(opcodeValue: number, stream: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(2 + payload.length);
  out[0] = opcodeValue;
  out[1] = stream;
  out.set(payload, 2);
  return out;
}

export function encodeFileTransferFrame(f: FileTransferFrame): Uint8Array {
  assertStream(f.stream);
  switch (f.opcode) {
    case "Begin":
      return frame(
        FileTransferOpcode.Begin,
        f.stream,
        textEncoder.encode(JSON.stringify(fileTransferBeginSchema.parse(f.meta))),
      );
    case "Chunk":
      return frame(FileTransferOpcode.Chunk, f.stream, f.data);
    case "End":
      // Completion marker; payload encodes the ok/abort flag as a single byte.
      return frame(FileTransferOpcode.End, f.stream, new Uint8Array([f.ok ? 1 : 0]));
    case "Error":
      return frame(FileTransferOpcode.Error, f.stream, textEncoder.encode(f.message));
  }
}

export function decodeFileTransferFrame(bytes: Uint8Array): FileTransferFrame {
  if (bytes.length < 2) {
    throw new FileTransferFrameError(`frame too short: ${bytes.length} bytes (need ≥ 2)`);
  }
  const opcodeValue = bytes[0] as number;
  const stream = bytes[1] as number;
  const opcode = OPCODE_BY_VALUE[opcodeValue];
  if (!opcode) {
    throw new FileTransferFrameError(`unknown file-transfer opcode 0x${opcodeValue.toString(16)}`);
  }
  const payload = bytes.subarray(2);

  switch (opcode) {
    case "Begin": {
      let parsed: unknown;
      try {
        parsed = JSON.parse(textDecoder.decode(payload));
      } catch {
        throw new FileTransferFrameError("begin payload is not valid JSON");
      }
      const result = fileTransferBeginSchema.safeParse(parsed);
      if (!result.success) {
        throw new FileTransferFrameError("begin payload is not a valid transfer header");
      }
      return { opcode: "Begin", stream, meta: result.data };
    }
    case "Chunk":
      return { opcode: "Chunk", stream, data: payload.slice() };
    case "End":
      return { opcode: "End", stream, ok: (payload[0] ?? 1) !== 0 };
    case "Error":
      return { opcode: "Error", stream, message: textDecoder.decode(payload) };
  }
}

export function tryDecodeFileTransferFrame(bytes: Uint8Array): FileTransferFrame | null {
  try {
    return decodeFileTransferFrame(bytes);
  } catch {
    return null;
  }
}
