import { execFileSync } from "node:child_process";
import type * as FsPromises from "node:fs/promises";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readInlineFile } from "./inline-read.js";
import { MAX_INLINE_FILE_READ_BYTES } from "./limits.js";

// `staleSize` lets a test make `stat` under-report, as for a file that grows after the size check.
const lie = vi.hoisted(() => ({ staleSize: undefined as number | undefined }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    stat: async (...args: Parameters<typeof actual.stat>) => {
      const info = await actual.stat(...args);
      if (lie.staleSize !== undefined && info.isFile()) {
        return Object.assign(Object.create(info), { size: lie.staleSize });
      }
      return info;
    },
  };
});

describe("readInlineFile", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "inline-read-"));
    lie.staleSize = undefined;
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads a regular file", async () => {
    const file = join(dir, "a.txt");
    await writeFile(file, "hello");
    expect(await readInlineFile(file)).toEqual({
      type: "file_read_response",
      ok: true,
      path: file,
      content: "hello",
      size: 5,
    });
  });

  it("answers is_directory for a directory", async () => {
    expect(await readInlineFile(dir)).toMatchObject({ ok: false, error: "is_directory" });
  });

  it("answers not_a_file for a FIFO without opening it", async () => {
    const fifo = join(dir, "pipe");
    execFileSync("mkfifo", [fifo]);
    // A hang here is caught by the test timeout.
    expect(await readInlineFile(fifo)).toMatchObject({ ok: false, error: "not_a_file" });
  }, 5000);

  it("answers not_a_file for /dev/zero", async () => {
    expect(await readInlineFile("/dev/zero")).toMatchObject({ ok: false, error: "not_a_file" });
  });

  it("answers file_too_large for a file over the limit", async () => {
    const file = join(dir, "big.txt");
    await writeFile(file, "x".repeat(MAX_INLINE_FILE_READ_BYTES + 1));
    expect(await readInlineFile(file)).toMatchObject({
      ok: false,
      error: "file_too_large",
      size: MAX_INLINE_FILE_READ_BYTES + 1,
      maxBytes: MAX_INLINE_FILE_READ_BYTES,
    });
  });

  it("answers file_too_large when the file outgrows the size that stat reported", async () => {
    const file = join(dir, "grown.txt");
    await writeFile(file, "x".repeat(MAX_INLINE_FILE_READ_BYTES + 10));
    lie.staleSize = 3;
    expect(await readInlineFile(file)).toMatchObject({
      ok: false,
      error: "file_too_large",
      maxBytes: MAX_INLINE_FILE_READ_BYTES,
    });
  });
});
