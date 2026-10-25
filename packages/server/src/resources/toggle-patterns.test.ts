/**
 * Unit tests for the `config-selector.js` toggle-pattern mirror (sprint-075/task-002).
 *
 * The `topLevelPattern`/`packagePattern`/`replacePattern` cases below are frozen from a
 * differential run of Pi 1.4.0's own code: a throwaway script (never checked in) imported
 * `dist/modes/interactive/components/config-selector.js` directly by file path, pointed a
 * `SettingsManager` at a temporary `HOME`/`PI_CODING_AGENT_DIR`, constructed a
 * `ConfigSelectorComponent` with hand-built `resolve()`-shaped skill entries, and called
 * `ResourceList#toggleTopLevelResource` / `#togglePackageResource` directly, capturing the
 * resulting `settings.json` mutations. See `toggle-patterns.ts`'s module header for exactly which
 * lines were exercised and why the collapse case additionally needed `enabled === undefined`
 * (unreachable through Pi's own boolean-only toggle, which always replaces rather than clears).
 */

import { describe, expect, it } from "vitest";

import {
  applyPackageToggle,
  packagePattern,
  replacePattern,
  topLevelPattern,
} from "./toggle-patterns.js";
import type { PiPackageSource } from "./toggle-patterns.js";

const AGENT_DIR = "/tmp/pi-agentdir-xyz";
const AGENTS_HOME_DIR = "/tmp/pi-home-xyz/.agents";

describe("topLevelPattern (mirrors getResourcePattern, config-selector.js:708-714)", () => {
  it("agentDir skill: relative(agentDir, path) — baseDir undefined", () => {
    expect(topLevelPattern(`${AGENT_DIR}/skills/foo/SKILL.md`, undefined, AGENT_DIR)).toBe(
      "skills/foo/SKILL.md",
    );
  });

  it("~/.agents skill: relative(baseDir, path) — explicit baseDir wins over agentDir", () => {
    expect(
      topLevelPattern(`${AGENTS_HOME_DIR}/skills/bar/SKILL.md`, AGENTS_HOME_DIR, AGENT_DIR),
    ).toBe("skills/bar/SKILL.md");
  });
});

describe("packagePattern (mirrors getPackageResourcePattern, config-selector.js:715-717)", () => {
  it("relative(baseDir, path) for a package-rooted skill", () => {
    expect(packagePattern("/pkgroot/skills/x/SKILL.md", "/pkgroot")).toBe("skills/x/SKILL.md");
  });
});

describe("replacePattern (mirrors config-selector.js:436-445, 499-508)", () => {
  it("absent entries + enable → single append", () => {
    expect(replacePattern(undefined, "skills/foo/SKILL.md", false)).toEqual([
      "-skills/foo/SKILL.md",
    ]);
  });

  it(
    "an existing '-pattern' entry for a DIFFERENT stripped target is left alone, new one appended " +
      "— verified against real Pi: toggling ~/.agents 'bar' on with a stale '-skills/bar' entry " +
      "(the pre-rename pattern) keeps both, since 'skills/bar' !== 'skills/bar/SKILL.md'",
    () => {
      expect(replacePattern(["-skills/bar"], "skills/bar/SKILL.md", true)).toEqual([
        "-skills/bar",
        "+skills/bar/SKILL.md",
      ]);
    },
  );

  it("an existing '!pattern' entry for a different stripped target is left alone too", () => {
    expect(replacePattern(["!skills/baz"], "skills/baz/SKILL.md", false)).toEqual([
      "!skills/baz",
      "-skills/baz/SKILL.md",
    ]);
  });

  it("an existing entry with the SAME stripped pattern is replaced, never duplicated", () => {
    expect(replacePattern(["-skills/foo/SKILL.md"], "skills/foo/SKILL.md", true)).toEqual([
      "+skills/foo/SKILL.md",
    ]);
    expect(
      replacePattern(["+skills/foo/SKILL.md", "-skills/other"], "skills/foo/SKILL.md", false),
    ).toEqual(["-skills/other", "-skills/foo/SKILL.md"]);
  });

  it("enabled === undefined clears any matching override without replacing it", () => {
    expect(replacePattern(["-skills/foo/SKILL.md"], "skills/foo/SKILL.md", undefined)).toEqual([]);
    expect(
      replacePattern(["-skills/foo/SKILL.md", "+skills/other"], "skills/foo/SKILL.md", undefined),
    ).toEqual(["+skills/other"]);
  });
});

describe("applyPackageToggle (mirrors togglePackageResource, config-selector.js:475-521)", () => {
  it("string source entry is upgraded to object form and gains a skills filter", () => {
    const packages: PiPackageSource[] = ["npm:some-pack"];
    expect(applyPackageToggle(packages, "npm:some-pack", "skills/x/SKILL.md", false)).toEqual([
      { source: "npm:some-pack", skills: ["-skills/x/SKILL.md"] },
    ]);
  });

  it("object source entry: existing skills filter for a different stripped target is kept, new one appended", () => {
    const packages: PiPackageSource[] = [{ source: "npm:some-pack2", skills: ["-skills/y"] }];
    expect(applyPackageToggle(packages, "npm:some-pack2", "skills/y/SKILL.md", true)).toEqual([
      { source: "npm:some-pack2", skills: ["-skills/y", "+skills/y/SKILL.md"] },
    ]);
  });

  it("autoload:false is preserved across the toggle", () => {
    const packages: PiPackageSource[] = [
      { source: "npm:some-pack3", autoload: false, skills: ["-skills/z"] },
    ];
    expect(applyPackageToggle(packages, "npm:some-pack3", "skills/z/SKILL.md", true)).toEqual([
      { source: "npm:some-pack3", autoload: false, skills: ["-skills/z", "+skills/z/SKILL.md"] },
    ]);
  });

  it("other package entries are left untouched", () => {
    const packages: PiPackageSource[] = ["npm:untouched", { source: "npm:target", skills: [] }];
    const result = applyPackageToggle(packages, "npm:target", "skills/a", true);
    expect(result[0]).toBe("npm:untouched");
    expect(result[1]).toEqual({ source: "npm:target", skills: ["+skills/a"] });
  });

  it("a same-pattern entry is replaced, never duplicated", () => {
    const packages: PiPackageSource[] = [{ source: "npm:x", skills: ["+skills/a"] }];
    expect(applyPackageToggle(packages, "npm:x", "skills/a", false)).toEqual([
      { source: "npm:x", skills: ["-skills/a"] },
    ]);
  });

  it("a package entry whose only filter is cleared (enabled undefined) collapses back to a bare string", () => {
    const packages: PiPackageSource[] = [{ source: "npm:x", skills: ["-skills/a"] }];
    expect(applyPackageToggle(packages, "npm:x", "skills/a", undefined)).toEqual(["npm:x"]);
  });

  it("clearing one filter does not collapse an entry that still has another filter type set", () => {
    const packages: PiPackageSource[] = [
      { source: "npm:x", skills: ["-skills/a"], extensions: ["-ext/b"] },
    ];
    expect(applyPackageToggle(packages, "npm:x", "skills/a", undefined)).toEqual([
      { source: "npm:x", extensions: ["-ext/b"] },
    ]);
  });

  it("unknown source throws", () => {
    expect(() => applyPackageToggle(["npm:other"], "npm:missing", "skills/a", true)).toThrow(
      /no package entry for source/,
    );
  });
});
