/**
 * File-viewer registry — maps a detected file kind to the viewer component that renders it
 * (POC_TO_APP_PLAN_UI.md §4.5 follow-up: modular file preview). `FilePanel` detects the kind from
 * `path` (extension) and the explorer's binary `mimeHint` (for extension-less/ambiguous files),
 * then looks up the viewer here — adding a new file type is one entry in `EXT_TO_VIEWER`/
 * `MIME_PREFIX_TO_VIEWER` plus one entry in `VIEWER_BY_KIND`, no changes to `FilePanel` itself.
 */

import { lazy, type ComponentType } from "react";

export type ViewerKind = "text" | "markdown" | "image" | "video" | "binary";

export interface ViewerProps {
  /** Explorer-relative or absolute path, as opened from the file tree/diff panel. */
  path: string;
}

const TextViewer = lazy(() => import("./TextViewer.js").then((m) => ({ default: m.TextViewer })));
const MarkdownFileViewer = lazy(() =>
  import("./MarkdownFileViewer.js").then((m) => ({ default: m.MarkdownFileViewer })),
);
const ImageViewer = lazy(() => import("./ImageViewer.js").then((m) => ({ default: m.ImageViewer })));
const VideoViewer = lazy(() => import("./VideoViewer.js").then((m) => ({ default: m.VideoViewer })));
const BinaryFallbackViewer = lazy(() =>
  import("./BinaryFallbackViewer.js").then((m) => ({ default: m.BinaryFallbackViewer })),
);

/** One component per `ViewerKind`. Register a new file type here — nowhere else. */
export const VIEWER_BY_KIND: Record<ViewerKind, ComponentType<ViewerProps>> = {
  text: TextViewer,
  markdown: MarkdownFileViewer,
  image: ImageViewer,
  video: VideoViewer,
  binary: BinaryFallbackViewer,
};

const EXT_TO_VIEWER: Record<string, ViewerKind> = {
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",

  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  bmp: "image",
  ico: "image",
  avif: "image",

  mp4: "video",
  webm: "video",
  mov: "video",
  m4v: "video",
  ogv: "video",

  // No dedicated preview yet — show the binary fallback (name + manual download) instead of
  // dumping raw/garbled bytes into the text viewer.
  pdf: "binary",
  zip: "binary",
  gz: "binary",
  tar: "binary",
  exe: "binary",
  wasm: "binary",
  woff: "binary",
  woff2: "binary",
  ttf: "binary",
  otf: "binary",
};

const MIME_PREFIX_TO_VIEWER: Array<[prefix: string, kind: ViewerKind]> = [
  ["image/", "image"],
  ["video/", "video"],
];

function extOf(path: string): string {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * Detects the viewer kind for a file, preferring the extension (fast, always available) and
 * falling back to a server-supplied MIME hint (extension-less files, e.g. binary blobs the
 * explorer sniffed) — `isBinary` further distinguishes an unrecognized binary from unrecognized
 * text, so unknown-but-textual files (`.env`, `.gitignore`) still fall through to `TextViewer`.
 */
export function detectViewerKind(
  path: string,
  opts: { mimeHint?: string; isBinary?: boolean } = {},
): ViewerKind {
  const byExt = EXT_TO_VIEWER[extOf(path)];
  if (byExt) return byExt;

  const mime = opts.mimeHint ?? "";
  for (const [prefix, kind] of MIME_PREFIX_TO_VIEWER) {
    if (mime.startsWith(prefix)) return kind;
  }

  if (opts.isBinary) return "binary";
  return "text";
}
