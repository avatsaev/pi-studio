import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CURATED_PACKS,
  type CuratedPackCatalog,
  checkCatalogInvariants,
  identityOf,
  parseSource,
  selectEntries,
  SERVER_VERSION,
} from "./curated-packs.js";

// Guard test for the manifest invariants (swe/features/preinstalled-extensions.md § The manifest),
// same idiom as packages/web-client/src/theme/token-integrity.test.ts: assert the real manifest is
// clean, then prove each invariant actually rejects a deliberately broken fixture — never by
// editing the real manifest.

describe("CURATED_PACKS (the real manifest)", () => {
  it("core has exactly the five spec'd sources, all npm, all unpinned, addedIn 0.0.73", () => {
    expect(Object.keys(CURATED_PACKS.core.packages)).toHaveLength(5);
    const sources = CURATED_PACKS.core.packages.map((p) => p.source);
    expect(sources).toEqual([
      "npm:@99percentpeople/pi-background-tasks",
      "npm:pi-memctx",
      "npm:@juicesharp/rpiv-todo",
      "npm:pi-web-access",
      "npm:pi-powerline-footer",
    ]);
    for (const entry of CURATED_PACKS.core.packages) {
      expect(parseSource(entry.source)).toMatchObject({ kind: "npm", pinned: false });
      expect(entry.addedIn).toBe("0.0.73");
      expect(entry.deprecated).toBeUndefined();
    }
  });

  it("passes checkCatalogInvariants with zero violations", () => {
    expect(checkCatalogInvariants(CURATED_PACKS)).toEqual([]);
  });

  it("SERVER_VERSION matches packages/server/package.json, never the root package.json", () => {
    // Read live rather than hardcode a literal: this must keep passing across every version
    // bump, not just the version current when this test was written (a hardcoded literal here
    // would fail every single release the moment `scripts/publish.sh` bumps the version before
    // this suite runs — see the 0.0.74 release CI failure this test was fixed to prevent).
    const serverPkgPath = new URL("../../package.json", import.meta.url);
    const serverPkg = JSON.parse(readFileSync(serverPkgPath, "utf8"));
    expect(SERVER_VERSION).toBe(serverPkg.version);
    // The root package.json has no "version" field at all — nothing to confuse this with.
    const rootPkgPath = new URL("../../../../package.json", import.meta.url);
    const rootPkg = JSON.parse(readFileSync(rootPkgPath, "utf8"));
    expect(rootPkg.version).toBeUndefined();
  });

  it("SERVER_VERSION resolves correctly from the compiled dist/ layout too (skips if unbuilt)", () => {
    const distEntry = new URL("../../dist/extensions/curated-packs.js", import.meta.url);
    if (!existsSync(distEntry)) return; // npm run build:server not run yet — covered separately.
    const out = execFileSync(
      process.execPath,
      ["-e", `import(${JSON.stringify(distEntry.href)}).then(m => console.log(m.SERVER_VERSION))`],
      { encoding: "utf8" },
    ).trim();
    expect(out).toBe(SERVER_VERSION);
  });
});

describe("parseSource", () => {
  it("detects pinned npm specs (exact version) vs unpinned", () => {
    expect(parseSource("npm:foo@1.2.3")).toEqual({ kind: "npm", identity: "foo", pinned: true });
    expect(parseSource("npm:foo")).toEqual({ kind: "npm", identity: "foo", pinned: false });
  });

  it("does not split a scoped package's leading @ as a version separator", () => {
    expect(parseSource("npm:@scope/foo")).toEqual({
      kind: "npm",
      identity: "@scope/foo",
      pinned: false,
    });
    expect(parseSource("npm:@scope/foo@1.2.3")).toEqual({
      kind: "npm",
      identity: "@scope/foo",
      pinned: true,
    });
  });

  it("detects pinned git specs (a ref) vs unpinned, scp-like form", () => {
    expect(parseSource("git:git@github.com:o/r@v1")).toEqual({
      kind: "git",
      identity: "git@github.com:o/r",
      pinned: true,
    });
    expect(parseSource("git:git@github.com:o/r")).toEqual({
      kind: "git",
      identity: "git@github.com:o/r",
      pinned: false,
    });
  });

  it("throws on a source with neither npm: nor git: scheme", () => {
    expect(() => parseSource("pi-web-access")).toThrow();
  });
});

describe("identityOf", () => {
  it("strips the version/ref, matching parseSource(...).identity", () => {
    expect(identityOf("npm:@scope/foo")).toBe("@scope/foo");
    expect(identityOf("npm:pi-web-access@1.0.0")).toBe("pi-web-access");
    expect(identityOf("git:git@github.com:o/r@main")).toBe("git@github.com:o/r");
  });
});

describe("selectEntries", () => {
  it("selectEntries(CURATED_PACKS, []) yields exactly the five core entries", () => {
    const { entries, unknownSlugs } = selectEntries(CURATED_PACKS, []);
    expect(entries.map((e) => e.entry.source)).toEqual(
      CURATED_PACKS.core.packages.map((p) => p.source),
    );
    expect(entries.every((e) => e.pack === "core")).toBe(true);
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
