import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FileTransferClient } from "@av-pi-studio/client";
import { createBrowserFiles } from "./browser-files.js";
import { installHost, resetHostForTests } from "./install.js";
import { type UploadOptions, type UploadSource } from "./types.js";
import {
  batchPercent,
  uploadSources,
  type UploadStatus,
} from "../features/files/upload-sources.js";
import { type FileDownload, supersedeDownload } from "../hooks/use-file-download.js";
import { uploadAndRefresh } from "../hooks/use-file-transfer.js";
import { createTestHost } from "../test/test-host.js";

const source = (name: string): UploadSource => ({ name });

beforeEach(() => resetHostForTests());
afterEach(() => vi.unstubAllGlobals());

describe("upload through the host", () => {
  it("uploads through the host, then refreshes the explorer listing", async () => {
    const host = createTestHost();
    installHost(host);
    const order: string[] = [];
    const invalidateQueries = vi.fn(async () => void order.push("refresh"));
    host.files.upload = async (dir, s) => void order.push(`upload ${dir}/${s.name}`);

    await uploadAndRefresh({ invalidateQueries }, "/work", source("a.txt"));

    expect(order).toEqual(["upload /work/a.txt", "refresh"]);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["explorer"] });
  });

  it("does not refresh when the host rejects the upload", async () => {
    installHost(createTestHost({ uploadFails: "disk full" }));
    const invalidateQueries = vi.fn(async () => {});

    await expect(uploadAndRefresh({ invalidateQueries }, "/work", source("a.txt"))).rejects.toThrow(
      "disk full",
    );
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it("reports a rejected upload on the status line", async () => {
    const statuses: UploadStatus[] = [];
    await uploadSources("/work", [source("a.txt")], {
      existing: new Set(),
      confirm: async () => true,
      upload: async () => Promise.reject(new Error("disk full")),
      setStatus: (s) => statuses.push(s),
    });

    expect(statuses).toEqual([
      { text: "Uploading 1 file…", error: false },
      { text: "Upload failed: disk full", error: true },
    ]);
  });

  it("uploads nothing when an overwrite is declined", async () => {
    const upload = vi.fn(async () => {});
    const confirm = vi.fn(async () => false);
    await uploadSources("/work", [source("a.txt"), source("b.txt")], {
      existing: new Set(["a.txt"]),
      confirm,
      upload,
      setStatus: () => {},
    });

    expect(confirm).toHaveBeenCalledWith("Overwrite this file? a.txt");
    expect(upload).not.toHaveBeenCalled();
  });

  it("hands the SDK the File itself, never its bytes, and forwards progress", async () => {
    const file = new File([new Uint8Array(10)], "big.bin");
    const arrayBuffer = vi.spyOn(file, "arrayBuffer");
    const upload = vi.fn(async (_path: string, _source: unknown, options?: UploadOptions) => {
      options?.onProgress?.(5, 10);
    });
    const files = createBrowserFiles(() => ({ upload }) as unknown as FileTransferClient);
    const seen: Array<[number, number | undefined]> = [];

    await files.upload("/work", file, { onProgress: (sent, total) => seen.push([sent, total]) });

    expect(upload).toHaveBeenCalledTimes(1);
    const [target, passed] = upload.mock.calls[0]!;
    expect(target).toBe("/work/big.bin");
    expect(passed).toBe(file); // the same object: no copy, no arrayBuffer()
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(seen).toEqual([[5, 10]]);
  });

  it("shows the batch's percentage on the status line, changing it only when the percent changes", async () => {
    const statuses: UploadStatus[] = [];
    const sources: UploadSource[] = [
      { name: "a.bin", size: 100 },
      { name: "b.bin", size: 300 },
    ];
    await uploadSources("/work", sources, {
      existing: new Set(),
      confirm: async () => true,
      upload: async (_dir, s, options) => {
        const size = s.size ?? 0;
        // Many chunk callbacks per percent point.
        for (let sent = 0; sent <= size; sent += size / 40) options?.onProgress?.(sent, size);
      },
      setStatus: (s) => statuses.push(s),
    });

    const percents = statuses
      .map((s) => /(\d+)%$/.exec(s.text)?.[1])
      .filter((p): p is string => p !== undefined)
      .map(Number);
    expect(percents.at(-1)).toBe(100);
    expect(percents).toEqual(percents.toSorted((a, b) => a - b)); // never goes backwards
    expect(new Set(percents).size).toBe(percents.length); // no repeated status for one percent
    expect(percents).toContain(25); // the first file ends at 100 of 400 bytes
    expect(statuses.at(-1)).toEqual({ text: "Uploaded 2 files", error: false });
  });

  it("leaves out the percentage when a source's size is unknown", () => {
    expect(batchPercent([{ name: "a" }, { name: "b", size: 4 }], 0, 2)).toBeNull();
    expect(batchPercent([{ name: "a", size: 0 }], 0, 0)).toBeNull();
    expect(batchPercent([{ name: "a", size: 8 }], 0, 4)).toBe(50);
  });
});

function download(url: string): FileDownload & { release: ReturnType<typeof vi.fn> } {
  return { objectUrl: url, release: vi.fn() };
}

describe("view URLs", () => {
  it("releases the previous URL when a new one supersedes it, never the current one", () => {
    const first = download("u1");
    const second = download("u2");

    let current = supersedeDownload(null, first);
    current = supersedeDownload(current, first);
    expect(first.release).not.toHaveBeenCalled();

    current = supersedeDownload(current, second);
    expect(first.release).toHaveBeenCalledTimes(1);
    expect(second.release).not.toHaveBeenCalled();
    expect(current).toBe(second);
  });

  it("browser host: a view URL is an object URL revoked once, on release", async () => {
    let n = 0;
    const revoked: string[] = [];
    const blobs: Blob[] = [];
    vi.stubGlobal("URL", {
      createObjectURL: (blob: Blob) => {
        blobs.push(blob);
        return `blob:v${++n}`;
      },
      revokeObjectURL: (url: string) => revoked.push(url),
    });
    const downloadTo = vi.fn(async (_path: string, sink: (chunk: Uint8Array) => void) => {
      sink(new Uint8Array([1, 2]));
      sink(new Uint8Array([3]));
      return { mimeType: "image/png", fileName: "a.png", totalBytes: 3, mtimeMs: 0, offset: 0 };
    });
    // `download` (the concatenating call) is deliberately absent: the host must not use it.
    const transfer = { downloadTo } as unknown as FileTransferClient;
    const files = createBrowserFiles(() => transfer);

    const view = await files.openForView("/work/a.png");
    expect(view).toMatchObject({ url: "blob:v1", mimeType: "image/png", fileName: "a.png" });
    expect(blobs[0]!.type).toBe("image/png");
    expect(new Uint8Array(await blobs[0]!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));

    view.release();
    view.release();
    expect(revoked).toEqual(["blob:v1"]);
  });

  it("browser host: saving clicks a download anchor named by the daemon's file name", async () => {
    vi.stubGlobal("URL", { createObjectURL: () => "blob:s1", revokeObjectURL: () => {} });
    const anchor = { click: vi.fn(), remove: vi.fn(), href: "", download: "", rel: "" };
    vi.stubGlobal("document", {
      createElement: () => anchor,
      body: { appendChild: vi.fn() },
    });
    const downloadTo = vi.fn(async (_path: string, sink: (chunk: Uint8Array) => void) => {
      sink(new Uint8Array([9]));
      return { fileName: "report.pdf", totalBytes: 1, mtimeMs: 0, offset: 0 };
    });
    const files = createBrowserFiles(() => ({ downloadTo }) as unknown as FileTransferClient);

    await files.saveToDisk("/work/some/other-name.pdf");

    expect(anchor.href).toBe("blob:s1");
    expect(anchor.download).toBe("report.pdf");
    expect(anchor.click).toHaveBeenCalledTimes(1);
  });
});

const MIB = 8 * 1024 * 1024;

/** A fake daemon file of `size` bytes whose byte i is i % 251; `failAt` rejects that range index. */
function fake(size: number, opts: { failAt?: number; changedAt?: number } = {}) {
  const log: string[] = [];
  let received = 0;
  let inOrder = true;
  const requests: { offset?: number; length?: number; ifUnchanged?: unknown }[] = [];
  const downloadTo = vi.fn(
    async (
      _path: string,
      sink: (chunk: Uint8Array) => void,
      options: { offset?: number; length?: number; ifUnchanged?: unknown } = {},
    ) => {
      const index = requests.length;
      requests.push(options);
      log.push(`range${index}`);
      if (opts.failAt === index) throw new Error("connection lost");
      if (opts.changedAt === index) throw new Error("changed");
      const offset = options.offset ?? 0;
      const length = Math.min(options.length ?? size, size - offset);
      const bytes = Uint8Array.from({ length }, (_, i) => (offset + i) % 251);
      // Two chunks per range.
      const half = Math.floor(length / 2);
      if (length > 0) {
        sink(bytes.subarray(0, half));
        sink(bytes.subarray(half));
      }
      return { totalBytes: size, mtimeMs: 7, offset, length };
    },
  );
  const written = {
    get length() {
      return received;
    },
    get inOrder() {
      return inOrder;
    },
  };
  const target = {
    write: vi.fn(async (chunk: Uint8Array) => {
      log.push("write");
      await Promise.resolve();
      for (const b of chunk) inOrder &&= b === received++ % 251;
    }),
    finish: vi.fn(async () => void log.push("finish")),
    discard: vi.fn(async () => void log.push("discard")),
  };
  const files = createBrowserFiles(
    () => ({ downloadTo }) as unknown as FileTransferClient,
    async () => target,
  );
  return { files, target, downloadTo, written, log, requests };
}

describe("browser host: saving into a target", () => {
  it("writes the file in order, one awaited range at a time, with ifUnchanged after the first", async () => {
    const size = MIB * 2 + 5;
    const { files, target, written, log, requests } = fake(size);

    await files.saveToDisk("/w/big.bin");

    expect(written).toHaveLength(size);
    expect(written.inOrder).toBe(true);
    expect(requests.map((r) => r.offset)).toEqual([0, MIB, MIB * 2]);
    expect(requests[0]?.ifUnchanged).toBeUndefined();
    expect(requests[1]?.ifUnchanged).toEqual({ size, mtimeMs: 7 });
    expect(requests[2]?.ifUnchanged).toEqual({ size, mtimeMs: 7 });
    // A range is requested only after the previous range's writes.
    expect(log).toEqual([
      "range0",
      "write",
      "write",
      "range1",
      "write",
      "write",
      "range2",
      "write",
      "write",
      "finish",
    ]);
    expect(target.discard).not.toHaveBeenCalled();
  });

  it("makes no request when the target is cancelled", async () => {
    const downloadTo = vi.fn();
    const files = createBrowserFiles(
      () => ({ downloadTo }) as unknown as FileTransferClient,
      async () => null,
    );
    await files.saveToDisk("/w/a.txt");
    expect(downloadTo).not.toHaveBeenCalled();
  });

  it("discards once, never finishes, and rejects with the failure of range 3", async () => {
    const { files, target } = fake(MIB * 5, { failAt: 2 });
    await expect(files.saveToDisk("/w/big.bin")).rejects.toThrow("connection lost");
    expect(target.discard).toHaveBeenCalledTimes(1);
    expect(target.finish).not.toHaveBeenCalled();
  });

  it("rejects with `changed` and discards when the file changed between ranges", async () => {
    const { files, target } = fake(MIB * 2, { changedAt: 1 });
    await expect(files.saveToDisk("/w/big.bin")).rejects.toThrow("changed");
    expect(target.discard).toHaveBeenCalledTimes(1);
    expect(target.finish).not.toHaveBeenCalled();
  });

  it("discards and rejects when a write rejects", async () => {
    const { files, target } = fake(10);
    target.write.mockRejectedValueOnce(new Error("disk full"));
    await expect(files.saveToDisk("/w/a.txt")).rejects.toThrow("disk full");
    expect(target.discard).toHaveBeenCalledTimes(1);
    expect(target.finish).not.toHaveBeenCalled();
  });

  it("finishes once, without writing, for a zero-byte file", async () => {
    const { files, target } = fake(0);
    await files.saveToDisk("/w/empty");
    expect(target.write).not.toHaveBeenCalled();
    expect(target.finish).toHaveBeenCalledTimes(1);
  });
});
