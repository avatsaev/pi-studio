/**
 * Locks the host seam (`swe/architecture/workbench-host-adapter.md`): outside the browser host's
 * own implementation (`host/browser-*.ts`), no workbench source may reach for a browser-bound API.
 * Each one has a host member instead. Comments are stripped first, so documentation may name them.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("..", import.meta.url));

/** Forbidden token → what to use instead. */
const FORBIDDEN: Readonly<Record<string, string>> = {
  localStorage: "host.storage",
  sessionStorage: "host.storage",
  "navigator.clipboard": "host.clipboard",
  "window.confirm": "host.dialogs.confirm",
  "window.alert": "host.dialogs.alert",
  "window.prompt": "the in-app dialogs (RenameSessionDialog); the host has no text prompt",
  "dialogs.prompt": "the in-app dialogs (RenameSessionDialog); the host has no text prompt",
  "window.location": "host.launch",
  "window.history": "host.launch.agentDeepLink.consume",
  "window.open": "host.links.openExternal",
  "import.meta.env": "host.app / host.pdf.assetBaseUrl",
  "?worker": "host.pdf.createWorker",
  "new WebSocket(": "host.connection.createTransport",
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "test" ? [] : sourceFiles(path);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    if (/^host\/browser-[^/]+\.ts$/.test(relative(SRC, path))) return [];
    return [path];
  });
}

/** Removes block comments and `//` line comments (but not the `//` inside `https://`). */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function findHostViolations(files: readonly string[]): string[] {
  return files.flatMap((file) => {
    const code = stripComments(readFileSync(file, "utf8"));
    return Object.entries(FORBIDDEN)
      .filter(([token]) => code.includes(token))
      .map(([token, instead]) => `${relative(SRC, file)}: ${token} (use ${instead})`);
  });
}

describe("host seam guard", () => {
  const files = sourceFiles(SRC);

  it("scans the whole application, not a handful of files", () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it("finds no browser-bound API outside the browser host", () => {
    expect(findHostViolations(files)).toEqual([]);
  });
});
