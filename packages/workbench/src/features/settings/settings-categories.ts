/**
 * The settings category registry — split out of `SettingsDialog.tsx` (sprint-073/task-006) so it
 * can be imported eagerly from `ConnectionBar.tsx` (to gate the settings gear) without pulling
 * `SettingsDialog.tsx`'s own eager imports (`Dialog`, `LoginDialog`, `provider-auth-store`) into
 * the main bundle chunk ahead of the gear ever being clicked. The `lazy()` panel components below
 * stay code-split regardless of who imports this module — only the actual `import()` call inside
 * each `lazy()` thunk defers, never the registry array itself.
 */

import { lazy } from "react";
import {
  Atom,
  KeyRound,
  Palette,
  Puzzle,
  Server,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType } from "react";

/** Server capabilities a settings category may gate its availability on. Grows as new
 *  capability-gated categories are added; a capability-independent category (e.g. Viewers)
 *  simply ignores this and always returns true. */
export interface SettingsCategoryCapabilities {
  providerAuth: boolean;
  /** sprint-075: `server_info.features.skills` — gates the Skills category. */
  skills: boolean;
  /** sprint-137: `server_info.features.daemonUpdate` — gates the Daemon category. */
  daemonUpdate: boolean;
  /** sprint-157: the host has a `usageData` member (the desktop app) — gates Privacy. */
  usageData: boolean;
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

const SkillsPanel = lazy(() =>
  import("../skills/SkillsPanel.js").then((m) => ({ default: m.SkillsPanel })),
);

const DaemonSettingsPanel = lazy(() =>
  import("./DaemonSettingsPanel.js").then((m) => ({ default: m.DaemonSettingsPanel })),
);

const AppearancePanel = lazy(() =>
  import("./AppearancePanel.js").then((m) => ({ default: m.AppearancePanel })),
);

const PrivacyPanel = lazy(() =>
  import("./PrivacyPanel.js").then((m) => ({ default: m.PrivacyPanel })),
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
    // Client-only (theme and zoom), so always available. Second, not first: the chat's "Connect a
    // model provider" nudge opens Settings on the first available category.
    id: "appearance",
    label: "Appearance",
    icon: Palette,
    component: AppearancePanel,
    available: () => true,
  },
  {
    // sprint-075/task-006 — capability-gated (unlike Viewers): an old/dev daemon without the
    // `skills` feature flag hides the category entirely rather than degrading in place, per
    // swe/features/skills-manager.md § Error handling.
    id: "skills",
    label: "Skills",
    icon: Puzzle,
    component: SkillsPanel,
    available: (caps) => caps.skills,
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
  {
    // sprint-137/task-003 — capability-gated: a daemon without the `daemonUpdate` flag has no
    // update status to show, so the category is hidden (the connection bar's pill is too).
    id: "daemon",
    label: "Daemon",
    icon: Server,
    component: DaemonSettingsPanel,
    available: (caps) => caps.daemonUpdate,
  },
  {
    // sprint-157 — host-gated, not daemon-gated: only the desktop host has `usageData`.
    id: "privacy",
    label: "Privacy",
    icon: ShieldCheck,
    component: PrivacyPanel,
    available: (caps) => caps.usageData,
  },
];

/** Builds the capability object every category's `available` predicate is evaluated against,
 *  from the connection store's `serverInfo.features` map and the host's optional members. Shared by `SettingsDialog` (to filter
 *  the sidebar) and `ConnectionBar` (to gate the settings gear itself — "reachable whenever any
 *  category is available") so neither duplicates the `serverInfo?.features?.[…]` reads. */
export function buildSettingsCategoryCapabilities(
  features: Record<string, unknown> | undefined,
  host: { usageData: boolean },
): SettingsCategoryCapabilities {
  return {
    providerAuth: Boolean(features?.["providerAuth"]),
    skills: Boolean(features?.["skills"]),
    daemonUpdate: Boolean(features?.["daemonUpdate"]),
    usageData: host.usageData,
  };
}
