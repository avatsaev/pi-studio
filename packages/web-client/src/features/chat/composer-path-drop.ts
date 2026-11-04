/**
 * Pure text decisions for dropping a Files-tree row onto the composer: which path to insert, how to
 * quote it, and where the spaces go. No DOM, so every edge case is Node-tested; `Composer.tsx` only
 * wires the result to the textarea.
 *
 * swe/features/composer-path-drop.md § Public contract 5, § Behavior & algorithms
 */

import { normalizeCwd } from "@pi-studio-ui/features/sessions/workspace-grouping.js";

/**
 * The root a dropped path is made relative to: the composer's own session cwd, normalised exactly as
 * the Files tree roots itself, without a trailing `/`. `null` when it is still an unresolved `~`
 * (`homeDir` not known yet) or empty — the drop is refused rather than guessed.
 */
export function refRoot(sessionCwd: string, homeDir: string | null): string | null {
  const root = normalizeCwd(sessionCwd || "~", homeDir).replace(/\/+$/, "");
  return root === "" || root.startsWith("~") ? null : root;
}

/**
 * Strict workspace-relative path: `null` unless `absPath` is inside `root` on a **segment boundary**
 * (`/repo2/x` is not under `/repo`). A trailing `/` (a folder) is preserved. The root itself is
 * `null` too.
 *
 * `lib/paths.ts`'s `relativeToRoot` is deliberately not reused: it returns an out-of-root path
 * unchanged, which would insert an absolute path, and has no segment-boundary check.
 */
export function relativeRefPath(absPath: string, root: string | null): string | null {
  if (!root || root.startsWith("~")) return null;
  const isDir = absPath.endsWith("/");
  const bare = isDir ? absPath.slice(0, -1) : absPath;
  if (!bare.startsWith(`${root}/`)) return null;
  const rel = bare.slice(root.length + 1);
  if (rel === "") return null;
  return isDir ? `${rel}/` : rel;
}

/**
 * The text a path becomes in the draft: bare unless it contains whitespace or a backtick, in which
 * case it is a CommonMark code span — a fence one backtick longer than the longest run inside, padded
 * with a space on both sides when the path starts or ends with a backtick.
 */
export function formatRefToken(rel: string): string {
  if (!/[\s`]/.test(rel)) return rel;
  let longest = 0;
  for (const run of rel.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  const fence = "`".repeat(longest + 1);
  const pad = rel.startsWith("`") || rel.endsWith("`") ? " " : "";
  return `${fence}${pad}${rel}${pad}${fence}`;
}

export interface InsertionPlan {
  /** Replace `[start, end)` of the draft… */
  start: number;
  end: number;
  /** …with this: the token plus any spacing. */
  insert: string;
  /** Caret offset in the new text after the replacement. */
  caret: number;
}

/**
 * Smart spacing around an inserted token. Spacing is judged from the characters **outside** the
 * replaced range: a leading space only when glued to a non-whitespace character, a trailing space
 * unless whitespace already follows (so nothing is doubled). Offsets are clamped to the text and
 * ordered, so a stale or reversed selection never throws.
 */
export function planInsertion(
  text: string,
  selStart: number,
  selEnd: number,
  token: string,
): InsertionPlan {
  const clamp = (n: number) => Math.min(Math.max(Number.isFinite(n) ? n : 0, 0), text.length);
  const a = clamp(selStart);
  const b = clamp(selEnd);
  const start = Math.min(a, b);
  const end = Math.max(a, b);
  const lead = start > 0 && !/\s/.test(text[start - 1]!) ? " " : "";
  const trail = end >= text.length || !/\s/.test(text[end]!) ? " " : "";
  const insert = `${lead}${token}${trail}`;
  return { start, end, insert, caret: start + insert.length };
}

export type ComposerDrop =
  | { kind: "ignore" }
  | { kind: "refuse" }
  | { kind: "insert"; plan: InsertionPlan };

export interface ComposerDropInput {
  /** The decoded path-ref value (`readPathRef`), `null` when absent or blank. */
  refValue: string | null;
  compacting: boolean;
  /** `refRoot` of the composer's own session. */
  root: string | null;
  text: string;
  selStart: number;
  selEnd: number;
  /** The textarea has never been focused since it mounted. */
  neverFocused: boolean;
}

/**
 * What a drop on the composer does, composed from the helpers above so the wiring stays DOM-only:
 * nothing (not ours, or compacting), a refusal (not strictly inside the workspace — the draft stays
 * untouched), or an insertion.
 *
 * A textarea mounted with a non-empty draft reports a caret at 0 until first focus (composer spike,
 * swe/notes/composer-path-drop-spike.md), so until then the caret is not trusted and the path goes at
 * the end of the text.
 */
export function decideComposerDrop(input: ComposerDropInput): ComposerDrop {
  if (input.refValue === null || input.compacting) return { kind: "ignore" };
  const rel = relativeRefPath(input.refValue, input.root);
  if (rel === null) return { kind: "refuse" };
  const { text } = input;
  const selStart = input.neverFocused ? text.length : input.selStart;
  const selEnd = input.neverFocused ? text.length : input.selEnd;
  return { kind: "insert", plan: planInsertion(text, selStart, selEnd, formatRefToken(rel)) };
}
