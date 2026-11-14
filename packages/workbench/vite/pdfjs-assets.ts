/**
 * `@av-pi-studio/workbench/vite` — build-time helpers for an application that bundles the
 * workbench with Vite. Node code: loaded by the consumer's `vite.config.ts`, never by the browser.
 *
 * `pdfjsAssetsPlugin()` serves (dev) and emits (build) pdf.js's runtime data directories under
 * `<base>/pdfjs/<dir>/`. The workbench's PDF viewer loads them by URL on demand, from
 * `host.pdf.assetBaseUrl` (the browser host passes `${import.meta.env.BASE_URL}pdfjs/`). Missing
 * files do not fail loudly: pdf.js misrenders the affected PDFs, and behind an SPA fallback a 404
 * would even come back as `index.html` with a 200.
 */

import { createReadStream, readdirSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const PDFJS_ASSET_DIRS = ["cmaps", "standard_fonts", "wasm", "iccs"] as const;

/** The workbench's own `pdfjs-dist`: the data must match the API version the viewer runs. */
const PDFJS_ROOT = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));

/**
 * The slice of Vite's `Plugin` this plugin implements, declared here rather than imported so the
 * package carries no type dependency on any particular `vite` copy: it is assignable to the
 * consumer's own `Plugin` type, whichever Vite 5/6 that is.
 */
export interface PdfjsAssetsPlugin {
  name: string;
  configureServer(server: {
    middlewares: {
      use(handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void): unknown;
    };
  }): void;
  generateBundle(this: {
    emitFile(file: { type: "asset"; fileName: string; source: Uint8Array }): string;
  }): void;
}

/** A request is matched against the real directory listing, never joined onto a filesystem path,
 *  so only those directories' own files are reachable. `quickjs-eval.*` is pdf.js's
 *  PDF-JavaScript engine; the viewer never runs document scripts, so it is not shipped. */
export function pdfjsAssetsPlugin(): PdfjsAssetsPlugin {
  const files = new Map<string, Set<string>>(
    PDFJS_ASSET_DIRS.map((dir) => [
      dir,
      new Set(
        readdirSync(resolve(PDFJS_ROOT, dir)).filter((name) => !name.startsWith("quickjs-eval.")),
      ),
    ]),
  );
  return {
    name: "pi-studio-pdfjs-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const match = /^\/pdfjs\/([^/]+)\/([^/?#]+)/.exec(req.url ?? "");
        const dir = match?.[1];
        const file = match?.[2];
        if (!dir || !file || !files.get(dir)?.has(file)) return next();
        res.setHeader(
          "Content-Type",
          file.endsWith(".wasm") ? "application/wasm" : "application/octet-stream",
        );
        createReadStream(resolve(PDFJS_ROOT, dir, file)).pipe(res);
      });
    },
    generateBundle() {
      for (const [dir, names] of files) {
        for (const name of names) {
          this.emitFile({
            type: "asset",
            fileName: `pdfjs/${dir}/${name}`,
            source: readFileSync(resolve(PDFJS_ROOT, dir, name)),
          });
        }
      }
    },
  };
}
