import { beforeEach, describe, expect, it, vi } from "vitest";
import { type TransferOptions, type UploadSource } from "../../host/types.js";
import { useTransferActivityStore } from "../../stores/transfer-activity-store.js";
import { activityText } from "../../stores/transfer-activity-text.js";
import { batchPercent, uploadSources, type UploadSourcesDeps } from "./upload-sources.js";

const store = () => useTransferActivityStore.getState();
const abortError = (): DOMException => new DOMException("aborted", "AbortError");

beforeEach(() => {
  useTransferActivityStore.setState({ activities: [], lastResult: null });
});

interface Call {
  source: UploadSource;
  options: TransferOptions;
  finish(): void;
  fail(error: Error): void;
}

/** An `upload` whose calls stay pending until the test settles them; an abort rejects. */
function harness(over: Partial<UploadSourcesDeps> = {}) {
  const calls: Call[] = [];
  const upload = vi.fn((_dir: string, source: UploadSource, options?: TransferOptions) => {
    const held = Promise.withResolvers<void>();
    const opts = options ?? {};
    opts.signal?.addEventListener("abort", () => held.reject(abortError()), { once: true });
    calls.push({ source, options: opts, finish: held.resolve, fail: held.reject });
    return held.promise;
  });
  const deps: UploadSourcesDeps = {
    existing: new Set(),
    confirm: async () => true,
    upload,
    ...over,
  };
  return { calls, upload, deps };
}

const files = (...sizes: (number | undefined)[]): UploadSource[] =>
  sizes.map((size, i) => ({ name: `f${i + 1}`, ...(size === undefined ? {} : { size }) }));

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("batchPercent", () => {
  it("counts whole files already sent plus the current one", () => {
    const sources = files(100, 100, 200);
    expect(batchPercent(sources, 0, 50)).toBe(12);
    expect(batchPercent(sources, 1, 50)).toBe(37);
    expect(batchPercent(sources, 2, 200)).toBe(100);
  });

  it("is null when any size is unknown or the batch is empty", () => {
    expect(batchPercent(files(100, undefined), 0, 50)).toBeNull();
    expect(batchPercent(files(0), 0, 0)).toBeNull();
  });
});

describe("uploadSources", () => {
  it("registers one activity for the whole batch, after the overwrite question", async () => {
    const confirm = Promise.withResolvers<boolean>();
    const { calls, deps } = harness({
      existing: new Set(["f1"]),
      confirm: () => confirm.promise,
    });
    const done = uploadSources("/d", files(10, 10), deps);
    await tick();
    expect(store().activities).toEqual([]);
    expect(calls).toHaveLength(0);

    confirm.resolve(true);
    await tick();
    expect(store().activities).toHaveLength(1);
    expect(store().activities[0]).toMatchObject({ kind: "upload", label: "Uploading 2 files" });
    calls[0]?.finish();
    await tick();
    calls[1]?.finish();
    await done;
    expect(store().activities).toEqual([]);
  });

  it("registers nothing when the user declines the overwrite", async () => {
    const { upload, deps } = harness({ existing: new Set(["f1"]), confirm: async () => false });
    await uploadSources("/d", files(10), deps);
    expect(upload).not.toHaveBeenCalled();
    expect(store().activities).toEqual([]);
    expect(store().lastResult).toBeNull();
  });

  it("follows the batch percentage, one file after another, and ends with Uploaded", async () => {
    const { calls, deps } = harness();
    const done = uploadSources("/d", files(100, 100), deps);
    await tick();
    const line = (): string => activityText(store().activities[0]!);
    expect(line()).toBe("Uploading 2 files…");

    calls[0]?.options.onProgress?.(50);
    expect(line()).toBe("Uploading 2 files… 25%");
    calls[0]?.finish();
    await tick();
    expect(calls).toHaveLength(2);
    calls[1]?.options.onProgress?.(100);
    expect(line()).toBe("Uploading 2 files… 100%");
    calls[1]?.finish();
    await done;

    expect(store().activities).toEqual([]);
    expect(store().lastResult).toMatchObject({ text: "Uploaded 2 files", error: false });
  });

  it("says Uploaded 1 file for one file", async () => {
    const { calls, deps } = harness();
    const done = uploadSources("/d", files(10), deps);
    await tick();
    calls[0]?.finish();
    await done;
    expect(store().lastResult?.text).toBe("Uploaded 1 file");
  });

  it("shows no percentage while a size is unknown", async () => {
    const { calls, deps } = harness();
    const done = uploadSources("/d", files(100, undefined), deps);
    await tick();
    calls[0]?.options.onProgress?.(50);
    expect(store().activities[0]).toMatchObject({ percent: null });
    expect(activityText(store().activities[0]!)).toBe("Uploading 2 files…");
    calls[0]?.finish();
    await tick();
    calls[1]?.finish();
    await done;
  });

  it("Cancel aborts the file being sent and starts none of the rest", async () => {
    const { calls, upload, deps } = harness();
    const done = uploadSources("/d", files(10, 10, 10), deps);
    await tick();
    calls[0]?.finish();
    await tick();
    expect(upload).toHaveBeenCalledTimes(2);
    expect(calls[1]?.options.signal?.aborted).toBe(false);

    store().activities[0]?.cancel();
    await done;

    expect(calls[1]?.options.signal?.aborted).toBe(true);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(store().activities).toEqual([]);
    expect(store().lastResult).toMatchObject({ text: "Upload cancelled", error: false });
  });

  it("gives every file of a batch the same signal", async () => {
    const { calls, deps } = harness();
    const done = uploadSources("/d", files(1, 1), deps);
    await tick();
    calls[0]?.finish();
    await tick();
    calls[1]?.finish();
    await done;
    expect(calls[0]?.options.signal).toBe(calls[1]?.options.signal);
  });

  it("is complete when Cancel lands after the last file settled", async () => {
    const { calls, deps } = harness();
    const done = uploadSources("/d", files(10, 10), deps);
    await tick();
    calls[0]?.finish();
    await tick();
    const cancel = store().activities[0]?.cancel;
    calls[1]?.finish();
    cancel?.();
    await done;
    expect(store().lastResult?.text).toBe("Uploaded 2 files");
  });

  it("is cancelled when Cancel lands between two files", async () => {
    const { calls, upload, deps } = harness();
    const done = uploadSources("/d", files(10, 10), deps);
    await tick();
    store().activities[0]?.cancel();
    calls[0]?.finish(); // resolved after the abort raced it
    await done;
    expect(upload).toHaveBeenCalledTimes(1);
    expect(store().lastResult?.text).toBe("Upload cancelled");
  });

  it("ends with the failure's message as an error, and stops the batch", async () => {
    const { calls, upload, deps } = harness();
    const done = uploadSources("/d", files(10, 10), deps);
    await tick();
    calls[0]?.fail(new Error("disk full"));
    await done;
    expect(upload).toHaveBeenCalledTimes(1);
    expect(store().activities).toEqual([]);
    expect(store().lastResult).toMatchObject({ text: "Upload failed: disk full", error: true });
  });

  it("reads an AbortError the user did not ask for as a cancel", async () => {
    const { calls, deps } = harness();
    const done = uploadSources("/d", files(10), deps);
    await tick();
    calls[0]?.fail(abortError());
    await done;
    expect(store().lastResult?.text).toBe("Upload cancelled");
  });

  it("takes a restart back to its percentage: waiting, then progress from zero", async () => {
    const { calls, deps } = harness();
    const done = uploadSources("/d", files(100), deps);
    await tick();
    const line = (): string => activityText(store().activities[0]!);
    calls[0]?.options.onProgress?.(80);
    expect(line()).toBe("Uploading 1 file… 80%");
    calls[0]?.options.onStateChange?.("waiting");
    expect(line()).toBe("Uploading 1 file… waiting for the connection");
    calls[0]?.options.onProgress?.(0, 100);
    expect(line()).toBe("Uploading 1 file… 0%");
    calls[0]?.finish();
    await done;
  });

  it("shows queued as waiting", async () => {
    const { calls, deps } = harness();
    const done = uploadSources("/d", files(100), deps);
    await tick();
    calls[0]?.options.onStateChange?.("queued");
    expect(activityText(store().activities[0]!)).toBe("Uploading 1 file… waiting");
    calls[0]?.options.onStateChange?.("running");
    expect(activityText(store().activities[0]!)).toBe("Uploading 1 file…");
    calls[0]?.finish();
    await done;
  });

  it("does nothing for no sources or no directory", async () => {
    const { upload, deps } = harness();
    await uploadSources("/d", [], deps);
    await uploadSources("", files(1), deps);
    expect(upload).not.toHaveBeenCalled();
    expect(store().lastResult).toBeNull();
  });
});
