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

import type {
  DetectedSkillSource,
  PiPackageInfo,
  PreviewSkill,
  SkillInfo,
  SkillsInstallResponse,
  SkillSourceKind,
} from "@av-pi-studio/protocol";
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

/**
 * Confirm text for a single removable row's Remove button, by origin — swe/features/
 * skills-manager.md § Remove. A symlinked entry takes priority over origin since any origin can
 * in principle be a symlink on disk; `agents_dir` only gets the "every agent on this machine"
 * wording when it also carries install provenance (a lock-tracked skill), matching the spec's
 * "Agent Skills with provenance" case — a hand-placed `agents_dir` folder with no provenance
 * falls through to the generic "plain dir" wording.
 */
export function skillRemoveConfirmText(skill: SkillInfo): string {
  if (skill.symlinkTarget) {
    return `Removes the link only; ${skill.symlinkTarget} is kept.`;
  }
  if (skill.origin === "agents_dir" && skill.provenance) {
    return `Removes '${skill.name}' for every agent on this machine.`;
  }
  if (skill.origin === "settings_path") {
    return `Removes the Pi settings entry that provides ${skill.path} (other skills from the same folder stop loading too); files are kept.`;
  }
  return `Deletes ${skill.path}.`;
}

/** Confirm text for a package header's "Remove package" button — names the skill count before
 *  `removeSkill({packageSource})` drops the whole `settings.json` entry (swe/features/
 *  skills-manager.md § Remove: "Remove package lists the package's skill count"). */
export function removePackageConfirmText(pkg: PiPackageInfo): string {
  const n = pkg.skillCount;
  return `Remove ${pkg.source}? This removes ${n} skill${n === 1 ? "" : "s"}.`;
}

/** Toolbar "Update all" confirm text, shipped verbatim from swe/features/skills-manager.md §
 *  Update all. */
export const UPDATE_ALL_CONFIRM_TEXT =
  "Updates every Agent Skills skill and every unpinned Pi package; may take several minutes";

const UPDATE_ALL_TARGET_LABELS: Record<string, string> = {
  "agent-skills": "Agent Skills",
  "pi-packages": "Pi packages",
};

/** Maps an `ItemResult.target` string to its result-row label; an unrecognized target (the
 *  wire's open-string append-only convention) renders verbatim. */
export function updateAllTargetLabel(target: string): string {
  return UPDATE_ALL_TARGET_LABELS[target] ?? target;
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
 * Install and Update-all answer `ok: false` whenever ANY item failed, yet still carry the per-item
 * `results` (and the re-listed `skills`/`packages`) — the UI must show those rows, not collapse
 * them into one generic error. Only an answer with no item results at all (a request-level
 * failure such as an unreadable settings file) is an error banner. Found live in sprint-077: a
 * failed install silently stayed on the source step.
 */
/**
 * The query cache holds the LIST document the panel renders; `skills_install` / `skills_update_all`
 * answers carry the same `skills`/`packages` but `ok: false` when any item failed. Written into
 * the cache verbatim, that `ok: false` made the panel swap itself for its "could not load" error
 * state and remount the install dialog mid-flow (found live, sprint-077) — so the cache copy is
 * always marked `ok: true`: the re-listed rows are valid regardless of the item outcomes.
 */
export function asListDocument<T extends { ok: boolean; error?: string; message?: string }>(
  response: T,
): T {
  return { ...response, ok: true, error: undefined, message: undefined };
}

export function hasItemResults(response: { results: readonly unknown[] }): boolean {
  return response.results.length > 0;
}

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

// ---------------------------------------------------------------------------
// Install dialog (sprint-077/task-007) — `InstallSkillDialog.tsx`'s pure half: the live
// detected-kind label, the source → (preview →) pick → running → results step machine, and the
// pick-row default-checked/Replace-gating rules. swe/features/skills-manager.md § Install dialog.
// ---------------------------------------------------------------------------

/** Live label next to the source field, keyed on `detectSkillSource`'s own `kind` — never a
 *  second classifier. `null` (nothing recognized) renders "Unrecognized" and disables Next. */
export type DetectedSourceLabel =
  | "npm package"
  | "git package"
  | "Agent Skills repo"
  | "Folder on daemon host"
  | "Unrecognized";

const SOURCE_KIND_LABELS: Record<SkillSourceKind, DetectedSourceLabel> = {
  pi_npm: "npm package",
  pi_git: "git package",
  skills_repo: "Agent Skills repo",
  local_path: "Folder on daemon host",
};

export function detectedSourceLabel(detected: DetectedSkillSource | null): DetectedSourceLabel {
  return detected ? SOURCE_KIND_LABELS[detected.kind] : "Unrecognized";
}

/** `pi_npm`/`pi_git` install as a unit (daemon spawns `pi install <source>`) — the dialog skips
 *  the pick step and the skills-only/full-system-access notice applies. */
export function isPackageSourceKind(kind: SkillSourceKind): boolean {
  return kind === "pi_npm" || kind === "pi_git";
}

/** Next is enabled only for a recognized source — swe/features/skills-manager.md § Install
 *  dialog's "Unrecognized" row has no Next action; unit of the "Unrecognised input disables
 *  Next" acceptance criterion. */
export function canAdvanceFromSource(detected: DetectedSkillSource | null): boolean {
  return detected !== null;
}

/** Package-kind notice, shipped verbatim from swe/features/skills-manager.md § Install dialog. */
export const PACKAGE_SOURCE_NOTICE =
  "Installs the package's skills only; its extensions stay disabled. Pi packages run with full " +
  "system access — review the source before installing.";

export type InstallDialogStep = "source" | "previewing" | "pick" | "running" | "results";

export interface InstallDialogPhase {
  previewPending: boolean;
  previewResult: { skills: PreviewSkill[] } | null;
  installPending: boolean;
  installResult: SkillsInstallResponse | null;
}

/**
 * The dialog's one step machine, derived purely from in-flight/settled RPC state — never stored
 * as its own piece of state, so it can't drift from what actually happened. `source` is also the
 * machine's reset/idle state. Terminal states win over earlier ones (a settled install always
 * shows `results` even if, implausibly, `previewPending` were still true from a stale call).
 */
export function installDialogStep(phase: InstallDialogPhase): InstallDialogStep {
  if (phase.installResult) return "results";
  if (phase.installPending) return "running";
  if (phase.previewPending) return "previewing";
  if (phase.previewResult) return "pick";
  return "source";
}

export interface PickRowState {
  skill: PreviewSkill;
  /** Default checked iff valid (swe/features/skills-manager.md § Install dialog: "checkbox
   *  (default checked iff valid)") — an invalid row starts and stays unchecked/disabled. */
  checked: boolean;
  /** Only meaningful when `skill.exists`; unchecked rows aren't sent even if `checked`. */
  replace: boolean;
}

/** Seeds one row per previewed skill with the spec's default-checked rule. */
export function buildPickRows(skills: PreviewSkill[]): PickRowState[] {
  return skills.map((skill) => ({ skill, checked: skill.valid, replace: false }));
}

/**
 * The names Install actually sends: checked, valid rows, excluding an `exists` row whose own
 * Replace checkbox isn't checked — swe/features/skills-manager.md § Install dialog: "rows
 * `exists` need a Replace checkbox before Install sends them." Filtered client-side rather than
 * round-tripped through the daemon's `name_exists` rejection, since the UI already knows.
 */
export function resolvePickedSkillNames(rows: PickRowState[]): string[] {
  return rows
    .filter((row) => row.skill.valid && row.checked && (!row.skill.exists || row.replace))
    .map((row) => row.skill.name);
}

/** `skills_install_request`'s single `replace` flag is request-wide, not per-name; true iff at
 *  least one sent name is an `exists` row with its own Replace checkbox checked — it has no
 *  effect on the other sent names, which don't already exist. */
export function pickedSkillsNeedReplace(rows: PickRowState[]): boolean {
  return rows.some((row) => row.skill.valid && row.checked && row.skill.exists && row.replace);
}

/** True iff no picked row will actually be sent — Install should stay disabled. */
export function hasNoPickedSkills(rows: PickRowState[]): boolean {
  return resolvePickedSkillNames(rows).length === 0;
}
