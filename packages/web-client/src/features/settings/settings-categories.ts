/**
 * The settings category registry — split out of `SettingsDialog.tsx` (sprint-073/task-006) so it
 * can be imported eagerly from `ConnectionBar.tsx` (to gate the settings gear) without pulling
 * `SettingsDialog.tsx`'s own eager imports (`Dialog`, `LoginDialog`, `provider-auth-store`) into
 * the main bundle chunk ahead of the gear ever being clicked. The `lazy()` panel components below
 * stay code-split regardless of who imports this module — only the actual `import()` call inside
 * each `lazy()` thunk defers, never the registry array itself.
 */

import { lazy } from "react";
import { Atom, KeyRound, type LucideIcon } from "lucide-react";
import type { ComponentType } from "react";

/** Server capabilities a settings category may gate its availability on. Grows as new
 *  capability-gated categories are added; a capability-independent category (e.g. Viewers)
 *  simply ignores this and always returns true. */
export interface SettingsCategoryCapabilities {
  providerAuth: boolean;
}

export interface SettingsCategory {
  id: string;
  label: string;
  icon: LucideIcon;
  component: ComponentType;
  available: (caps: SettingsCategoryCapabilities) => boolean;
}

const ModelProvidersPanel = lazy(() =>
  import("../provider-auth/ModelProvidersPanel.js").then((m) => ({
    default: m.ModelProvidersPanel,
  })),
);

const ViewersPanel = lazy(() =>
  import("./ViewersPanel.js").then((m) => ({ default: m.ViewersPanel })),
);

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  {
    id: "providers",
    label: "Model Providers",
    icon: KeyRound,
    component: ModelProvidersPanel,
    available: (caps) => caps.providerAuth,
  },
  {
    // Capability-independent (sprint-073/task-006): the row this panel renders degrades to
    // read-only against a capability-free daemon rather than hiding the category — see
    // ViewersPanel.tsx and AGENTS.md § Invariants "Viewer-disable gate".
    id: "viewers",
    label: "Viewers",
    icon: Atom,
    component: ViewersPanel,
    available: () => true,
  },
];

/** Builds the capability object every category's `available` predicate is evaluated against,
 *  from the connection store's `serverInfo.features` map. Shared by `SettingsDialog` (to filter
 *  the sidebar) and `ConnectionBar` (to gate the settings gear itself — "reachable whenever any
 *  category is available") so neither duplicates the `serverInfo?.features?.[…]` reads. */
export function buildSettingsCategoryCapabilities(
  features: Record<string, unknown> | undefined,
): SettingsCategoryCapabilities {
  return {
    providerAuth: Boolean(features?.["providerAuth"]),
  };
}
