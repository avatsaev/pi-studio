import { constants } from "node:fs";
import { open, stat } from "node:fs/promises";

import { MAX_INLINE_FILE_READ_BYTES } from "./limits.js";
import { expandHome } from "./resolve-path.js";

export type FileReadResponse =
  | { type: "file_read_response"; ok: true; path: string; content: string; size: number }
  | { type: "file_read_response"; ok: false; error: string; size?: number; maxBytes?: number };

const tooLarge = (size: number): FileReadResponse => ({
  type: "file_read_response",
  ok: false,
  error: "file_too_large",
  size,
  maxBytes: MAX_INLINE_FILE_READ_BYTES,
});

/**
 * `file_read_request` for both daemons. Anything but a regular file (device, pipe, socket) is
 * refused with `not_a_file` before it is opened, so `/dev/zero` cannot fill memory nor a FIFO
 * block the open. At most `MAX_INLINE_FILE_READ_BYTES + 1` bytes are ever read, so a file that
 * grows after the size check still answers `file_too_large`.
 */
export async function readInlineFile(rawPath: string): Promise<FileReadResponse> {
  const resolved = expandHome(rawPath);
  try {
    const st = await stat(resolved);
    if (st.isDirectory()) return { type: "file_read_response", ok: false, error: "is_directory" };
    if (!st.isFile()) return { type: "file_read_response", ok: false, error: "not_a_file" };
    if (st.size > MAX_INLINE_FILE_READ_BYTES) return tooLarge(st.size);

    // O_NONBLOCK: if the path was swapped for a FIFO after the stat, the open still returns.
    const handle = await open(resolved, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      if (!(await handle.stat()).isFile()) {
        return { type: "file_read_response", ok: false, error: "not_a_file" };
      }
      const limit = MAX_INLINE_FILE_READ_BYTES + 1;
      const buffer = Buffer.allocUnsafe(limit);
      let length = 0;
      while (length < limit) {
        const { bytesRead } = await handle.read(buffer, length, limit - length, length);
        if (bytesRead === 0) break;
        length += bytesRead;
      }
      if (length > MAX_INLINE_FILE_READ_BYTES) return tooLarge(length);
      return {
        type: "file_read_response",
        ok: true,
        path: resolved,
        content: buffer.toString("utf8", 0, length),
        size: length,
      };
    } finally {
      await handle.close();
    }
  } catch (e: unknown) {
    return {
      type: "file_read_response",
      ok: false,
      error: (e as Error).message ?? "read_failed",
    };
  }
}
