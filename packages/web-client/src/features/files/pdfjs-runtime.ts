/**
 * pdf.js's only app import site. The PDF viewer is lazy, so this module (and its `vendor-pdfjs`
 * dependency) is not fetched until a PDF tab opens. A shared worker parses every open document;
 * each document owns its own lifetime on that worker. Static data URLs match `pdfjsAssetsPlugin`
 * in vite.config.ts, resolved against the app base so both web (`/`) and Electron (`./`) work.
 */

import * as pdfjs from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";

const assetBase = new URL(`${import.meta.env.BASE_URL}pdfjs/`, document.baseURI);

export const PDFJS_ASSET_URLS = {
  cMapUrl: new URL("cmaps/", assetBase).href,
  cMapPacked: true,
  standardFontDataUrl: new URL("standard_fonts/", assetBase).href,
  wasmUrl: new URL("wasm/", assetBase).href,
  iccUrl: new URL("iccs/", assetBase).href,
} as const;

export function loadPdfjs(): typeof pdfjs {
  pdfjs.GlobalWorkerOptions.workerPort ??= new PdfWorker({ name: "pdfjs" });
  return pdfjs;
}
