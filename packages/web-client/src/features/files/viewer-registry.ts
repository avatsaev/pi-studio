/**
 * File-viewer registry — maps a detected file kind to the viewer component that renders it
 * (POC_TO_APP_PLAN_UI.md §4.5 follow-up: modular file preview). `FilePanel` detects the kind from
 * `path` (extension) and the explorer's binary `mimeHint` (for extension-less/ambiguous files),
 * then looks up the viewer here — adding a new file type is one entry in `VIEWER_REGISTRY`.
 *
 * Second dispatch path: the file explorer calls `isMoleculeFile` (below) to pick a tab's *kind*
 * (`"molecule"` vs `"file"`) before any panel mounts — molecule files never go through
 * `detectViewerKind`/`VIEWER_BY_KIND`/`FilePanel` at all (they get their own dedicated panel).
 */

import { lazy, type ComponentType } from "react";

export type ViewerKind = "text" | "markdown" | "image" | "video" | "binary" | "html";

export interface ViewerProps {
  /** Explorer-relative or absolute path, as opened from the file tree/diff panel. */
  path: string;
  /** The owning tab's workspace root ("~" expanded by the consumer). */
  workspaceCwd: string;
}

/** Describes a registered file viewer — the single source of truth for file-type dispatch. */
export interface ViewerDescriptor {
  kind: ViewerKind;
  component: ComponentType<ViewerProps>;
  extensions: readonly string[];
  mimePrefixes?: readonly string[];
  /** Whether files of this kind are watched for live refresh — required (no implicit default). */
  liveRefresh: boolean;
}

const TextViewer = lazy(() => import("./TextViewer.js").then((m) => ({ default: m.TextViewer })));
const MarkdownFileViewer = lazy(() =>
  import("./MarkdownFileViewer.js").then((m) => ({ default: m.MarkdownFileViewer })),
);
const ImageViewer = lazy(() =>
  import("./ImageViewer.js").then((m) => ({ default: m.ImageViewer })),
);
const VideoViewer = lazy(() =>
  import("./VideoViewer.js").then((m) => ({ default: m.VideoViewer })),
);
const BinaryFallbackViewer = lazy(() =>
  import("./BinaryFallbackViewer.js").then((m) => ({ default: m.BinaryFallbackViewer })),
);
const HtmlViewer = lazy(() => import("./HtmlViewer.js").then((m) => ({ default: m.HtmlViewer })));

/**
 * The single registry of file viewers — adding a new file type is one entry here. All lookup
 * structures are derived from this table at module load and frozen: VIEWER_BY_KIND, the
 * live-refresh set, extension and MIME lookups, and isMoleculeFile remain unchanged.
 */
export const VIEWER_REGISTRY: readonly ViewerDescriptor[] = [
  {
    kind: "text",
    component: TextViewer,
    extensions: [],
    liveRefresh: true,
  },
  {
    kind: "markdown",
    component: MarkdownFileViewer,
    extensions: ["md", "markdown", "mdx"],
    liveRefresh: true,
  },
  {
    kind: "html",
    component: HtmlViewer,
    extensions: ["html", "htm", "xhtml"],
    liveRefresh: true,
  },
  {
    kind: "image",
    component: ImageViewer,
    extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"],
    mimePrefixes: ["image/"],
    liveRefresh: true,
  },
  {
    kind: "video",
    component: VideoViewer,
    extensions: ["mp4", "webm", "mov", "m4v", "ogv"],
    mimePrefixes: ["video/"],
    liveRefresh: false,
  },
  {
    kind: "binary",
    component: BinaryFallbackViewer,
    extensions: ["pdf", "zip", "gz", "tar", "exe", "wasm", "woff", "woff2", "ttf", "otf"],
    liveRefresh: false,
  },
];

/** Derived: maps ViewerKind to its component. */
export const VIEWER_BY_KIND: Record<ViewerKind, ComponentType<ViewerProps>> = Object.freeze(
  Object.fromEntries(VIEWER_REGISTRY.map((desc) => [desc.kind, desc.component])) as Record<
    ViewerKind,
    ComponentType<ViewerProps>
  >,
);

/** Derived: maps extension (lowercase, no dot) to ViewerKind. */
const EXT_TO_VIEWER: Record<string, ViewerKind> = Object.freeze(
  Object.fromEntries(
    VIEWER_REGISTRY.flatMap((desc) => desc.extensions.map((ext) => [ext, desc.kind])),
  ),
);

/** Derived: ordered MIME prefix matches (prefix → kind). */
const MIME_PREFIX_TO_VIEWER: readonly (readonly [prefix: string, kind: ViewerKind])[] =
  Object.freeze(
    VIEWER_REGISTRY.flatMap((desc) =>
      (desc.mimePrefixes ?? []).map((prefix) => [prefix, desc.kind] as const),
    ),
  );

/**
 * Derived: the set of viewer kinds that should watch for live file changes. Used by
 * `useFileLiveRefresh` to gate file watches — watching video would restart playback from zero
 * on every refresh, and binary never fetches eagerly so there is nothing to refresh.
 */
export const LIVE_REFRESH_KINDS: ReadonlySet<ViewerKind> = Object.freeze(
  new Set(VIEWER_REGISTRY.filter((desc) => desc.liveRefresh).map((desc) => desc.kind)),
);

function extOf(path: string): string {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Extensions molviewer's built-in readers handle (its `readers/index.ts` registration list). */
export const MOLECULE_EXTENSIONS: Readonly<Record<string, true>> = {
  pdb: true,
  cif: true,
  mmcif: true,
  mol: true,
  mol2: true,
  xyz: true,
  extxyz: true,
  gro: true,
  lammpstrj: true,
  xsf: true,
};

/** Extension-less VASP structure files, matched by exact (case-insensitive) basename. */
export const MOLECULE_FILENAMES: Readonly<Record<string, true>> = { poscar: true, contcar: true };

/**
 * True when `path` is a molecular structure file molviewer can render. Pure and synchronous — no
 * file reads. LAMMPS `data` files are deliberately excluded (no fixed extension; content-sniffing
 * would make this async) and keep opening as plain text.
 */
export function isMoleculeFile(path: string): boolean {
  if (MOLECULE_EXTENSIONS[extOf(path)]) return true;
  const name = path.split("/").pop() ?? path;
  return Boolean(MOLECULE_FILENAMES[name.toLowerCase()]);
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
