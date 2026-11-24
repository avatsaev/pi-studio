import { describe, expect, it } from "vitest";

import {
  CURATED_PACKS,
  type CuratedPackCatalog,
  checkCatalogInvariants,
  selectEntries,
} from "./curated-packs.js";
import { parseSource } from "./pi-source.js";

// Guard test for the manifest invariants (swe/features/preinstalled-extensions.md § The manifest),
// same idiom as packages/web-client/src/theme/token-integrity.test.ts: assert the real manifest is
// clean, then prove each invariant actually rejects a deliberately broken fixture — never by
// editing the real manifest.

describe("CURATED_PACKS (the real manifest)", () => {
  it("core has exactly the three spec'd sources, all npm, all unpinned", () => {
    expect(Object.keys(CURATED_PACKS.core.packages)).toHaveLength(3);
    const sources = CURATED_PACKS.core.packages.map((p) => p.source);
    expect(sources).toEqual([
      "npm:@juicesharp/rpiv-todo",
      "npm:pi-web-access",
      "npm:@juicesharp/rpiv-ask-user-question",
    ]);
    for (const entry of CURATED_PACKS.core.packages) {
      expect(parseSource(entry.source)).toMatchObject({ kind: "npm", pinned: false });
      expect(entry.deprecated).toBeUndefined();
    }
    const addedIns = Object.fromEntries(
      CURATED_PACKS.core.packages.map((p) => [p.source, p.addedIn]),
    );
    expect(addedIns).toEqual({
      "npm:@juicesharp/rpiv-todo": "0.0.73",
      "npm:pi-web-access": "0.0.73",
      "npm:@juicesharp/rpiv-ask-user-question": "0.0.93",
    });
  });

  it("passes checkCatalogInvariants with zero violations", () => {
    expect(checkCatalogInvariants(CURATED_PACKS)).toEqual([]);
  });
});

describe("selectEntries", () => {
  it("selectEntries(CURATED_PACKS, []) yields exactly the three core entries", () => {
    const { entries, unknownSlugs } = selectEntries(CURATED_PACKS, []);
    expect(entries.map((e) => e.entry.source)).toEqual(
      CURATED_PACKS.core.packages.map((p) => p.source),
    );
    expect(entries.every((e) => e.pack === "core")).toBe(true);
    expect(unknownSlugs).toEqual([]);
  });

  it("selecting molagent adds its git entry after core", () => {
    const { entries, unknownSlugs } = selectEntries(CURATED_PACKS, ["molagent"]);
    expect(entries.map((e) => [e.pack, e.entry.source])).toEqual([
      ...CURATED_PACKS.core.packages.map((p) => ["core", p.source]),
      ["molagent", "git:github.com/avatsaev/pi-molagent"],
    ]);
    expect(unknownSlugs).toEqual([]);
  });

  it("reports an unknown slug without throwing, alongside the core entries", () => {
    const { entries, unknownSlugs } = selectEntries(CURATED_PACKS, ["nope"]);
    expect(entries.map((e) => e.entry.source)).toEqual(
      CURATED_PACKS.core.packages.map((p) => p.source),
    );
    expect(unknownSlugs).toEqual(["nope"]);
  });

  it("puts core first, is order-stable, and dedupes across packs/repeats", () => {
    const catalog: CuratedPackCatalog = {
      core: { title: "Core", description: "", packages: [{ source: "npm:a", addedIn: "0.0.1" }] },
      swe: { title: "SWE", description: "", packages: [{ source: "npm:b", addedIn: "0.0.1" }] },
    };
    const { entries } = selectEntries(catalog, ["swe", "swe", "core"]);
    expect(entries.map((e) => e.entry.source)).toEqual(["npm:a", "npm:b"]);
    expect(entries.map((e) => e.pack)).toEqual(["core", "swe"]);
  });
});

describe("checkCatalogInvariants (fed deliberately broken fixture catalogs)", () => {
  const base: CuratedPackCatalog = {
    core: {
      title: "Core",
      description: "",
      packages: [{ source: "npm:pi-web-access", addedIn: "0.0.1" }],
    },
  };

  it("rejects a pinned npm source", () => {
    const violations = checkCatalogInvariants(
      { core: { ...base.core, packages: [{ source: "npm:foo@1.2.3", addedIn: "0.0.1" }] } },
      "0.0.73",
    );
    expect(violations.some((v) => v.message.includes("unpinned"))).toBe(true);
  });

  it("rejects a pinned git source", () => {
    const violations = checkCatalogInvariants(
      {
        core: {
          ...base.core,
          packages: [{ source: "git:git@github.com:o/r@v1", addedIn: "0.0.1" }],
        },
      },
      "0.0.73",
    );
    expect(violations.some((v) => v.message.includes("unpinned"))).toBe(true);
  });

  it("rejects a duplicate identity across two packs", () => {
    const violations = checkCatalogInvariants(
      {
        ...base,
        swe: {
          title: "SWE",
          description: "",
          packages: [{ source: "npm:pi-web-access", addedIn: "0.0.1" }],
        },
      },
      "0.0.73",
    );
    expect(violations.some((v) => v.message.includes("also appears in pack"))).toBe(true);
  });

  it("rejects a placeholder source", () => {
    const violations = checkCatalogInvariants(
      { core: { ...base.core, packages: [{ source: "npm:<pkg>", addedIn: "0.0.1" }] } },
      "0.0.73",
    );
    expect(violations.some((v) => v.message.includes("placeholder"))).toBe(true);
  });

  it("rejects a bad-semver addedIn", () => {
    const violations = checkCatalogInvariants(
      {
        core: {
          ...base.core,
          packages: [{ source: "npm:pi-web-access", addedIn: "not-a-version" }],
        },
      },
      "0.0.73",
    );
    expect(violations.some((v) => v.message.includes("not valid semver"))).toBe(true);
  });

  it("rejects an addedIn newer than the current version", () => {
    const violations = checkCatalogInvariants(
      { core: { ...base.core, packages: [{ source: "npm:pi-web-access", addedIn: "9.9.9" }] } },
      "0.0.73",
    );
    expect(violations.some((v) => v.message.includes("is newer than"))).toBe(true);
  });

  it("rejects a catalog missing the core pack", () => {
    const violations = checkCatalogInvariants(
      { swe: { title: "SWE", description: "", packages: [] } },
      "0.0.73",
    );
    expect(violations.some((v) => v.message.includes("must define a 'core' pack"))).toBe(true);
  });

  it("a clean fixture catalog has zero violations", () => {
    expect(checkCatalogInvariants(base, "0.0.73")).toEqual([]);
  });
});
