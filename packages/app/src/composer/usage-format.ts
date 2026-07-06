// Provider / agent usage formatting.
//
// Two related concepts:
//  1. Per-agent live usage (tokens + cost) advertised via `agent_usage` events
//     — shown as a compact composer-footer label + a breakdown popover.
//  2. Provider account usage (balances + rolling rate-limit windows) from the
//     `provider_usage_list` RPC — tone derivation + bar resolution helpers.
//
// All pure / framework-agnostic.
//
// clean-room-scope/features/composer-ui.md § Provider usage
// clean-room-scope/features/provider-usage.md

import type { AgentUsage } from "../store/session-store.js";

// ─── Number formatting ────────────────────────────────────────────────────────

/** Compact token count: 950 → "950", 1234 → "1.2k", 1_500_000 → "1.5M". */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${trim(n / 1000)}k`;
  return `${trim(n / 1_000_000)}M`;
}

function trim(x: number): string {
  return (Math.round(x * 10) / 10).toString();
}

/** Format a USD cost: 0.0312 → "$0.03"; 12.5 → "$12.50". */
export function formatCost(usd: number): string {
  if (!Number.isFinite(usd)) return "$0.00";
  return `$${usd.toFixed(2)}`;
}

// ─── Agent usage label + breakdown ──────────────────────────────────────────

/** Total tokens across input + output (cached excluded from the "tokens" sum). */
export function totalTokens(usage: AgentUsage): number {
  return (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
}

export function hasUsage(usage: AgentUsage | undefined): usage is AgentUsage {
  if (!usage) return false;
  return (
    usage.inputTokens !== undefined ||
    usage.outputTokens !== undefined ||
    usage.cachedTokens !== undefined ||
    usage.costUsd !== undefined
  );
}

/**
 * Compact footer label, e.g. "Claude Sonnet · 1.2k tokens · $0.03".
 * Segments are omitted when the underlying value is absent. Returns undefined
 * when there is nothing to show (footer hides).
 */
export function formatUsageLabel(
  usage: AgentUsage | undefined,
  modelLabel?: string,
): string | undefined {
  if (!hasUsage(usage)) return undefined;
  const parts: string[] = [];
  const label = modelLabel ?? usage.provider;
  if (label) parts.push(label);
  const tokens = totalTokens(usage);
  if (usage.inputTokens !== undefined || usage.outputTokens !== undefined) {
    parts.push(`${formatTokens(tokens)} tokens`);
  }
  if (usage.costUsd !== undefined) parts.push(formatCost(usage.costUsd));
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export interface UsageBreakdownRow {
  label: string;
  value: string;
}

/** Detailed rows for the usage popover. */
export function usageBreakdown(usage: AgentUsage | undefined): UsageBreakdownRow[] {
  if (!hasUsage(usage)) return [];
  const rows: UsageBreakdownRow[] = [];
  if (usage.inputTokens !== undefined) rows.push({ label: "Input tokens", value: formatTokens(usage.inputTokens) });
  if (usage.outputTokens !== undefined) rows.push({ label: "Output tokens", value: formatTokens(usage.outputTokens) });
  if (usage.cachedTokens !== undefined) rows.push({ label: "Cached tokens", value: formatTokens(usage.cachedTokens) });
  if (usage.costUsd !== undefined) rows.push({ label: "Cost", value: formatCost(usage.costUsd) });
  return rows;
}

// ─── Provider account usage (balances / windows) ────────────────────────────

export type ProviderUsageTone = "default" | "ok" | "warning" | "danger";

/**
 * Derive a tone from a used-percentage. Only `default`/`warning`/`danger` are
 * derived; `ok` is never auto-derived (daemon-set only).
 * `> 90 → danger`, `70–90 → warning`, `< 70 → default`.
 */
export function deriveTone(usedPct: number | null | undefined): ProviderUsageTone {
  if (usedPct === null || usedPct === undefined || !Number.isFinite(usedPct)) return "default";
  if (usedPct > 90) return "danger";
  if (usedPct >= 70) return "warning";
  return "default";
}

export interface ProviderUsageWindow {
  label: string;
  usedPct?: number;
  remainingPct?: number;
  resetsAt?: string;
  runsOutAt?: string;
  shortfallPct?: number;
  tone?: ProviderUsageTone;
}

export interface ResolvedWindow {
  label: string;
  usedPct: number | null;
  tone: ProviderUsageTone;
  atRisk: boolean;
}

/** Resolve a rate-limit window bar: used%, tone, and at-risk flag. */
export function resolveWindow(w: ProviderUsageWindow): ResolvedWindow {
  const usedPct = w.usedPct ?? (w.remainingPct !== undefined ? 100 - w.remainingPct : null);
  const tone = w.tone ?? deriveTone(usedPct);
  const atRisk = w.runsOutAt !== undefined && w.shortfallPct !== undefined;
  return { label: w.label, usedPct, tone, atRisk };
}

/**
 * Pick the "most relevant" window for the compact composer footer: prefer an
 * at-risk window, else the highest used-percentage, else the first.
 */
export function mostRelevantWindow(windows: ProviderUsageWindow[]): ProviderUsageWindow | undefined {
  if (windows.length === 0) return undefined;
  const resolved = windows.map((w) => ({ w, r: resolveWindow(w) }));
  const atRisk = resolved.filter((x) => x.r.atRisk);
  const pool = atRisk.length > 0 ? atRisk : resolved;
  pool.sort((a, b) => (b.r.usedPct ?? -1) - (a.r.usedPct ?? -1));
  return pool[0]!.w;
}
