/**
 * pdf.js's only import site. The PDF viewer is lazy, so this module (and its `pdfjs-dist`
 * dependency) is not fetched until a PDF tab opens. A shared worker parses every open document;
 * each document owns its own lifetime on that worker. Both the worker and the data-directory URL
 * come from the host's `pdf` member: only the application bundle can build a worker, and only it
 * knows where `@av-pi-studio/workbench/vite`'s `pdfjsAssetsPlugin` serves the data.
 */

import * as pdfjs from "pdfjs-dist";
import { getHost } from "../../host/install.js";

/** The host has no `pdf` member: this application does not provide a PDF runtime. */
export class PdfUnavailableError extends Error {
  override name = "PdfUnavailableError";
  constructor() {
    super("PDF preview is not available in this application.");
  }
}

export interface PdfjsAssetUrls {
  cMapUrl: string;
  cMapPacked: true;
  standardFontDataUrl: string;
  wasmUrl: string;
  iccUrl: string;
}

/** pdf.js's data-directory options, resolved from the host's base (a missing trailing slash would
 *  make `new URL()` drop the last path segment). */
export function pdfjsAssetUrls(assetBaseUrl: string, documentBase: string): PdfjsAssetUrls {
  const base = new URL(
    assetBaseUrl.endsWith("/") ? assetBaseUrl : `${assetBaseUrl}/`,
    documentBase,
  );
  return {
    cMapUrl: new URL("cmaps/", base).href,
    cMapPacked: true,
    standardFontDataUrl: new URL("standard_fonts/", base).href,
    wasmUrl: new URL("wasm/", base).href,
    iccUrl: new URL("iccs/", base).href,
  };
}

/** pdf.js with its worker attached, plus the asset options every `getDocument` call needs.
 *  Throws `PdfUnavailableError` when the host has no `pdf` member. */
export function loadPdfjs(): { pdfjs: typeof pdfjs; assetUrls: PdfjsAssetUrls } {
  const pdf = getHost().pdf;
  if (!pdf) throw new PdfUnavailableError();
  pdfjs.GlobalWorkerOptions.workerPort ??= pdf.createWorker();
  return { pdfjs, assetUrls: pdfjsAssetUrls(pdf.assetBaseUrl, document.baseURI) };
}
