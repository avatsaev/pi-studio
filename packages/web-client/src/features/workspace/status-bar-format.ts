/**
 * Pure, framework-free value formatters for the workspace status bar (sprint-042). No store/DOM
 * access — every function takes plain values and returns a display string, so each is directly
 * unit-testable without rendering anything (matches the project's `lib/`-style convention of
 * keeping core logic free of DOM dependencies).
 */

const PLACEHOLDER = "--";

/** `undefined` → "--"; <1000 exact; ≥1000 → "12.3k"; ≥1_000_000 → "1.2M" (one decimal, trimmed). */
export function formatTokens(n: number | undefined): string {
  if (n === undefined) return PLACEHOLDER;
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Accepts either a 0–1 fraction or a 0–100 whole number (the wire's `agentContextUsageSchema
 * .percent` convention is not pinned to one or the other across providers) and normalizes to a
 * rounded integer percentage. `undefined`/`null` → "--". */
export function formatPercent(p: number | null | undefined): string {
  if (p === null || p === undefined) return PLACEHOLDER;
  const pct = p <= 1 ? p * 100 : p;
  return `${Math.round(pct)}%`;
}

/** `undefined` → "--"; small costs keep more precision (< $1 → 4 decimals), larger costs 2 dp. */
export function formatCost(c: number | undefined): string {
  if (c === undefined) return PLACEHOLDER;
  const dp = c < 1 ? 4 : 2;
  return `$${c.toFixed(dp)}`;
}

/** Collapses a leading `home` prefix to `~`. No-op when `home` is null/undefined or not a prefix
 * of `cwd`. Does not truncate/ellipsize — that's a CSS concern for the component to apply. */
export function formatCwd(cwd: string, home: string | null | undefined): string {
  if (!home) return cwd;
  if (cwd === home) return "~";
  if (cwd.startsWith(`${home}/`)) return `~${cwd.slice(home.length)}`;
  return cwd;
}

/** `"↑2 ↓1"` — omits a zero side; `""` when both are zero (nothing to show). */
export function formatBranchMeta(ahead: number, behind: number): string {
  const parts: string[] = [];
  if (ahead > 0) parts.push(`↑${ahead}`);
  if (behind > 0) parts.push(`↓${behind}`);
  return parts.join(" ");
}
