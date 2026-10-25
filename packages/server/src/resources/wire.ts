import type { PiPackageInfo, SkillInfo } from "@av-pi-studio/protocol";

import type { CatalogPackage, CatalogSkill } from "./skill-catalog.js";

/**
 * Maps `skill-catalog.ts`'s internal `CatalogSkill`/`CatalogPackage` shapes to the wire's
 * `SkillInfo`/`PiPackageInfo` (swe/architecture/pi-resource-management.md § Public contract —
 * `wire.ts`) — the ONE mapping, used by `resource-service.ts`'s `list()`/`setEnabled()` so the
 * wire response can never drift from the internal catalog shape. Drops `CatalogSkill.baseDir`
 * (internal-only — task-004's own pattern-derivation input, never sent on the wire).
 */

export function toSkillInfo(skill: CatalogSkill): SkillInfo {
  return {
    name: skill.name,
    description: skill.description,
    path: skill.path,
    enabled: skill.enabled,
    origin: skill.origin,
    originLabel: skill.originLabel,
    packageSource: skill.packageSource,
    shadowedBy: skill.shadowedBy,
    symlinkTarget: skill.symlinkTarget,
    provenance: skill.provenance
      ? {
          source: skill.provenance.source,
          sourceUrl: skill.provenance.sourceUrl,
          installedAt: skill.provenance.installedAt,
        }
      : undefined,
    disableModelInvocation: skill.disableModelInvocation,
    warnings: skill.warnings,
    removable: skill.removable,
  };
}

export function toSkillInfoList(skills: readonly CatalogSkill[]): SkillInfo[] {
  return skills.map(toSkillInfo);
}

export function toPiPackageInfo(pkg: CatalogPackage): PiPackageInfo {
  return {
    source: pkg.source,
    kind: pkg.kind,
    identity: pkg.identity,
    pinned: pkg.pinned,
    curated: pkg.curated,
    filtered: pkg.filtered,
    skillCount: pkg.skillCount,
  };
}

export function toPiPackageInfoList(packages: readonly CatalogPackage[]): PiPackageInfo[] {
  return packages.map(toPiPackageInfo);
}
