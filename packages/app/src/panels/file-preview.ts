// File preview panel view model.
// clean-room-scope/features/feature-panels-ui.md § File explorer (preview)

export type FilePreviewKind = "markdown" | "code" | "image" | "binary" | "loading" | "error";

export type FilePreviewTarget = {
  path: string;
  workspaceDir?: string;
  lineStart?: number;
  lineEnd?: number;
};

export type ResolvedReadTarget =
  | { kind: "workspace-relative"; absolutePath: string }
  | { kind: "absolute-within-root"; absolutePath: string }
  | { kind: "absolute-outside-root"; absolutePath: string; derivedRoot: string }
  | { kind: "home-relative"; absolutePath: string };

export function resolveReadTarget(path: string, workspaceDir?: string, homeDir = "/home"): ResolvedReadTarget {
  // ~-relative: expand to homeDir
  if (path.startsWith("~/")) {
    return { kind: "home-relative", absolutePath: `${homeDir}${path.slice(1)}` };
  }
  if (!path.startsWith("/")) {
    // workspace-relative
    const abs = `${workspaceDir?.replace(/\/$/, "") ?? ""}/${path}`;
    return { kind: "workspace-relative", absolutePath: abs };
  }
  if (workspaceDir && path.startsWith(workspaceDir)) {
    return { kind: "absolute-within-root", absolutePath: path };
  }
  // absolute outside workspace root → derive a root as the path's parent
  const parts = path.split("/").filter(Boolean);
  const derivedRoot = `/${parts.slice(0, -1).join("/")}`;
  return { kind: "absolute-outside-root", absolutePath: path, derivedRoot };
}

// Determine what kind of preview to show from the file path extension.
export function detectPreviewKind(path: string): Exclude<FilePreviewKind, "loading" | "error"> {
  const lower = path.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  const imageExts = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"];
  if (imageExts.some((ext) => lower.endsWith(ext))) return "image";
  const binaryExts = [".zip", ".gz", ".tar", ".pdf", ".wasm", ".bin", ".db", ".exe", ".dylib", ".so"];
  if (binaryExts.some((ext) => lower.endsWith(ext))) return "binary";
  return "code";
}

export type LineHighlight = { lineStart: number; lineEnd?: number };

export type FilePreviewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; kind: "image"; resolvedUrl: string; path: string }
  | { status: "ready"; kind: "binary"; size?: number; path: string }
  | { status: "ready"; kind: "markdown"; content: string; path: string }
  | { status: "ready"; kind: "code"; content: string; language: string; path: string; lineHighlight?: LineHighlight; lineCount: number };

export function buildFilePreviewState(input: {
  path: string;
  content?: string;
  size?: number;
  error?: string;
  imageUrl?: string;
  lineStart?: number;
  lineEnd?: number;
}): FilePreviewState {
  if (input.error) return { status: "error", message: input.error };
  const kind = detectPreviewKind(input.path);
  if (kind === "image") {
    return { status: "ready", kind: "image", resolvedUrl: input.imageUrl ?? "", path: input.path };
  }
  if (kind === "binary") {
    return { status: "ready", kind: "binary", size: input.size, path: input.path };
  }
  const content = input.content ?? "";
  if (kind === "markdown") {
    return { status: "ready", kind: "markdown", content, path: input.path };
  }
  // code
  const lines = content.split("\n");
  const lineHighlight: LineHighlight | undefined =
    input.lineStart != null ? { lineStart: input.lineStart, lineEnd: input.lineEnd } : undefined;
  return {
    status: "ready",
    kind: "code",
    content,
    language: extensionOf(input.path),
    path: input.path,
    lineHighlight,
    lineCount: lines.length,
  };
}

export function filePreviewTabLabel(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

export function shouldScrollToLine(state: FilePreviewState): number | undefined {
  if (state.status !== "ready" || state.kind !== "code") return undefined;
  return state.lineHighlight?.lineStart;
}

function extensionOf(path: string): string {
  const m = /\.(\w+)$/.exec(path);
  return m?.[1] ?? "plaintext";
}
