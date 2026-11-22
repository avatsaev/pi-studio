import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FileTransferClient } from "@av-pi-studio/client";
import { createBrowserFiles } from "./browser-files.js";
import { installHost, resetHostForTests } from "./install.js";
import { type SaveTarget, type TransferOptions, type UploadSource } from "./types.js";
import { batchPercent, uploadSources } from "../features/files/upload-sources.js";
import { type FileDownload, supersedeDownload } from "../hooks/use-file-download.js";
import { uploadAndRefresh } from "../hooks/use-file-transfer.js";
import { useTransferActivityStore } from "../stores/transfer-activity-store.js";
import { activityText } from "../stores/transfer-activity-text.js";
import { createTestHost } from "../test/test-host.js";

const source = (name: string): UploadSource => ({ name });

beforeEach(() => {
  resetHostForTests();
  useTransferActivityStore.setState({ activities: [], lastResult: null });
});

/** The text of the first activity's line, each time the store changes it. */
function recordLines(): { lines: string[]; stop(): void } {
  const lines: string[] = [];
  const stop = useTransferActivityStore.subscribe((state) => {
    const activity = state.activities[0];
    if (!activity) return;
    const text = activityText(activity);
    if (lines.at(-1) !== text) lines.push(text);
  });
  return { lines, stop };
}
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

  it("reports a rejected upload as the last result", async () => {
    const { lines, stop } = recordLines();
    await uploadSources("/work", [source("a.txt")], {
      existing: new Set(),
      confirm: async () => true,
      upload: async () => Promise.reject(new Error("disk full")),
    });
    stop();

    expect(lines).toEqual(["Uploading 1 file…"]);
    expect(useTransferActivityStore.getState().activities).toEqual([]);
    expect(useTransferActivityStore.getState().lastResult).toMatchObject({
      text: "Upload failed: disk full",
      error: true,
    });
  });

  it("uploads nothing when an overwrite is declined", async () => {
    const upload = vi.fn(async () => {});
    const confirm = vi.fn(async () => false);
    await uploadSources("/work", [source("a.txt"), source("b.txt")], {
      existing: new Set(["a.txt"]),
      confirm,
      upload,
    });

    expect(confirm).toHaveBeenCalledWith("Overwrite this file? a.txt");
    expect(upload).not.toHaveBeenCalled();
  });

  it("hands the SDK the File itself, never its bytes, and forwards progress", async () => {
    const file = new File([new Uint8Array(10)], "big.bin");
    const arrayBuffer = vi.spyOn(file, "arrayBuffer");
    const upload = vi.fn(async (_path: string, _source: unknown, options?: TransferOptions) => {
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

  it("hands the SDK the abort signal and rejects with an AbortError when it aborts", async () => {
    const upload = vi.fn(
      (_path: string, _source: unknown, options?: { signal?: AbortSignal }) =>
        new Promise<void>((_resolve, reject) => {
          // What the SDK's `upload` does on an abort.
          options?.signal?.addEventListener("abort", () =>
            reject(new DOMException("The upload was aborted", "AbortError")),
          );
        }),
    );
    const files = createBrowserFiles(() => ({ upload }) as unknown as FileTransferClient);
    const onStateChange = vi.fn();
    const controller = new AbortController();

    const pending = files.upload("/work", new File([new Uint8Array(10)], "a.bin"), {
      signal: controller.signal,
      onStateChange,
    });
    expect(upload.mock.calls[0]![2]?.signal).toBe(controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(onStateChange).not.toHaveBeenCalled(); // the browser host is always running
  });

  it("shows the batch's percentage on its activity, changing it only when the percent changes", async () => {
    const { lines, stop } = recordLines();
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
    });
    stop();

    const percents = lines
      .map((text) => /(\d+)%$/.exec(text)?.[1])
      .filter((p): p is string => p !== undefined)
      .map(Number);
    expect(percents.at(-1)).toBe(100);
    expect(percents).toEqual(percents.toSorted((a, b) => a - b)); // never goes backwards
    expect(new Set(percents).size).toBe(percents.length); // no repeated status for one percent
    expect(percents).toContain(25); // the first file ends at 100 of 400 bytes
    expect(useTransferActivityStore.getState().lastResult).toMatchObject({
      text: "Uploaded 2 files",
      error: false,
    });
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
    const anchor = stubAnchor();
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

type BlobDownload = (
  path: string,
  sink: (chunk: Uint8Array) => void,
  options?: { signal?: AbortSignal; onProgress?(received: number, length: number): void },
) => Promise<{ totalBytes: number; mtimeMs: number; offset: number; length: number }>;

describe("browser host: saving through a Blob", () => {
  it("reports progress against the file's size and never reports a state", async () => {
    const anchor = stubAnchor();
    const downloadTo = vi.fn<BlobDownload>(async (_path, sink, options) => {
      sink(new Uint8Array(4));
      options?.onProgress?.(4, 10);
      sink(new Uint8Array(6));
      options?.onProgress?.(10, 10);
      return { totalBytes: 10, mtimeMs: 0, offset: 0, length: 10 };
    });
    const files = createBrowserFiles(() => ({ downloadTo }) as unknown as FileTransferClient);
    const seen: Array<[number, number | undefined]> = [];
    const onStateChange = vi.fn();

    await files.saveToDisk("/w/a.bin", {
      onProgress: (done, total) => seen.push([done, total]),
      onStateChange,
    });

    expect(seen).toEqual([
      [4, 10],
      [10, 10],
    ]);
    expect(onStateChange).not.toHaveBeenCalled();
    expect(anchor.click).toHaveBeenCalledTimes(1);
  });

  it("hands the SDK the signal, and an abort rejects with an AbortError without clicking", async () => {
    const anchor = stubAnchor();
    const downloadTo = vi.fn<BlobDownload>(
      (_path, _sink, options) =>
        new Promise((_resolve, reject) => {
          // What the SDK's `downloadTo` does on an abort.
          options?.signal?.addEventListener("abort", () =>
            reject(new DOMException("The download was aborted", "AbortError")),
          );
        }),
    );
    const files = createBrowserFiles(() => ({ downloadTo }) as unknown as FileTransferClient);
    const controller = new AbortController();

    const pending = files.saveToDisk("/w/a.bin", { signal: controller.signal });
    expect(downloadTo.mock.calls[0]![2]?.signal).toBe(controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(anchor.click).not.toHaveBeenCalled();
  });

  it("saves nothing when the abort raced the last chunk", async () => {
    const anchor = stubAnchor();
    const controller = new AbortController();
    const downloadTo = vi.fn<BlobDownload>(async (_path, sink) => {
      sink(new Uint8Array(1));
      controller.abort(); // the download had already finished by the time the SDK saw it
      return { totalBytes: 1, mtimeMs: 0, offset: 0, length: 1 };
    });
    const files = createBrowserFiles(() => ({ downloadTo }) as unknown as FileTransferClient);

    await expect(files.saveToDisk("/w/a.bin", { signal: controller.signal })).rejects.toMatchObject(
      { name: "AbortError" },
    );
    expect(anchor.click).not.toHaveBeenCalled();
  });

  it("makes no request for a signal that has already aborted", async () => {
    const downloadTo = vi.fn();
    const files = createBrowserFiles(() => ({ downloadTo }) as unknown as FileTransferClient);

    await expect(
      files.saveToDisk("/w/a.bin", { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(downloadTo).not.toHaveBeenCalled();
  });
});

/** Stubs the globals a Blob save clicks through; returns the anchor it will click. */
function stubAnchor() {
  vi.stubGlobal("URL", { createObjectURL: () => "blob:s1", revokeObjectURL: () => {} });
  const anchor = { click: vi.fn(), remove: vi.fn(), href: "", download: "", rel: "" };
  vi.stubGlobal("document", {
    createElement: () => anchor,
    body: { appendChild: vi.fn() },
  });
  return anchor;
}

const MIB = 8 * 1024 * 1024;

/**
 * A fake daemon file of `size` bytes whose byte i is i % 251. `failAt` rejects that range index;
 * `hangAt` leaves that range in flight until its signal aborts, then rejects it as the SDK does.
 */
function fake(size: number, opts: { failAt?: number; changedAt?: number; hangAt?: number } = {}) {
  const log: string[] = [];
  let received = 0;
  let inOrder = true;
  const requests: { offset?: number; length?: number; ifUnchanged?: unknown }[] = [];
  const downloadTo = vi.fn(
    async (
      _path: string,
      sink: (chunk: Uint8Array) => void,
      options: {
        offset?: number;
        length?: number;
        ifUnchanged?: unknown;
        signal?: AbortSignal;
      } = {},
    ) => {
      const index = requests.length;
      requests.push(options);
      log.push(`range${index}`);
      if (opts.failAt === index) throw new Error("connection lost");
      if (opts.changedAt === index) throw new Error("changed");
      if (opts.hangAt === index) {
        const hung = Promise.withResolvers<never>();
        options.signal?.addEventListener("abort", () =>
          hung.reject(new DOMException("The download was aborted", "AbortError")),
        );
        await hung.promise;
      }
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

  it("makes no request and calls no callback when the target is cancelled", async () => {
    const downloadTo = vi.fn();
    const files = createBrowserFiles(
      () => ({ downloadTo }) as unknown as FileTransferClient,
      async () => null,
    );
    const onProgress = vi.fn();
    const onStateChange = vi.fn();
    await files.saveToDisk("/w/a.txt", { onProgress, onStateChange });
    expect(downloadTo).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
    expect(onStateChange).not.toHaveBeenCalled();
  });

  it("calls no callback before the user has chosen a destination", async () => {
    const downloadTo = vi.fn(async (_path: string, sink: (chunk: Uint8Array) => void) => {
      sink(new Uint8Array(3));
      return { totalBytes: 3, mtimeMs: 1, offset: 0, length: 3 };
    });
    const chosen = Promise.withResolvers<SaveTarget | null>();
    const files = createBrowserFiles(
      () => ({ downloadTo }) as unknown as FileTransferClient,
      () => chosen.promise,
    );
    const onProgress = vi.fn();
    const onStateChange = vi.fn();

    const pending = files.saveToDisk("/w/a.txt", { onProgress, onStateChange });
    await Promise.resolve(); // the dialog is still open
    expect(downloadTo).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();

    chosen.resolve({
      write: vi.fn(async () => {}),
      finish: vi.fn(async () => {}),
      discard: vi.fn(async () => {}),
    });
    await pending;
    expect(onProgress).toHaveBeenCalledWith(3, 3);
    expect(onStateChange).not.toHaveBeenCalled(); // the browser host is always running
  });

  it("reports the bytes written after each write, rising to the file's size", async () => {
    const size = MIB * 2 + 5;
    const { files, target } = fake(size);
    const seen: Array<[number, number | undefined]> = [];

    await files.saveToDisk("/w/big.bin", { onProgress: (done, total) => seen.push([done, total]) });

    let sum = 0;
    const written = target.write.mock.calls.map(([chunk]) => (sum += chunk.length));
    expect(seen.map(([done]) => done)).toEqual(written); // one report per write, running total
    expect(seen.every(([, total]) => total === size)).toBe(true);
    expect(seen.at(-1)).toEqual([size, size]);
  });

  it("reports an empty file once, at 0 of 0", async () => {
    const { files } = fake(0);
    const onProgress = vi.fn();
    await files.saveToDisk("/w/empty", { onProgress });
    expect(onProgress.mock.calls).toEqual([[0, 0]]);
  });

  it("hands the SDK the signal; an abort in the middle of a range discards once and rejects with an AbortError", async () => {
    const { files, target, downloadTo, requests } = fake(MIB * 3, { hangAt: 1 });
    const controller = new AbortController();
    const onProgress = vi.fn();

    const pending = files.saveToDisk("/w/big.bin", { signal: controller.signal, onProgress });
    await vi.waitFor(() => expect(requests).toHaveLength(2)); // range 1 is in flight
    expect(downloadTo.mock.calls[1]![2]?.signal).toBe(controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(target.discard).toHaveBeenCalledTimes(1);
    expect(target.finish).not.toHaveBeenCalled();
    expect(requests).toHaveLength(2); // no range after the abort
    expect(onProgress).toHaveBeenLastCalledWith(MIB, MIB * 3); // what range 0 wrote
  });

  it("stops between writes on an abort, then discards once and never finishes", async () => {
    const { files, target } = fake(MIB * 3);
    const controller = new AbortController();
    target.write.mockImplementationOnce(async () => controller.abort());

    await expect(
      files.saveToDisk("/w/big.bin", { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(target.write).toHaveBeenCalledTimes(1);
    expect(target.discard).toHaveBeenCalledTimes(1);
    expect(target.finish).not.toHaveBeenCalled();
  });

  it("does not finish when the abort comes during the very last write", async () => {
    const { files, target } = fake(10);
    const controller = new AbortController();
    target.write.mockImplementationOnce(async () => {});
    target.write.mockImplementationOnce(async () => controller.abort());

    await expect(files.saveToDisk("/w/a.bin", { signal: controller.signal })).rejects.toMatchObject(
      { name: "AbortError" },
    );

    expect(target.write).toHaveBeenCalledTimes(2);
    expect(target.discard).toHaveBeenCalledTimes(1);
    expect(target.finish).not.toHaveBeenCalled();
  });

  it("discards a destination chosen after the abort, without a request", async () => {
    const chosen = Promise.withResolvers<SaveTarget | null>();
    const downloadTo = vi.fn();
    const files = createBrowserFiles(
      () => ({ downloadTo }) as unknown as FileTransferClient,
      () => chosen.promise,
    );
    const controller = new AbortController();
    const target = {
      write: vi.fn(async () => {}),
      finish: vi.fn(async () => {}),
      discard: vi.fn(async () => {}),
    };

    const pending = files.saveToDisk("/w/a.txt", { signal: controller.signal });
    controller.abort(); // while the dialog is open
    chosen.resolve(target);

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(downloadTo).not.toHaveBeenCalled();
    expect(target.discard).toHaveBeenCalledTimes(1);
    expect(target.finish).not.toHaveBeenCalled();
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
