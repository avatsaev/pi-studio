import { describe, expect, it } from "vitest";
import { ASSET_LIMITS, type ConfinedRef } from "./html-assets.js";
import { loadHtmlAssetBundle, type ByteFetch } from "./html-asset-loader.js";

function decodeDataUri(uri: string): string {
  return atob(uri.slice(uri.indexOf(",") + 1));
}

const fetchBytesFailingOne: ByteFetch = async (path) => {
  if (path === "/ws/bad.png") throw new Error("network error");
  return new Uint8Array([1, 2, 3]);
};

const fetchBytesSingleByte: ByteFetch = async () => new Uint8Array([1]);

describe("loadHtmlAssetBundle", () => {
  it("never calls fetchBytes for a skip-kind ref", async () => {
    let calls = 0;
    const fetchBytes: ByteFetch = async () => {
      calls += 1;
      return new Uint8Array();
    };
    const confined: ConfinedRef[] = [
      { kind: "skip", raw: "../../../etc/passwd", reason: "outside-workspace" },
    ];
    const bundle = await loadHtmlAssetBundle(confined, { root: "/ws", homeDir: null, fetchBytes });
    expect(calls).toBe(0);
    expect(bundle.assets).toEqual({});
    expect(bundle.skipped).toEqual([{ raw: "../../../etc/passwd", reason: "outside-workspace" }]);
  });

  it("fetches each unique path once and shares the result across refs pointing to it (dedupe)", async () => {
    let calls = 0;
    const fetchBytes: ByteFetch = async () => {
      calls += 1;
      return new TextEncoder().encode("hi");
    };
    const confined: ConfinedRef[] = [
      { kind: "local", raw: "logo.png", path: "/ws/logo.png", context: "image" },
      { kind: "local", raw: "logo.png 2x", path: "/ws/logo.png", context: "image" },
    ];
    const bundle = await loadHtmlAssetBundle(confined, { root: "/ws", homeDir: null, fetchBytes });
    expect(calls).toBe(1);
    expect(bundle.assets["logo.png"]).toMatch(/^data:/);
    expect(bundle.assets["logo.png"]).toBe(bundle.assets["logo.png 2x"]);
  });

  it("degrades a failed fetch to skipped without failing the whole bundle", async () => {
    const confined: ConfinedRef[] = [
      { kind: "local", raw: "good.png", path: "/ws/good.png", context: "image" },
      { kind: "local", raw: "bad.png", path: "/ws/bad.png", context: "image" },
    ];
    const bundle = await loadHtmlAssetBundle(confined, {
      root: "/ws",
      homeDir: null,
      fetchBytes: fetchBytesFailingOne,
    });
    expect(bundle.assets["good.png"]).toMatch(/^data:/);
    expect(bundle.assets["bad.png"]).toBeUndefined();
    expect(bundle.skipped).toEqual([{ raw: "bad.png", reason: "fetch-failed" }]);
  });

  it("skips a single asset over the per-asset byte cap", async () => {
    const bigBytes = new Uint8Array(ASSET_LIMITS.maxBytesPerAsset + 1);
    const fetchBytes: ByteFetch = async () => bigBytes;
    const confined: ConfinedRef[] = [
      { kind: "local", raw: "big.bin", path: "/ws/big.bin", context: "image" },
    ];
    const bundle = await loadHtmlAssetBundle(confined, { root: "/ws", homeDir: null, fetchBytes });
    expect(bundle.assets).toEqual({});
    expect(bundle.skipped).toEqual([{ raw: "big.bin", reason: "over-cap" }]);
  });

  it("enforces the total byte cap deterministically regardless of fetch completion order", async () => {
    // Each asset is exactly at the 2 MiB per-asset cap (never over it); the 16 MiB total cap
    // admits exactly 8 — true no matter which of the concurrent fetches happens to settle first,
    // since the cap check + counter update is one synchronous block per settled fetch (no
    // interleaving possible between them).
    const size = ASSET_LIMITS.maxBytesPerAsset;
    const fetchBytes: ByteFetch = async () => new Uint8Array(size);
    const confined: ConfinedRef[] = Array.from({ length: 10 }, (_, i) => ({
      kind: "local" as const,
      raw: `f${i}.bin`,
      path: `/ws/f${i}.bin`,
      context: "image" as const,
    }));
    const bundle = await loadHtmlAssetBundle(confined, { root: "/ws", homeDir: null, fetchBytes });
    const expectedAccepted = Math.floor(ASSET_LIMITS.maxBytesTotal / size);
    expect(Object.keys(bundle.assets)).toHaveLength(expectedAccepted);
    expect(bundle.skipped.filter((s) => s.reason === "over-cap")).toHaveLength(
      10 - expectedAccepted,
    );
  });

  it("enforces the max asset count cap deterministically", async () => {
    const confined: ConfinedRef[] = Array.from({ length: ASSET_LIMITS.maxCount + 6 }, (_, i) => ({
      kind: "local" as const,
      raw: `f${i}.bin`,
      path: `/ws/f${i}.bin`,
      context: "image" as const,
    }));
    const bundle = await loadHtmlAssetBundle(confined, {
      root: "/ws",
      homeDir: null,
      fetchBytes: fetchBytesSingleByte,
    });
    expect(Object.keys(bundle.assets)).toHaveLength(ASSET_LIMITS.maxCount);
    expect(bundle.skipped.filter((s) => s.reason === "over-cap")).toHaveLength(6);
  });

  it("respects bounded parallelism (never more than 6 concurrent fetches)", async () => {
    let active = 0;
    let maxActive = 0;
    const pending: Array<() => void> = [];

    const fetchBytes: ByteFetch = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      const { promise, resolve } = Promise.withResolvers<void>();
      pending.push(resolve);
      await promise;
      active -= 1;
      return new Uint8Array([1]);
    };

    const confined: ConfinedRef[] = Array.from({ length: 12 }, (_, i) => ({
      kind: "local" as const,
      raw: `f${i}.png`,
      path: `/ws/f${i}.png`,
      context: "image" as const,
    }));

    // No wall-clock wait: the loader's pool starts its steady-state concurrency synchronously
    // (each async hop in the call chain runs up to its own first genuine await before control
    // returns here), so `pending` already holds the peak the instant this call returns.
    const bundlePromise = loadHtmlAssetBundle(confined, { root: "/ws", homeDir: null, fetchBytes });
    expect(pending.length).toBe(6);

    // Twelve items in waves of up to 6 concurrent settle well within this many ticks (verified:
    // 6 suffice); the trailing `await bundlePromise` is what actually proves completion.
    for (let tick = 0; tick < 12; tick++) {
      const wave = pending.splice(0, pending.length);
      for (const resolve of wave) resolve();
      await Promise.resolve(); // flush one microtask tick so the next wave registers
    }
    await bundlePromise;

    expect(maxActive).toBeLessThanOrEqual(6);
    expect(maxActive).toBeGreaterThan(1);
  });

  it("recurses one level into an inlined stylesheet's own url() refs and rewrites them", async () => {
    const cssBytes = new TextEncoder().encode('body { background: url("bg.png"); }');
    const bgBytes = new TextEncoder().encode("PNGDATA");
    const fetchBytes: ByteFetch = async (path) => {
      if (path === "/ws/style.css") return cssBytes;
      if (path === "/ws/bg.png") return bgBytes;
      throw new Error(`unexpected path: ${path}`);
    };
    const confined: ConfinedRef[] = [
      { kind: "local", raw: "style.css", path: "/ws/style.css", context: "style" },
    ];
    const bundle = await loadHtmlAssetBundle(confined, { root: "/ws", homeDir: null, fetchBytes });
    const cssUri = bundle.assets["style.css"];
    expect(cssUri).toMatch(/^data:text\/css;base64,/);
    const decoded = decodeDataUri(cssUri!);
    expect(decoded).toContain('url("data:');
    expect(decoded).not.toContain("bg.png");
  });

  it("skips a nested css ref outside the confinement root without fetching it", async () => {
    const cssBytes = new TextEncoder().encode('body { background: url("../../../etc/passwd"); }');
    let outsideFetched = false;
    const fetchBytes: ByteFetch = async (path) => {
      if (path === "/ws/css/style.css") return cssBytes;
      outsideFetched = true;
      throw new Error(`should not fetch: ${path}`);
    };
    const confined: ConfinedRef[] = [
      { kind: "local", raw: "style.css", path: "/ws/css/style.css", context: "style" },
    ];
    const bundle = await loadHtmlAssetBundle(confined, { root: "/ws", homeDir: null, fetchBytes });
    expect(outsideFetched).toBe(false);
    expect(bundle.skipped.some((s) => s.reason === "outside-workspace")).toBe(true);
  });

  it("does not recurse a second level — an @import'd stylesheet inlines as an opaque asset", async () => {
    const outerCss = new TextEncoder().encode('@import url("inner.css");');
    const innerCss = new TextEncoder().encode('body { background: url("bg.png"); }');
    let bgFetched = false;
    const fetchBytes: ByteFetch = async (path) => {
      if (path === "/ws/outer.css") return outerCss;
      if (path === "/ws/inner.css") return innerCss;
      if (path === "/ws/bg.png") {
        bgFetched = true;
        return new Uint8Array([1]);
      }
      throw new Error(`unexpected path: ${path}`);
    };
    const confined: ConfinedRef[] = [
      { kind: "local", raw: "outer.css", path: "/ws/outer.css", context: "style" },
    ];
    const bundle = await loadHtmlAssetBundle(confined, { root: "/ws", homeDir: null, fetchBytes });
    const outerUri = bundle.assets["outer.css"];
    expect(outerUri).toMatch(/^data:text\/css;base64,/);
    const decodedOuter = decodeDataUri(outerUri!);
    expect(decodedOuter).toContain('url("data:text/css');
    expect(bgFetched).toBe(false);
  });
});
