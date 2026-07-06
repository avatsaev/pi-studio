/**
 * provider-picker — pure logic for the new-agent provider/profile picker.
 *
 * Parses the daemon `list_providers` response into UI options, resolves the
 * initial selection from persisted create-agent preferences, and derives the
 * mode (profile) options for the selected provider. Kept framework-free so it
 * is unit-testable without a DOM or a live daemon.
 *
 * clean-room-scope/features/agent-providers.md § Registration surface
 * clean-room-scope/features/composer-ui.md § create-agent preferences
 * clean-room-scope/sprints/sprint-030-integration-gap-closure/task-002
 */

import type { CreateAgentPreferences } from "./new-workspace.js";

export interface ProviderModeOption {
  id: string;
  label: string;
}

export interface ProviderOption {
  id: string;
  label: string;
  /** True when the provider is a custom Pi-compatible profile (`extends`). */
  isProfile: boolean;
  modes: ProviderModeOption[];
}

/** Always-available fallback so the picker is never empty (mock needs no creds). */
export const FALLBACK_PROVIDERS: ProviderOption[] = [
  { id: "pi", label: "Pi", isProfile: false, modes: [{ id: "default", label: "Default" }] },
  { id: "mock", label: "Mock", isProfile: false, modes: [{ id: "default", label: "Default" }] },
];

interface RawMode {
  id?: unknown;
  label?: unknown;
}
interface RawProvider {
  id?: unknown;
  label?: unknown;
  extends?: unknown;
  modes?: unknown;
}

function parseModes(raw: unknown): ProviderModeOption[] {
  if (!Array.isArray(raw)) return [];
  const modes: ProviderModeOption[] = [];
  for (const m of raw as RawMode[]) {
    if (m && typeof m.id === "string") {
      modes.push({ id: m.id, label: typeof m.label === "string" ? m.label : m.id });
    }
  }
  return modes;
}

/**
 * Parse a `list_providers_response` payload into provider options. Tolerant of
 * shape drift (append-only protocol). Guarantees `mock` is always present so
 * smoke-testing works even against a daemon that omits it.
 */
export function parseProviderList(raw: unknown): ProviderOption[] {
  const container = raw as { providers?: unknown } | undefined;
  const list = Array.isArray(container?.providers) ? (container.providers as RawProvider[]) : [];
  const options: ProviderOption[] = [];
  for (const p of list) {
    if (!p || typeof p.id !== "string") continue;
    options.push({
      id: p.id,
      label: typeof p.label === "string" ? p.label : p.id,
      isProfile: typeof p.extends === "string" && p.extends.length > 0,
      modes: parseModes(p.modes),
    });
  }
  if (options.length === 0) return FALLBACK_PROVIDERS;
  if (!options.some((o) => o.id === "mock")) {
    options.push(FALLBACK_PROVIDERS[1]!);
  }
  return options;
}

export interface ProviderSelection {
  provider: string;
  modeId?: string;
}

/**
 * Resolve the initial provider + mode selection: prefer the last-used
 * preference when it is still available, otherwise fall back to the first
 * provider (and its first mode).
 */
export function resolveInitialSelection(
  options: readonly ProviderOption[],
  prefs: CreateAgentPreferences | undefined,
): ProviderSelection {
  const preferredId = prefs?.provider;
  const chosen = options.find((o) => o.id === preferredId) ?? options[0];
  if (!chosen) return { provider: "mock" };
  const preferredMode = preferredId === chosen.id ? prefs?.providerPreferences?.[chosen.id]?.mode : undefined;
  const mode = chosen.modes.find((m) => m.id === preferredMode) ?? chosen.modes[0];
  return { provider: chosen.id, modeId: mode?.id };
}

/** Mode options for a provider id (empty when the provider is unknown). */
export function modeOptionsFor(options: readonly ProviderOption[], providerId: string): ProviderModeOption[] {
  return options.find((o) => o.id === providerId)?.modes ?? [];
}

/**
 * Merge a chosen selection into the persisted create-agent preferences
 * (last-used provider + per-provider mode). Returns a new object.
 */
export function withSelectionPreference(
  prev: CreateAgentPreferences | undefined,
  selection: ProviderSelection,
): CreateAgentPreferences {
  const base: CreateAgentPreferences = prev ? { ...prev } : {};
  base.provider = selection.provider;
  const providerPreferences = { ...(base.providerPreferences ?? {}) };
  const existing = providerPreferences[selection.provider] ?? {};
  providerPreferences[selection.provider] = { ...existing, mode: selection.modeId };
  base.providerPreferences = providerPreferences;
  return base;
}
