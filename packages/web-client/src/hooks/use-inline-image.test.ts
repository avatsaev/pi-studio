import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadInlineImage, type InlineImageState } from "./use-inline-image.js";
import {
  clearInlineImageCache,
  MAX_INLINE_IMAGE_ENTRIES,
} from "@pi-studio-ui/lib/inline-image-cache.js";

function stubObjectUrls(): void {
  let counter = 0;
  vi.stubGlobal("URL", {
    createObjectURL: () => `blob:mock-${++counter}`,
    revokeObjectURL: () => {},
  });
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeDownload() {
  return Promise.resolve({ bytes: new Uint8Array([1]), mimeType: "image/png" });
}

beforeEach(() => {
  clearInlineImageCache();
  stubObjectUrls();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadInlineImage — idle case", () => {
  it("reports idle and issues no request when download is null (no connection)", () => {
    const states: InlineImageState[] = [];
    const cleanup = loadInlineImage("/repo/a.png", null, (s) => states.push(s));
    expect(states).toEqual([{ status: "idle" }]);
    expect(cleanup).toBeUndefined();
  });

  it("reports idle when path is null", () => {
    const states: InlineImageState[] = [];
    const cleanup = loadInlineImage(
      null,
      () => Promise.resolve({ bytes: new Uint8Array() }),
      (s) => states.push(s),
    );
    expect(states).toEqual([{ status: "idle" }]);
    expect(cleanup).toBeUndefined();
  });
});

describe("loadInlineImage — loading/ready/error transitions", () => {
  it("transitions loading -> ready on a successful download", async () => {
    const states: InlineImageState[] = [];
    const download = vi.fn(() =>
      Promise.resolve({ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" }),
    );
    loadInlineImage("/repo/a.png", download, (s) => states.push(s));
    expect(states[0]).toEqual({ status: "loading" });
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe("ready"));
    expect(download).toHaveBeenCalledWith("/repo/a.png");
  });

  it("transitions loading -> error on a failed download", async () => {
    const states: InlineImageState[] = [];
    const download = vi.fn(() => Promise.reject(new Error("not_found")));
    loadInlineImage("/repo/missing.png", download, (s) => states.push(s));
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe("error"));
    expect(states.at(-1)).toEqual({ status: "error", message: "not_found" });
  });

  it("ignores a resolution that lands after cleanup", async () => {
    const states: InlineImageState[] = [];
    const { promise, resolve } = deferred<{ bytes: Uint8Array; mimeType?: string }>();
    const cleanup = loadInlineImage(
      "/repo/a.png",
      () => promise,
      (s) => states.push(s),
    );
    cleanup?.();
    resolve({ bytes: new Uint8Array([1]) });
    await Promise.resolve().then().then(); // let the resolved promise's .then chain flush
    expect(states.some((s) => s.status === "ready")).toBe(false);
  });
});

describe("loadInlineImage — cleanup releases the path", () => {
  it("a released path becomes eligible for LRU eviction; an un-released one does not", async () => {
    // Acquire and release "/repo/released.png" through the hook's own effect contract.
    const releasedStates: InlineImageState[] = [];
    const cleanupReleased = loadInlineImage("/repo/released.png", fakeDownload, (s) =>
      releasedStates.push(s),
    );
    await vi.waitFor(() => expect(releasedStates.at(-1)?.status).toBe("ready"));
    cleanupReleased?.();

    // Acquire "/repo/held.png" and never release it (simulates a still-mounted image).
    const heldStates: InlineImageState[] = [];
    loadInlineImage("/repo/held.png", fakeDownload, (s) => heldStates.push(s));
    await vi.waitFor(() => expect(heldStates.at(-1)?.status).toBe("ready"));

    // Fill the cache past the bound with distinct, immediately-released paths so eviction runs.
    for (let i = 0; i < MAX_INLINE_IMAGE_ENTRIES; i++) {
      const filler: InlineImageState[] = [];
      const cleanupFiller = loadInlineImage(`/repo/filler-${i}.png`, fakeDownload, (s) =>
        filler.push(s),
      );
      await vi.waitFor(() => expect(filler.at(-1)?.status).toBe("ready"));
      cleanupFiller?.();
    }

    // The released path was evicted (a remount now re-downloads); the held path was not (it
    // still has a live ref) and still resolves to the exact same cached download call count.
    const releasedRetryDownload = vi.fn(() =>
      Promise.resolve({ bytes: new Uint8Array([1]), mimeType: "image/png" }),
    );
    const retryStates: InlineImageState[] = [];
    loadInlineImage("/repo/released.png", releasedRetryDownload, (s) => retryStates.push(s));
    await vi.waitFor(() => expect(retryStates.at(-1)?.status).toBe("ready"));
    expect(releasedRetryDownload).toHaveBeenCalledTimes(1); // re-downloaded: it was evicted

    const heldRetryDownload = vi.fn(() =>
      Promise.resolve({ bytes: new Uint8Array([1]), mimeType: "image/png" }),
    );
    const heldRetryStates: InlineImageState[] = [];
    loadInlineImage("/repo/held.png", heldRetryDownload, (s) => heldRetryStates.push(s));
    await vi.waitFor(() => expect(heldRetryStates.at(-1)?.status).toBe("ready"));
    expect(heldRetryDownload).not.toHaveBeenCalled(); // cache hit: still held, never evicted
  });
});

describe("loadInlineImage — path change", () => {
  it("supports the sequence React's effect-cleanup order guarantees: release the old path, then load the new one", async () => {
    const aStates: InlineImageState[] = [];
    const cleanupA = loadInlineImage("/repo/a.png", fakeDownload, (s) => aStates.push(s));
    await vi.waitFor(() => expect(aStates.at(-1)?.status).toBe("ready"));

    cleanupA?.(); // React runs the outgoing effect's cleanup before the next effect
    const bStates: InlineImageState[] = [];
    loadInlineImage("/repo/b.png", fakeDownload, (s) => bStates.push(s));
    await vi.waitFor(() => expect(bStates.at(-1)?.status).toBe("ready"));

    expect(bStates.at(-1)).toEqual({ status: "ready", objectUrl: expect.any(String) });
  });
});
