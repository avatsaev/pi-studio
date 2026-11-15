import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

function pdfjsRange(manifestUrl: string): string | undefined {
  const manifest = JSON.parse(readFileSync(fileURLToPath(new URL(manifestUrl, import.meta.url)), "utf8"));
  return manifest.dependencies?.["pdfjs-dist"];
}

// The worker is built from this package's `pdfjs-dist`, the API and the data files from the
// workbench's. Different versions fail when a PDF is opened ("The API version does not match the
// Worker version"), not at build time.
test("this app and the workbench declare the same pdfjs-dist range", () => {
  const own = pdfjsRange("../package.json");
  expect(own).toBeDefined();
  expect(own).toBe(pdfjsRange("../../../../packages/workbench/package.json"));
});
