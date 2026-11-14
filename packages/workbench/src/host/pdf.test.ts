import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installHost, resetHostForTests } from "./install.js";
import { createTestHost } from "../test/test-host.js";
import { loadPdfjs, PdfUnavailableError, pdfjsAssetUrls } from "../features/files/pdfjs-runtime.js";

function pdfjsRange(pkg: string): string | undefined {
  const path = fileURLToPath(new URL(`../../../${pkg}/package.json`, import.meta.url));
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  return manifest.dependencies?.["pdfjs-dist"] ?? manifest.devDependencies?.["pdfjs-dist"];
}

beforeEach(() => resetHostForTests());

describe("pdf.js runtime through the host", () => {
  it("derives every data-directory URL from the host's base, with or without a trailing slash", () => {
    const expected = {
      cMapUrl: "https://app.example/sub/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "https://app.example/sub/pdfjs/standard_fonts/",
      wasmUrl: "https://app.example/sub/pdfjs/wasm/",
      iccUrl: "https://app.example/sub/pdfjs/iccs/",
    };
    expect(pdfjsAssetUrls("/sub/pdfjs/", "https://app.example/sub/index.html")).toEqual(expected);
    expect(pdfjsAssetUrls("/sub/pdfjs", "https://app.example/x")).toEqual(expected);
    expect(pdfjsAssetUrls("pdfjs/", "https://app.example/sub/")).toEqual(expected);
  });

  it("fails with the typed error when the host has no pdf member", () => {
    installHost(createTestHost());
    expect(() => loadPdfjs()).toThrow(PdfUnavailableError);
  });

  it("builds the worker once, from the host", () => {
    vi.stubGlobal("document", { baseURI: "https://app.example/" });
    // pdf.js accepts only `instanceof Worker` as its port; Node has no Worker, so provide a class.
    class FakeWorker {}
    vi.stubGlobal("Worker", FakeWorker);
    const createWorker = vi.fn(() => new FakeWorker() as unknown as Worker);
    installHost({ ...createTestHost(), pdf: { createWorker, assetBaseUrl: "/pdfjs/" } });

    const first = loadPdfjs();
    loadPdfjs();

    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(first.assetUrls.wasmUrl).toBe("https://app.example/pdfjs/wasm/");
    vi.unstubAllGlobals();
  });
});

describe("pdfjs-dist versions", () => {
  // The worker comes from web-client's `pdfjs-dist`, the API and data from the workbench's: a
  // mismatch fails at run time ("The API version does not match the Worker version").
  it("web-client and the workbench declare the same pdfjs-dist range", () => {
    expect(pdfjsRange("web-client")).toBeDefined();
    expect(pdfjsRange("web-client")).toBe(pdfjsRange("workbench"));
  });
});
