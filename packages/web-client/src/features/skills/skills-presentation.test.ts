import { describe, expect, it } from "vitest";
import type { PiPackageInfo, SkillInfo } from "@av-pi-studio/protocol";
import {
  buildSkillGroups,
  filterSkillGroups,
  packageHeaderBadges,
  removePackageConfirmText,
  requiresCuratedConfirm,
  skillErrorMessage,
  skillRemoveConfirmText,
  updateAllTargetLabel,
} from "./skills-presentation.js";

function skill(overrides: Partial<SkillInfo> & Pick<SkillInfo, "name" | "path">): SkillInfo {
  return {
    enabled: true,
    origin: "agent_dir",
    originLabel: "Pi skills",
    removable: true,
    ...overrides,
  };
}

function pkg(overrides: Partial<PiPackageInfo> & Pick<PiPackageInfo, "source">): PiPackageInfo {
  return {
    kind: "npm",
    identity: overrides.source,
    pinned: false,
    curated: false,
    filtered: true,
    skillCount: 1,
    ...overrides,
  };
}

describe("buildSkillGroups", () => {
  it("orders groups: Pi skills, Agent Skills, one per package (packages[] order), Skill paths", () => {
    const skills: SkillInfo[] = [
      skill({
        name: "c",
        path: "/settings/c",
        origin: "settings_path",
        originLabel: "Skill paths",
      }),
      skill({
        name: "b",
        path: "/pkg/b",
        origin: "package",
        originLabel: "pkg",
        packageSource: "npm:foo",
      }),
      skill({ name: "a2", path: "/agents/a2", origin: "agents_dir", originLabel: "Agent Skills" }),
      skill({ name: "a1", path: "/agent/a1", origin: "agent_dir", originLabel: "Pi skills" }),
    ];
    const packages = [pkg({ source: "npm:foo" })];
    const groups = buildSkillGroups(skills, packages);
    expect(groups.map((g) => g.id)).toEqual([
      "agent_dir",
      "agents_dir",
      "package:npm:foo",
      "settings_path",
    ]);
    expect(groups[0]!.label).toBe("Pi skills");
    expect(groups[1]!.label).toBe("Agent Skills");
    expect(groups[2]!.label).toBe("npm:foo");
    expect(groups[2]!.packageInfo).toEqual(packages[0]);
    expect(groups[3]!.label).toBe("Skill paths");
  });

  it("hides empty groups entirely", () => {
    const skills: SkillInfo[] = [
      skill({ name: "a", path: "/agent/a", origin: "agent_dir", originLabel: "Pi skills" }),
    ];
    const groups = buildSkillGroups(skills, []);
    expect(groups.map((g) => g.id)).toEqual(["agent_dir"]);
  });

  it("orders package groups by packages[] order, with unknown packageSources appended after known ones", () => {
    const skills: SkillInfo[] = [
      skill({
        name: "x",
        path: "/p/x",
        origin: "package",
        originLabel: "pkg",
        packageSource: "git:unknown",
      }),
      skill({
        name: "y",
        path: "/p/y",
        origin: "package",
        originLabel: "pkg",
        packageSource: "npm:second",
      }),
      skill({
        name: "z",
        path: "/p/z",
        origin: "package",
        originLabel: "pkg",
        packageSource: "npm:first",
      }),
    ];
    const packages = [pkg({ source: "npm:first" }), pkg({ source: "npm:second" })];
    const groups = buildSkillGroups(skills, packages);
    expect(groups.map((g) => g.id)).toEqual([
      "package:npm:first",
      "package:npm:second",
      "package:git:unknown",
    ]);
    expect(groups[2]!.packageInfo).toBeUndefined();
  });

  it("gives an unrecognized origin string its own group, appended last — never dropped", () => {
    const skills: SkillInfo[] = [
      skill({ name: "a", path: "/agent/a", origin: "agent_dir", originLabel: "Pi skills" }),
      skill({ name: "future", path: "/future/x", origin: "future_origin", originLabel: "Future" }),
    ];
    const groups = buildSkillGroups(skills, []);
    expect(groups.map((g) => g.id)).toEqual(["agent_dir", "future_origin"]);
    expect(groups[1]!.label).toBe("future_origin");
    expect(groups[1]!.rows).toHaveLength(1);
  });
});

describe("buildSkillGroups — row state", () => {
  it("a shadowed skill is muted, toggle-disabled, and badged with the shadowing entry's originLabel", () => {
    const shadowing = skill({
      name: "dup",
      path: "/agents/dup",
      origin: "agents_dir",
      originLabel: "Agent Skills",
    });
    const shadowed = skill({
      name: "dup",
      path: "/agent/dup",
      origin: "agent_dir",
      originLabel: "Pi skills",
      shadowedBy: "/agents/dup",
    });
    const groups = buildSkillGroups([shadowed, shadowing], []);
    const row = groups.flatMap((g) => g.rows).find((r) => r.skill.path === "/agent/dup")!;
    expect(row.muted).toBe(true);
    expect(row.toggleDisabled).toBe(true);
    expect(row.badges).toContainEqual({ label: "shadowed by Agent Skills", variant: "warning" });
  });

  it("falls back to the raw shadowedBy path when the shadowing entry isn't in the list", () => {
    const shadowed = skill({
      name: "dup",
      path: "/agent/dup",
      origin: "agent_dir",
      originLabel: "Pi skills",
      shadowedBy: "/nowhere/dup",
    });
    const groups = buildSkillGroups([shadowed], []);
    const row = groups[0]!.rows[0]!;
    expect(row.badges).toContainEqual({ label: "shadowed by /nowhere/dup", variant: "warning" });
  });

  it("an unshadowed skill is not muted and carries no shadow badge", () => {
    const row = buildSkillGroups(
      [skill({ name: "a", path: "/agent/a", origin: "agent_dir", originLabel: "Pi skills" })],
      [],
    )[0]!.rows[0]!;
    expect(row.muted).toBe(false);
    expect(row.toggleDisabled).toBe(false);
    expect(row.badges).toEqual([]);
  });

  it("badges symlink target, manual-only, and provenance source", () => {
    const row = buildSkillGroups(
      [
        skill({
          name: "a",
          path: "/agent/a",
          origin: "agent_dir",
          originLabel: "Pi skills",
          symlinkTarget: "/real/a",
          disableModelInvocation: true,
          provenance: { source: "skills_repo" },
        }),
      ],
      [],
    )[0]!.rows[0]!;
    expect(row.badges).toContainEqual({ label: "→ /real/a", variant: "muted" });
    expect(row.badges).toContainEqual({ label: "manual only", variant: "muted" });
    expect(row.badges).toContainEqual({ label: "skills_repo", variant: "muted" });
  });

  it("surfaces warnings verbatim", () => {
    const row = buildSkillGroups(
      [
        skill({
          name: "a",
          path: "/agent/a",
          origin: "agent_dir",
          originLabel: "Pi skills",
          warnings: ["missing description"],
        }),
      ],
      [],
    )[0]!.rows[0]!;
    expect(row.warnings).toEqual(["missing description"]);
  });

  it("tooltips a shared-pattern row (same name under agent_dir and agents_dir)", () => {
    const skills: SkillInfo[] = [
      skill({
        name: "shared",
        path: "/agent/shared",
        origin: "agent_dir",
        originLabel: "Pi skills",
      }),
      skill({
        name: "shared",
        path: "/agents/shared",
        origin: "agents_dir",
        originLabel: "Agent Skills",
      }),
    ];
    const groups = buildSkillGroups(skills, []);
    for (const row of groups.flatMap((g) => g.rows)) {
      expect(row.sharedPatternTooltip).toBe(
        "Pi applies this setting to every 'shared' skill folder.",
      );
    }
  });

  it("no tooltip for a package-origin or uniquely-named row", () => {
    const skills: SkillInfo[] = [
      skill({ name: "solo", path: "/agent/solo", origin: "agent_dir", originLabel: "Pi skills" }),
      skill({
        name: "p",
        path: "/p/p",
        origin: "package",
        originLabel: "pkg",
        packageSource: "npm:x",
      }),
    ];
    const groups = buildSkillGroups(skills, [pkg({ source: "npm:x" })]);
    for (const row of groups.flatMap((g) => g.rows)) {
      expect(row.sharedPatternTooltip).toBeNull();
    }
  });
});

describe("packageHeaderBadges", () => {
  it("always includes the kind badge", () => {
    expect(packageHeaderBadges(pkg({ source: "npm:x" }))).toEqual([
      { label: "npm", variant: "muted" },
    ]);
  });

  it("adds curated and pinned badges when set", () => {
    expect(
      packageHeaderBadges(pkg({ source: "git:x", kind: "git", curated: true, pinned: true })),
    ).toEqual([
      { label: "git", variant: "muted" },
      { label: "curated", variant: "success" },
      { label: "pinned", variant: "muted" },
    ]);
  });
});

describe("filterSkillGroups", () => {
  const skills: SkillInfo[] = [
    skill({
      name: "alpha",
      path: "/a",
      origin: "agent_dir",
      originLabel: "Pi skills",
      description: "first tool",
    }),
    skill({ name: "beta", path: "/b", origin: "agent_dir", originLabel: "Pi skills" }),
    skill({
      name: "gamma",
      path: "/c",
      origin: "agents_dir",
      originLabel: "Agent Skills",
      description: "ALPHA helper",
    }),
  ];
  const groups = buildSkillGroups(skills, []);

  it("an empty query returns every group unchanged", () => {
    expect(filterSkillGroups(groups, "")).toEqual(groups);
    expect(filterSkillGroups(groups, "   ")).toEqual(groups);
  });

  it("matches name case-insensitively", () => {
    const filtered = filterSkillGroups(groups, "ALPHA");
    expect(filtered.flatMap((g) => g.rows.map((r) => r.skill.name))).toEqual(
      expect.arrayContaining(["alpha", "gamma"]),
    );
  });

  it("matches description too, and drops groups left with no rows", () => {
    const filtered = filterSkillGroups(groups, "helper");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.id).toBe("agents_dir");
    expect(filtered[0]!.rows.map((r) => r.skill.name)).toEqual(["gamma"]);
  });

  it("no matches yields no groups", () => {
    expect(filterSkillGroups(groups, "nope")).toEqual([]);
  });
});

describe("requiresCuratedConfirm", () => {
  it("true only for a package-origin skill whose resolved package is curated", () => {
    const curatedPkg = pkg({ source: "npm:curated", curated: true });
    const plainPkg = pkg({ source: "npm:plain", curated: false });
    const curatedSkill = skill({
      name: "a",
      path: "/p/a",
      origin: "package",
      originLabel: "pkg",
      packageSource: "npm:curated",
    });
    const plainSkill = skill({
      name: "b",
      path: "/p/b",
      origin: "package",
      originLabel: "pkg",
      packageSource: "npm:plain",
    });
    const nonPackageSkill = skill({
      name: "c",
      path: "/agent/c",
      origin: "agent_dir",
      originLabel: "Pi skills",
    });

    expect(requiresCuratedConfirm(curatedSkill, [curatedPkg, plainPkg])).toBe(true);
    expect(requiresCuratedConfirm(plainSkill, [curatedPkg, plainPkg])).toBe(false);
    expect(requiresCuratedConfirm(nonPackageSkill, [curatedPkg])).toBe(false);
  });

  it("false for a package skill whose source isn't in the packages list", () => {
    const orphanSkill = skill({
      name: "a",
      path: "/p/a",
      origin: "package",
      originLabel: "pkg",
      packageSource: "npm:missing",
    });
    expect(requiresCuratedConfirm(orphanSkill, [])).toBe(false);
  });
});

describe("skillErrorMessage", () => {
  it("returns null for no error", () => {
    expect(skillErrorMessage(undefined)).toBeNull();
  });

  it("prefers the response's own message when present", () => {
    expect(
      skillErrorMessage("settings_unreadable", "Can't read /home/u/.agent/settings.json."),
    ).toBe("Can't read /home/u/.agent/settings.json.");
  });

  it("maps a known error code to a friendlier message when no message is given", () => {
    expect(skillErrorMessage("settings_unreadable")).toMatch(/settings\.json/);
    expect(skillErrorMessage("timeout")).toBe("Timed out.");
  });

  it("renders an unknown error string verbatim", () => {
    expect(skillErrorMessage("some_future_error")).toBe("some_future_error");
  });
});

describe("skillRemoveConfirmText", () => {
  function removableSkill(overrides: Partial<SkillInfo> & Pick<SkillInfo, "name" | "path">) {
    return skill({ removable: true, ...overrides });
  }

  it("symlink: 'Removes the link only; <target> is kept.'", () => {
    const row = removableSkill({
      name: "a",
      path: "/agent/a",
      origin: "agent_dir",
      originLabel: "Pi skills",
      symlinkTarget: "/real/a",
    });
    expect(skillRemoveConfirmText(row)).toBe("Removes the link only; /real/a is kept.");
  });

  it("Agent Skills with provenance: \"Removes '<name>' for every agent on this machine.\"", () => {
    const row = removableSkill({
      name: "dup",
      path: "/agents/dup",
      origin: "agents_dir",
      originLabel: "Agent Skills",
      provenance: { source: "skills_repo" },
    });
    expect(skillRemoveConfirmText(row)).toBe("Removes 'dup' for every agent on this machine.");
  });

  it("skill path: 'Stops loading <path>; files are kept.'", () => {
    const row = removableSkill({
      name: "s",
      path: "/settings/s",
      origin: "settings_path",
      originLabel: "Skill paths",
    });
    expect(skillRemoveConfirmText(row)).toBe("Stops loading /settings/s; files are kept.");
  });

  it("plain dir: 'Deletes <path>.'", () => {
    const row = removableSkill({
      name: "a",
      path: "/agent/a",
      origin: "agent_dir",
      originLabel: "Pi skills",
    });
    expect(skillRemoveConfirmText(row)).toBe("Deletes /agent/a.");
  });

  it("an agents_dir skill with no provenance falls through to the plain-dir wording", () => {
    const row = removableSkill({
      name: "hand",
      path: "/agents/hand",
      origin: "agents_dir",
      originLabel: "Agent Skills",
    });
    expect(skillRemoveConfirmText(row)).toBe("Deletes /agents/hand.");
  });

  it("a symlinked entry is reported as a symlink regardless of origin", () => {
    const row = removableSkill({
      name: "s",
      path: "/settings/s",
      origin: "settings_path",
      originLabel: "Skill paths",
      symlinkTarget: "/real/s",
    });
    expect(skillRemoveConfirmText(row)).toBe("Removes the link only; /real/s is kept.");
  });
});

describe("removePackageConfirmText", () => {
  it("names the source and skill count, pluralized", () => {
    expect(removePackageConfirmText(pkg({ source: "npm:foo", skillCount: 3 }))).toBe(
      "Remove npm:foo? This removes 3 skills.",
    );
  });

  it("singular for exactly one skill", () => {
    expect(removePackageConfirmText(pkg({ source: "npm:foo", skillCount: 1 }))).toBe(
      "Remove npm:foo? This removes 1 skill.",
    );
  });
});

describe("updateAllTargetLabel", () => {
  it("maps known targets", () => {
    expect(updateAllTargetLabel("agent-skills")).toBe("Agent Skills");
    expect(updateAllTargetLabel("pi-packages")).toBe("Pi packages");
  });

  it("renders an unknown target verbatim", () => {
    expect(updateAllTargetLabel("future-engine")).toBe("future-engine");
  });
});
