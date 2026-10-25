/**
 * Turns `skills_list`/`skills_set_enabled`'s `{skills, packages}` document into what
 * `SkillsPanel.tsx` renders — grouped/ordered rows, row badges/mute/disable state, package header
 * badges, the search filter, and error-string → message mapping. Pure — no React, no store
 * access — per this package's no-jsdom testing convention (AGENTS.md § "Framework-free testing
 * convention: no jsdom"): `SkillsPanel.tsx` only binds this to the DOM, every branch here is
 * covered by `skills-presentation.test.ts`.
 *
 * swe/features/skills-manager.md § Panel, § Data flow.
 */

import type { PiPackageInfo, SkillInfo } from "@av-pi-studio/protocol";
import type { StatusBadgeVariant } from "@pi-studio-ui/ui/status-badge.js";

export interface SkillRowBadge {
  label: string;
  variant: StatusBadgeVariant;
}

export interface SkillRowState {
  skill: SkillInfo;
  /** Shadowed by another skill of the same name — rendered muted, toggle disabled. */
  muted: boolean;
  toggleDisabled: boolean;
  badges: SkillRowBadge[];
  warnings: string[];
  /** Tooltip text when this row shares a filter pattern with a sibling row (same name, both
   *  under Pi skills/Agent Skills) — toggling one changes both on the daemon. `null` otherwise. */
  sharedPatternTooltip: string | null;
}

export interface PackageHeaderBadge {
  label: string;
  variant: StatusBadgeVariant;
}

export interface SkillGroup {
  /** Stable group id: the origin string, or `package:<source>` for a package group. */
  id: string;
  label: string;
  rows: SkillRowState[];
  /** Present for `origin === "package"` groups — the resolved package row for the header. */
  packageInfo?: PiPackageInfo;
}

const ORIGIN_LABELS: Record<string, string> = {
  agent_dir: "Pi skills",
  agents_dir: "Agent Skills",
  settings_path: "Skill paths",
};

/** Origins whose rows are patterned together by the daemon (a single filter entry toggles the
 *  same name under both directories) — swe/features/skills-manager.md § Toggle. */
const SHARED_PATTERN_ORIGINS = new Set(["agent_dir", "agents_dir"]);

function sharedPatternTooltip(skill: SkillInfo, allSkills: SkillInfo[]): string | null {
  if (!SHARED_PATTERN_ORIGINS.has(skill.origin)) return null;
  const hasSibling = allSkills.some(
    (other) =>
      other !== skill && other.name === skill.name && SHARED_PATTERN_ORIGINS.has(other.origin),
  );
  return hasSibling ? `Pi applies this setting to every '${skill.name}' skill folder.` : null;
}

function buildSkillRowState(
  skill: SkillInfo,
  allSkills: SkillInfo[],
  skillsByPath: Map<string, SkillInfo>,
): SkillRowState {
  const shadowed = Boolean(skill.shadowedBy);
  const badges: SkillRowBadge[] = [];

  if (shadowed) {
    const shadowingEntry = skill.shadowedBy ? skillsByPath.get(skill.shadowedBy) : undefined;
    badges.push({
      label: `shadowed by ${shadowingEntry?.originLabel ?? skill.shadowedBy}`,
      variant: "warning",
    });
  }
  if (skill.symlinkTarget) {
    badges.push({ label: `→ ${skill.symlinkTarget}`, variant: "muted" });
  }
  if (skill.disableModelInvocation) {
    badges.push({ label: "manual only", variant: "muted" });
  }
  if (skill.provenance?.source) {
    badges.push({ label: skill.provenance.source, variant: "muted" });
  }

  return {
    skill,
    muted: shadowed,
    toggleDisabled: shadowed,
    badges,
    warnings: skill.warnings ?? [],
    sharedPatternTooltip: sharedPatternTooltip(skill, allSkills),
  };
}

/** Package header badges: kind, then `curated`/`pinned` when set. */
export function packageHeaderBadges(pkg: PiPackageInfo): PackageHeaderBadge[] {
  const badges: PackageHeaderBadge[] = [{ label: pkg.kind, variant: "muted" }];
  if (pkg.curated) badges.push({ label: "curated", variant: "success" });
  if (pkg.pinned) badges.push({ label: "pinned", variant: "muted" });
  return badges;
}

/**
 * Groups + orders skills exactly as swe/features/skills-manager.md § Panel specifies: Pi skills
 * (`agent_dir`), Agent Skills (`agents_dir`), one group per package (`packages[]` order, header
 * from the matching `PiPackageInfo`), then Skill paths (`settings_path`). Empty groups are
 * omitted. A `package`-origin skill whose `packageSource` doesn't match any entry in `packages`
 * (a daemon/client version skew) still gets a group, keyed on the raw source string, appended
 * after the known packages. An unrecognized `origin` string (the wire's open-string append-only
 * rule) gets its own group, keyed and labeled on the raw string, appended at the end — skills are
 * never silently dropped.
 */
export function buildSkillGroups(skills: SkillInfo[], packages: PiPackageInfo[]): SkillGroup[] {
  const skillsByPath = new Map(skills.map((s) => [s.path, s]));
  const rowState = (skill: SkillInfo): SkillRowState =>
    buildSkillRowState(skill, skills, skillsByPath);

  const groups: SkillGroup[] = [];

  const agentDirRows = skills.filter((s) => s.origin === "agent_dir").map(rowState);
  if (agentDirRows.length > 0) {
    groups.push({ id: "agent_dir", label: ORIGIN_LABELS.agent_dir!, rows: agentDirRows });
  }

  const agentsDirRows = skills.filter((s) => s.origin === "agents_dir").map(rowState);
  if (agentsDirRows.length > 0) {
    groups.push({ id: "agents_dir", label: ORIGIN_LABELS.agents_dir!, rows: agentsDirRows });
  }

  const packageSkills = skills.filter((s) => s.origin === "package");
  const knownSources = new Set<string>();
  for (const pkg of packages) {
    knownSources.add(pkg.source);
    const rows = packageSkills.filter((s) => s.packageSource === pkg.source).map(rowState);
    if (rows.length > 0) {
      groups.push({ id: `package:${pkg.source}`, label: pkg.source, rows, packageInfo: pkg });
    }
  }
  const unknownSources = Array.from(
    new Set(
      packageSkills
        .filter((s) => s.packageSource && !knownSources.has(s.packageSource))
        .map((s) => s.packageSource!),
    ),
  );
  for (const source of unknownSources) {
    const rows = packageSkills.filter((s) => s.packageSource === source).map(rowState);
    if (rows.length > 0) groups.push({ id: `package:${source}`, label: source, rows });
  }

  const settingsPathRows = skills.filter((s) => s.origin === "settings_path").map(rowState);
  if (settingsPathRows.length > 0) {
    groups.push({
      id: "settings_path",
      label: ORIGIN_LABELS.settings_path!,
      rows: settingsPathRows,
    });
  }

  const knownOrigins = new Set(["agent_dir", "agents_dir", "package", "settings_path"]);
  const unknownOrigins = Array.from(
    new Set(skills.filter((s) => !knownOrigins.has(s.origin)).map((s) => s.origin)),
  );
  for (const origin of unknownOrigins) {
    const rows = skills.filter((s) => s.origin === origin).map(rowState);
    if (rows.length > 0) groups.push({ id: origin, label: origin, rows });
  }

  return groups;
}

/** Client-side name/description substring filter (case-insensitive); groups left with no
 *  matching rows are dropped, matching the empty-group-hidden rule above. */
export function filterSkillGroups(groups: SkillGroup[], query: string): SkillGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  return groups
    .map((group) => ({
      ...group,
      rows: group.rows.filter(
        (row) =>
          row.skill.name.toLowerCase().includes(q) ||
          (row.skill.description ?? "").toLowerCase().includes(q),
      ),
    }))
    .filter((group) => group.rows.length > 0);
}

/** True iff toggling this skill is the curated-package case that needs a confirm — the skill
 *  belongs to a `package`-origin group whose resolved `PiPackageInfo.curated` is true. */
export function requiresCuratedConfirm(skill: SkillInfo, packages: PiPackageInfo[]): boolean {
  if (skill.origin !== "package" || !skill.packageSource) return false;
  const pkg = packages.find((p) => p.source === skill.packageSource);
  return Boolean(pkg?.curated);
}

const KNOWN_ERROR_MESSAGES: Record<string, string> = {
  settings_unreadable:
    "Can't read settings.json — skills can't be loaded or changed until this is fixed.",
  invalid_source: "That source isn't recognized.",
  not_found: "That skill could not be found.",
  not_removable: "That skill can't be removed from here.",
  spawn_failed: "Could not run the skills command.",
  timeout: "Timed out.",
};

/**
 * Maps a domain `error` code to a human message: the response's own `message` wins when present
 * (the daemon's elaboration, e.g. naming the unreadable settings path), else a known code gets a
 * friendlier label, else the raw string renders verbatim (unknown strings, per the wire's
 * append-only convention — swe/features/skills-manager.md § Error handling).
 */
export function skillErrorMessage(error: string | undefined, message?: string): string | null {
  if (!error) return null;
  if (message) return message;
  return KNOWN_ERROR_MESSAGES[error] ?? error;
}
