/**
 * tool.kind → display label + icon. Scoped to the protocol's `ToolCallDetail` union
 * (shell/read/edit/write/search/fetch/task) — POC_TO_APP_PLAN_UI.md §3 `timeline/tool-mapping.ts`.
 */

import type { ToolCallDetail } from "@av-pi-studio/protocol";
import {
  Terminal,
  Eye,
  Pencil,
  FilePlus,
  Search,
  Globe,
  ListTree,
  type LucideIcon,
} from "lucide-react";
import { toolDetailText } from "./row-model.js";

const ICON_BY_KIND: Record<ToolCallDetail["kind"], LucideIcon> = {
  shell: Terminal,
  read: Eye,
  edit: Pencil,
  write: FilePlus,
  search: Search,
  fetch: Globe,
  task: ListTree,
};

export function toolIcon(tool: ToolCallDetail): LucideIcon {
  return ICON_BY_KIND[tool.kind] ?? Terminal;
}

/** Human label for a tool card header, e.g. "shell", "edit". */
export function toolLabel(tool: ToolCallDetail): string {
  return tool.kind;
}

/** One-line detail summary for a tool card (POC: `t.command || t.path || t.query || …`). */
export function toolSummary(tool: ToolCallDetail): string {
  return toolDetailText(tool);
}

/** File path a tool touched, if any — used to target `filesChanged` invalidation (§4.5). */
export function toolFilePath(tool: ToolCallDetail): string | null {
  switch (tool.kind) {
    case "read":
    case "write":
    case "edit":
      return tool.path ?? null;
    default:
      return null;
  }
}

/** True for tool kinds whose completion should invalidate open file/diff/explorer/git queries. */
export function toolMutatesFiles(tool: ToolCallDetail): boolean {
  return tool.kind === "write" || tool.kind === "edit" || tool.kind === "shell";
}

/**
 * Expandable detail body for a tool card, as an ordered list of sections. `diff` renders as a
 * `<DiffView>`; `code` renders in a monospace block. Order: input detail (command/path/query/…)
 * first, then tool output (stdout, file content, etc.) if present. Empty array = header-only card
 * with nothing worth expanding.
 */
export type ToolBodySection = { kind: "diff"; patch: string } | { kind: "code"; text: string };

export function toolBody(tool: ToolCallDetail): ToolBodySection[] {
  const sections: ToolBodySection[] = [];
  if (tool.kind === "edit" && tool.diff) sections.push({ kind: "diff", patch: tool.diff });
  else {
    const text = toolDetailText(tool);
    if (text) sections.push({ kind: "code", text });
  }
  if (tool.output) sections.push({ kind: "code", text: tool.output });
  return sections;
}

/** Concise inline label shown in the collapsed header (basename for paths, first line for commands). */
export function toolInlineDetail(tool: ToolCallDetail): string {
  const text = toolDetailText(tool);
  if (!text) return "";
  switch (tool.kind) {
    case "read":
    case "write":
    case "edit": {
      const parts = text.split("/");
      return parts[parts.length - 1] || text;
    }
    case "shell": {
      const firstLine = text.split("\n", 1)[0] ?? text;
      return firstLine;
    }
    default:
      return text;
  }
}

/** Badge label + single tint token for a tool card header (design spec § 04's one-token recipe —
 * text, background and border all derive from this one token via CSS `color-mix`, never split
 * across token families). Keep this table and `ICON_BY_KIND` as separate exports keyed by the
 * same union so the compiler flags a new protocol kind in both places. */
export type ToolBadge = { label: string; token: string };

// `statusSuccess`, never `success` — `success` aliases the accent color on dark theme variants
// (`theme/colors.ts` `buildDarkColors`), which would make the WRITE badge indistinguishable from
// READ/SHELL's tint. `statusInfo`, never `accent`/`accentBright`, for shell/read/search/fetch: the
// brand accent varies too much across variants to double as always-legible badge text — `accent`
// itself (`#2e5cb8` on the default dark theme) is too dark for good contrast against the card's
// dark surface (user feedback), and `accentBright` (`#a2b4d7`) fixed the contrast but read as too
// pale/washed out (user feedback again). `statusInfo` is a fixed, vivid, theme-invariant blue
// (`#3b82f6` dark / `#2563eb` light — same rationale and shape as `statusSuccess`/`statusWarning`),
// so it stays both legible and saturated in every variant without depending on the accent tint.
const BADGE_BY_KIND: Record<ToolCallDetail["kind"], ToolBadge> = {
  shell: { label: "SHELL", token: "statusInfo" },
  read: { label: "READ", token: "statusInfo" },
  write: { label: "WRITE", token: "statusSuccess" },
  edit: { label: "EDIT", token: "statusWarning" },
  search: { label: "SEARCH", token: "statusInfo" },
  fetch: { label: "FETCH", token: "statusInfo" },
  task: { label: "TASK", token: "foregroundMuted" },
};

/** Badge for a tool card header. Unrecognized/future kinds fall back to `task`'s treatment. */
export function toolBadge(tool: ToolCallDetail): ToolBadge {
  return BADGE_BY_KIND[tool.kind] ?? BADGE_BY_KIND.task;
}

/** Added/removed line counts from a unified diff, ignoring the `+++`/`---` file-header lines.
 * Empty or absent diff → `{ added: 0, removed: 0 }`. */
export function toolDiffStats(diff: string | undefined): { added: number; removed: number } {
  if (!diff) return { added: 0, removed: 0 };
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) removed++;
  }
  return { added, removed };
}

/** Line count for a tool's output, for the `output · N lines` strip. A trailing newline is a
 * terminator, not a phantom extra line (`"a\nb\n"` → 2); empty output → 0 (caller renders no
 * strip); a single blank line (`"\n"`) → 1. */
export function toolOutputLineCount(output: string | undefined): number {
  if (!output) return 0;
  const body = output.endsWith("\n") ? output.slice(0, -1) : output;
  return body.split("\n").length;
}

/**
 * Full, untruncated primary field for the redesigned tool card header (full `path`/`command`/…,
 * CSS-ellipsised rather than shortened to a basename/first line like `toolInlineDetail`). Re-export
 * under an explicit name so components read intent instead of reaching past this module for
 * `toolDetailText` directly.
 */
export { toolDetailText as toolPrimaryField };
