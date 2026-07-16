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
