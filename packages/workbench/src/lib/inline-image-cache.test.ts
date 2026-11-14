import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireInlineImage,
  clearInlineImageCache,
  MAX_INLINE_IMAGE_ENTRIES,
  releaseInlineImage,
} from "./inline-image-cache.js";

function stubObjectUrls(): { revoked: string[] } {
  let counter = 0;
  const revoked: string[] = [];
  vi.stubGlobal("URL", {
    createObjectURL: () => `blob:mock-${++counter}`,
    revokeObjectURL: (url: string) => revoked.push(url),
  });
  return { revoked };
}

function fakeDownload(bytes = new Uint8Array([1, 2, 3]), mimeType = "image/png") {
  const calls: string[] = [];
  const download = vi.fn((path: string) => {
    calls.push(path);
    return Promise.resolve({ bytes, mimeType });
  });
  return { download, calls };
}

beforeEach(() => {
  clearInlineImageCache();
  stubObjectUrls();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("acquireInlineImage", () => {
  it("dedupes concurrent acquires of the same path into one download", async () => {
    const { download, calls } = fakeDownload();
    const [a, b] = await Promise.all([
      acquireInlineImage("/repo/a.png", download),
      acquireInlineImage("/repo/a.png", download),
    ]);
    expect(calls.length).toBe(1);
    expect(a.objectUrl).toBe(b.objectUrl);
  });

  it("hits the cache after release without re-downloading", async () => {
    const { download, calls } = fakeDownload();
    const first = await acquireInlineImage("/repo/a.png", download);
    releaseInlineImage("/repo/a.png");
    const second = await acquireInlineImage("/repo/a.png", download);
    expect(calls.length).toBe(1);
    expect(second.objectUrl).toBe(first.objectUrl);
  });

  it("evicts the LRU entry when a new path exceeds the bound and every prior entry is released", async () => {
    const { revoked } = stubObjectUrls();
    const { download } = fakeDownload();
    for (let i = 0; i < MAX_INLINE_IMAGE_ENTRIES; i++) {
      await acquireInlineImage(`/repo/${i}.png`, download);
    }
    for (let i = 0; i < MAX_INLINE_IMAGE_ENTRIES; i++) {
      releaseInlineImage(`/repo/${i}.png`);
    }
    expect(revoked.length).toBe(0);

    await acquireInlineImage("/repo/33.png", download);
    expect(revoked.length).toBe(1); // exactly one eviction for the one path over the bound

    // The evicted entry was the least-recently-used one (path 0) — re-acquiring it now
    // triggers a fresh download rather than a cache hit.
    const { download: download2, calls } = fakeDownload();
    await acquireInlineImage("/repo/0.png", download2);
    expect(calls.length).toBe(1);
  });

  it("evicts nothing when every entry is still referenced", async () => {
    const { revoked } = stubObjectUrls();
    const { download } = fakeDownload();
    for (let i = 0; i < MAX_INLINE_IMAGE_ENTRIES; i++) {
      await acquireInlineImage(`/repo/${i}.png`, download);
    }
    await acquireInlineImage("/repo/33.png", download); // all 32 prior entries still referenced
    expect(revoked.length).toBe(0);
  });

  it("removes the cache entry on a rejected download so the next mount retries", async () => {
    const download = vi.fn().mockRejectedValueOnce(new Error("boom"));
    await expect(acquireInlineImage("/repo/broken.png", download)).rejects.toThrow("boom");

    const { download: retryDownload, calls } = fakeDownload();
    await acquireInlineImage("/repo/broken.png", retryDownload);
    expect(calls.length).toBe(1);
  });
});

describe("clearInlineImageCache", () => {
  it("revokes every object URL and empties the map", async () => {
    const { revoked } = stubObjectUrls();
    const { download } = fakeDownload();
    await acquireInlineImage("/repo/a.png", download);
    await acquireInlineImage("/repo/b.png", download);

    clearInlineImageCache();
    expect(revoked.length).toBe(2);

    // Nothing left to hit — the next acquire re-downloads.
    const { download: download2, calls } = fakeDownload();
    await acquireInlineImage("/repo/a.png", download2);
    expect(calls.length).toBe(1);
  });
});
