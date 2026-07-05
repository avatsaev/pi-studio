// Diff row model and hunk parsing.
// clean-room-scope/features/timeline-rendering.md § Diff rows

export type DiffLineType = "add" | "remove" | "context" | "header";

export type DiffToken = { type: string; value: string };

export type DiffLine = {
  type: DiffLineType;
  prefix: string;
  content: string;
  tokens?: DiffToken[];
  wordDiff?: Array<{ type: "equal" | "add" | "remove"; value: string }>;
};

export type DiffHunk = {
  header: string;
  lines: DiffLine[];
};

export type DiffStat = {
  added: number;
  removed: number;
};

export type ParsedDiff = {
  filePath?: string;
  hunks: DiffHunk[];
  stat: DiffStat;
  truncated: boolean;
};

const MAX_DIFF_LINES = 500;

export function parseDiff(raw: string, filePath?: string): ParsedDiff {
  const lines = raw.split("\n");
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | undefined;
  let stat: DiffStat = { added: 0, removed: 0 };
  let truncated = false;
  let count = 0;

  for (const line of lines) {
    if (count > MAX_DIFF_LINES) { truncated = true; break; }
    if (line.startsWith("@@")) {
      current = { header: line, lines: [] };
      hunks.push(current);
    } else if (current) {
      const type = diffLineType(line);
      const prefix = line.length > 0 ? line[0]! : " ";
      const content = line.length > 1 ? line.slice(1) : "";
      current.lines.push({ type, prefix, content });
      if (type === "add") stat.added++;
      else if (type === "remove") stat.removed++;
      count++;
    }
  }
  return { filePath, hunks, stat, truncated };
}

function diffLineType(line: string): DiffLineType {
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "remove";
  if (line.startsWith("@@") || line.startsWith("diff") || line.startsWith("---") || line.startsWith("+++")) return "header";
  return "context";
}

export type DiffRowViewModel = {
  filePath?: string;
  stat: DiffStat;
  hunks: DiffHunk[];
  collapsed: boolean;
  canExpand: boolean;
  truncated: boolean;
};

export function buildDiffRowViewModel(raw: string, filePath?: string): DiffRowViewModel {
  const parsed = parseDiff(raw, filePath);
  const totalLines = parsed.hunks.reduce((n, h) => n + h.lines.length, 0);
  return {
    filePath: parsed.filePath,
    stat: parsed.stat,
    hunks: parsed.hunks,
    collapsed: totalLines > 30,
    canExpand: totalLines > 30,
    truncated: parsed.truncated,
  };
}

export function diffStatLabel(stat: DiffStat): string {
  const parts: string[] = [];
  if (stat.added > 0) parts.push(`+${stat.added}`);
  if (stat.removed > 0) parts.push(`-${stat.removed}`);
  return parts.join(" ");
}
