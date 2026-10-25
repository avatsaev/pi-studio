import { relative } from "node:path";

/**
 * Mirror of Pi's private skill-toggle pattern derivation (sprint-075/task-002).
 *
 * Pi 1.4.0 (`@earendil-works/pi-coding-agent`) exports no API for turning a skill toggle into
 * a `settings.json` mutation; the logic lives in the TUI-only
 * `modes/interactive/components/config-selector.js` (`ConfigSelectorComponent`/`ResourceList`,
 * lines 655-717), which is never imported here. This module mirrors:
 *
 * - `toggleTopLevelResource` (lines 426-474): pattern = `relative(baseDir ?? agentDir, path)`
 *   (`getResourcePattern`, lines 708-714), written into `settings.skills` as `±pattern`, replacing
 *   any existing entry whose `!`/`+`/`-`-stripped form equals the same pattern
 *   (`getPatternEntryTarget`, lines 696-698).
 * - `togglePackageResource` (lines 475-521): pattern = `relative(baseDir, path)`
 *   (`getPackageResourcePattern`, lines 715-717). The matching `packages[]` entry is upgraded
 *   from a bare source string to `{source}`, its `skills` filter array is replaced the same way,
 *   and the entry collapses back to the bare string once none of `extensions`/`skills`/`prompts`/
 *   `themes` remain set (`RESOURCE_TYPES`, line 13; collapse check lines 509-514). Pi's own
 *   `enabled` boolean always pushes a replacement entry, so that collapse check is unreachable in
 *   practice (confirmed by differential testing below) — `replacePattern`/`applyPackageToggle`
 *   here additionally accept `enabled === undefined` to clear an override without replacing it,
 *   the same "no push" case as `state === "inherit"` in the project-override tri-state
 *   (`setProjectTopLevelOverride`/`setProjectPackageOverride`, lines 563, 600-601), so the
 *   collapse this module mirrors is genuinely reachable.
 *
 * Fixture provenance: `ResourceList`/`ConfigSelectorComponent` are not exported, so a throwaway
 * script (deleted after use) imported the internal `config-selector.js` directly by file path —
 * never from `toggle-patterns.ts` itself — constructed a `ConfigSelectorComponent` against a
 * `SettingsManager` pointed at a temporary `HOME`/`PI_CODING_AGENT_DIR`, and called
 * `toggleTopLevelResource`/`togglePackageResource` on its `ResourceList` directly to capture the
 * real `settings.json` mutations frozen as fixtures in `toggle-patterns.test.ts`.
 */

/** A Pi `packages[]` entry: a bare source string, or an object with per-resource-type filters. */
export interface PiPackageEntry {
  source: string;
  autoload?: boolean;
  extensions?: string[];
  skills?: string[];
  prompts?: string[];
  themes?: string[];
}

export type PiPackageSource = string | PiPackageEntry;

const FILTER_KEYS = ["extensions", "skills", "prompts", "themes"] as const;

/**
 * Derive the top-level (non-package) toggle pattern for a skill: `relative(baseDir ?? agentDir,
 * path)`, mirroring `getResourcePattern` (config-selector.js:708-714).
 */
export function topLevelPattern(
  path: string,
  baseDir: string | undefined,
  agentDir: string,
): string {
  return relative(baseDir ?? agentDir, path)
    .split("\\")
    .join("/");
}

/**
 * Derive the package-scoped toggle pattern for a skill: `relative(baseDir, path)`, mirroring
 * `getPackageResourcePattern` (config-selector.js:715-717).
 */
export function packagePattern(path: string, baseDir: string): string {
  return relative(baseDir, path).split("\\").join("/");
}

/**
 * Replace any existing entry targeting `pattern` with `(enabled ? "+" : "-") + pattern`, mirroring
 * the filter common to `toggleTopLevelResource` and `togglePackageResource`
 * (config-selector.js:436-445, 499-508; stripping via `getPatternEntryTarget`, lines 696-698).
 * `enabled === undefined` clears any override for `pattern` without replacing it (see module
 * header) so a caller can drive {@link applyPackageToggle}'s collapse back to a bare string.
 */
export function replacePattern(
  entries: string[] | undefined,
  pattern: string,
  enabled: boolean | undefined,
): string[] {
  const updated = (entries ?? []).filter((entry) => {
    const target =
      entry.startsWith("!") || entry.startsWith("+") || entry.startsWith("-")
        ? entry.slice(1)
        : entry;
    return target !== pattern;
  });
  if (enabled !== undefined) {
    updated.push(`${enabled ? "+" : "-"}${pattern}`);
  }
  return updated;
}

/**
 * Apply a skill toggle to a package's `skills` filter, mirroring `togglePackageResource`
 * (config-selector.js:475-521): the matching entry (by `source`) is upgraded to object form,
 * its `skills` array is replaced via {@link replacePattern}, and the entry collapses back to a
 * bare string once no filter array (`extensions`/`skills`/`prompts`/`themes`) remains. Throws
 * when `source` matches no entry in `packages` (Pi's `togglePackageResource` silently no-ops on
 * a missing `pkgIndex`; this mirror throws instead since task-004 should never call it for an
 * unresolved package).
 */
export function applyPackageToggle(
  packages: PiPackageSource[],
  source: string,
  pattern: string,
  enabled: boolean | undefined,
): PiPackageSource[] {
  const result = [...packages];
  const index = result.findIndex((pkg) => (typeof pkg === "string" ? pkg : pkg.source) === source);
  if (index === -1) {
    throw new Error(`applyPackageToggle: no package entry for source ${JSON.stringify(source)}`);
  }
  const existing = result[index]!;
  const entry: PiPackageEntry =
    typeof existing === "string" ? { source: existing } : { ...existing };
  const updated = replacePattern(entry.skills, pattern, enabled);
  entry.skills = updated.length > 0 ? updated : undefined;
  const hasFilters = FILTER_KEYS.some((key) => entry[key] !== undefined);
  result[index] = hasFilters ? entry : entry.source;
  return result;
}
