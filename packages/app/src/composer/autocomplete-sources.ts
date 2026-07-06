// Autocomplete data sources — merge slash commands (client + provider),
// fuzzy-match file mentions from the workspace tree, and build agent
// mode/model config-update payloads.
//
// Pure and framework-agnostic; the React glue lives in
// `hooks/use-composer-autocomplete.ts` + the Composer component.
//
// clean-room-scope/features/composer-ui.md § Slash-command & file-mention
//   autocomplete, § Provider / model / mode / feature controls

import { CLIENT_SLASH_COMMANDS, type SlashCommandOption, type FileOption } from "./autocomplete.js";
import type { ProviderMode } from "@av-pi-studio/protocol";

// ─── Slash commands ────────────────────────────────────────────────────────

export interface SlashCommandSourceInput {
  /** Provider-advertised commands (from capabilities / manifest). */
  providerCommands: SlashCommandOption[];
  /** True in a draft (no agent yet) — only provider commands list. */
  isDraft?: boolean;
  /** True for an inline `/skill` mid-text — only provider commands. */
  inline?: boolean;
  /** Current typed token (e.g. "/ex" or "ex"). */
  query: string;
}

/** Rank: exact-name = 0, prefix = 1, description-contains = 2 (lower = better). */
function rankCommand(opt: SlashCommandOption, q: string): number {
  const name = opt.name.toLowerCase();
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (opt.description.toLowerCase().includes(q)) return 2;
  return 3;
}

/**
 * Merge + filter + rank slash-command options. Client commands only appear at
 * the root (not draft, not inline). De-dupes by name (provider wins on clash).
 */
export function mergeSlashCommands(input: SlashCommandSourceInput): SlashCommandOption[] {
  const includeClient = !input.isDraft && !input.inline;
  const byName = new Map<string, SlashCommandOption>();
  if (includeClient) {
    for (const c of CLIENT_SLASH_COMMANDS) byName.set(c.name, c);
  }
  // Provider commands win on name clash.
  for (const c of input.providerCommands) byName.set(c.name, c);

  const q = input.query.replace(/^\//, "").toLowerCase();
  const all = [...byName.values()];
  const filtered = q
    ? all.filter((opt) => rankCommand(opt, q) < 3)
    : all;
  return filtered.sort((a, b) => {
    if (!q) return a.name.localeCompare(b.name);
    const ra = rankCommand(a, q);
    const rb = rankCommand(b, q);
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });
}

// ─── File mentions ─────────────────────────────────────────────────────────

export interface FileMentionEntry {
  path: string;
  kind: "file" | "directory" | "symlink";
  name: string;
}

/** True if `query` is a (case-insensitive) subsequence of `text`. */
export function isSubsequence(query: string, text: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

/** Rank a file candidate against a query (lower = better). */
function rankFile(name: string, path: string, q: string): number {
  const n = name.toLowerCase();
  const p = path.toLowerCase();
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (n.includes(q)) return 2;
  if (p.includes(q)) return 3;
  if (isSubsequence(q, n)) return 4;
  if (isSubsequence(q, p)) return 5;
  return 99;
}

/**
 * Fuzzy-match workspace files by name/path. An empty query returns
 * `recentPaths` (in order) if provided, else the first `limit` entries.
 */
export function fuzzyMatchFiles(
  entries: FileMentionEntry[],
  query: string,
  opts: { limit?: number; recentPaths?: string[] } = {},
): FileOption[] {
  const limit = opts.limit ?? 10;
  const q = query.trim().toLowerCase();

  if (!q) {
    const recent = opts.recentPaths ?? [];
    const byPath = new Map(entries.map((e) => [e.path, e]));
    const recents = recent
      .map((p) => byPath.get(p))
      .filter((e): e is FileMentionEntry => !!e);
    const source = recents.length > 0 ? recents : entries;
    return source.slice(0, limit).map(toFileOption);
  }

  const scored = entries
    .map((e) => ({ e, r: rankFile(e.name, e.path, q) }))
    .filter((s) => s.r < 99)
    .sort((a, b) => (a.r !== b.r ? a.r - b.r : a.e.path.length - b.e.path.length));
  return scored.slice(0, limit).map((s) => toFileOption(s.e));
}

function toFileOption(e: FileMentionEntry): FileOption {
  return { path: e.path, kind: e.kind === "directory" ? "directory" : "file", label: e.name };
}

// ─── Agent mode / model controls ──────────────────────────────────────────────

export interface ModeOption {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  colorTier: ProviderMode["colorTier"];
}

export function providerModesToOptions(modes: readonly ProviderMode[]): ModeOption[] {
  return modes.map((m) => ({
    id: m.id,
    label: m.label ?? m.id,
    description: m.description,
    icon: m.icon,
    colorTier: m.colorTier,
  }));
}

export interface AgentConfigUpdate {
  modeId?: string;
  model?: string;
  thinkingOptionId?: string;
  featureValues?: Record<string, unknown>;
}

/** Build a minimal, defined-only agent config-update payload. */
export function buildAgentConfigUpdate(input: AgentConfigUpdate): AgentConfigUpdate {
  const out: AgentConfigUpdate = {};
  if (input.modeId !== undefined) out.modeId = input.modeId;
  if (input.model !== undefined) out.model = input.model;
  if (input.thinkingOptionId !== undefined) out.thinkingOptionId = input.thinkingOptionId;
  if (input.featureValues !== undefined) out.featureValues = input.featureValues;
  return out;
}
