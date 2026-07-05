// File-link chip detection and path-link parsing.
// clean-room-scope/features/timeline-rendering.md § File-link chips / inline path links

export type FileLinkTarget =
  | { kind: "file"; path: string; lineStart?: number; lineEnd?: number }
  | { kind: "directory"; path: string }
  | { kind: "external"; url: string };

export type InlinePathLink = {
  raw: string;
  target: FileLinkTarget;
  workspaceRelative?: string;
};

const ABS_PATH_RE = /(?:^|[\s`"'(])(\/([\w.-]+\/)*[\w.-]+(?::\d+(?:-\d+)?)?)/g;
const FILE_URL_RE = /^file:\/\/(\/[^)\s]+)/;
const URL_RE = /^https?:\/\//;

export function detectInlinePathLinks(text: string, workspaceDir?: string): InlinePathLink[] {
  const results: InlinePathLink[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(ABS_PATH_RE.source, "g");
  while ((match = re.exec(text)) !== null) {
    const raw = match[1]!.trim();
    const [pathPart, range] = raw.split(":");
    const target: FileLinkTarget = { kind: "file", path: pathPart ?? raw };
    if (range) {
      const [start, end] = range.split("-").map(Number);
      (target as { lineStart?: number; lineEnd?: number }).lineStart = start;
      if (end) (target as { lineEnd?: number }).lineEnd = end;
    }
    results.push({ raw, target, workspaceRelative: workspaceDir && pathPart?.startsWith(workspaceDir) ? pathPart.slice(workspaceDir.length + 1) : undefined });
  }
  return results;
}

export function parseFileUrl(href: string): FileLinkTarget | null {
  const m = FILE_URL_RE.exec(href);
  if (m) return { kind: "file", path: m[1]! };
  if (URL_RE.test(href)) return { kind: "external", url: href };
  return null;
}

export type FileLinkTooltip = {
  workspaceRelative: string;
  sidePane: boolean;
};

export function buildFileLinkTooltip(path: string, workspaceDir: string | undefined): FileLinkTooltip {
  const rel = workspaceDir && path.startsWith(workspaceDir) ? path.slice(workspaceDir.length + 1) : path;
  return { workspaceRelative: rel, sidePane: true };
}
