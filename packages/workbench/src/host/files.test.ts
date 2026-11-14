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

describe("view URLs", () => {
  function download(url: string): FileDownload & { release: ReturnType<typeof vi.fn> } {
    return { objectUrl: url, release: vi.fn() };
  }

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
    vi.stubGlobal("URL", {
      createObjectURL: () => `blob:v${++n}`,
      revokeObjectURL: (url: string) => revoked.push(url),
    });
    const transfer = {
      download: vi.fn(async () => ({ bytes: new Uint8Array([1]), mimeType: "image/png" })),
    } as unknown as FileTransferClient;
    const files = createBrowserFiles(() => transfer);

    const view = await files.openForView("/work/a.png");
    expect(view).toMatchObject({ url: "blob:v1", mimeType: "image/png" });

    view.release();
    view.release();
    expect(revoked).toEqual(["blob:v1"]);
  });
});
