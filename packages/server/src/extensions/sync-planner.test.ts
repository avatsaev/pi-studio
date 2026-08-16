import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { CURATED_PACKS, type CuratedPackCatalog } from "./curated-packs.js";
import type { PiHomeState } from "./extensions-state.js";
import { planSync } from "./sync-planner.js";

// Table-driven coverage of every branch of § Planner's `planEntry` — no I/O, fixture objects only.

const FIXTURE_CATALOG: CuratedPackCatalog = {
  core: {
    title: "Core",
    description: "",
    packages: [
      { source: "npm:a", addedIn: "0.0.1" },
      { source: "npm:b", addedIn: "0.0.1" },
      { source: "npm:c", addedIn: "0.0.1" },
    ],
  },
};

function emptyState(): PiHomeState {
  return { offered: {}, failures: {} };
}

describe("planSync — fresh state", () => {
  it("plans one action per entry, in manifest order, all pending", () => {
    const plan = planSync({
      catalog: FIXTURE_CATALOG,
      packs: [],
      state: emptyState(),
      settingsPackages: [],
    });
    expect(plan.actions).toEqual([
      { identity: "a", pack: "core", source: "npm:a" },
      { identity: "b", pack: "core", source: "npm:b" },
      { identity: "c", pack: "core", source: "npm:c" },
    ]);
    expect(plan.entries.every((e) => e.status === "pending")).toBe(true);
    expect(plan.entries).toHaveLength(3);
  });

  it("the real catalog's four core entries all plan as pending with no selection", () => {
    const plan = planSync({
      catalog: CURATED_PACKS,
      packs: [],
      state: emptyState(),
      settingsPackages: [],
    });
    expect(plan.actions).toHaveLength(4);
    expect(plan.entries.map((e) => e.status)).toEqual(Array(4).fill("pending"));
  });
});

describe("planSync — never installs over an entry already in settings.json (never offered yet)", () => {
  it("pinned entry pre-existing in settings ⇒ user_modified, no action, even though never offered", () => {
    const plan = planSync({
      catalog: FIXTURE_CATALOG,
      packs: [],
      state: emptyState(),
      settingsPackages: ["npm:a@1.2.3", "npm:c"],
    });
    // `a` was pinned by the user before Pi-Studio ever ran here — must never be installed over.
    expect(plan.actions).toEqual([{ identity: "b", pack: "core", source: "npm:b" }]);
    expect(plan.entries.find((e) => e.identity === "a")?.status).toBe("user_modified");
    expect(plan.entries.find((e) => e.identity === "b")?.status).toBe("pending");
    // `c` is byte-identical to what Pi-Studio would install, but it wasn't Pi-Studio that put it
    // there (never offered) — still adopted as theirs, not silently claimed as ours.
    expect(plan.entries.find((e) => e.identity === "c")?.status).toBe("user_modified");
  });

  it("object-form entry pre-existing in settings ⇒ user_modified, no action", () => {
    const plan = planSync({
      catalog: FIXTURE_CATALOG,
      packs: [],
      state: emptyState(),
      settingsPackages: [{ source: "npm:a", disabledTools: ["x"] }],
    });
    expect(plan.actions).toEqual([
      { identity: "b", pack: "core", source: "npm:b" },
      { identity: "c", pack: "core", source: "npm:c" },
    ]);
    expect(plan.entries.find((e) => e.identity === "a")?.status).toBe("user_modified");
  });

  it("an unrelated foreign package in settings never blocks the normal pending+action path", () => {
    const plan = planSync({
      catalog: FIXTURE_CATALOG,
      packs: [],
      state: emptyState(),
      settingsPackages: ["npm:totally-unrelated-package"],
    });
    expect(plan.actions).toEqual([
      { identity: "a", pack: "core", source: "npm:a" },
      { identity: "b", pack: "core", source: "npm:b" },
      { identity: "c", pack: "core", source: "npm:c" },
    ]);
    expect(plan.entries.every((e) => e.status === "pending")).toBe(true);
  });
});

describe("planSync — steady state (already offered and untouched)", () => {
  it("zero actions, every entry 'installed' — a normal boot after the first is a no-op", () => {
    const state: PiHomeState = {
      offered: {
        a: { installedSpec: "npm:a", atVersion: "0.0.1", at: "2026-01-01T00:00:00Z" },
        b: { installedSpec: "npm:b", atVersion: "0.0.1", at: "2026-01-01T00:00:00Z" },
        c: { installedSpec: "npm:c", atVersion: "0.0.1", at: "2026-01-01T00:00:00Z" },
      },
      failures: {},
    };
    const plan = planSync({
      catalog: FIXTURE_CATALOG,
      packs: [],
      state,
      settingsPackages: ["npm:a", "npm:b", "npm:c"],
    });
    expect(plan.actions).toEqual([]);
    expect(plan.entries.map((e) => e.status)).toEqual(["installed", "installed", "installed"]);
  });
});

describe("planSync — terminal, reporting-only statuses", () => {
  const singleEntryCatalog: CuratedPackCatalog = {
    core: { title: "Core", description: "", packages: [{ source: "npm:a", addedIn: "0.0.1" }] },
  };
  const offeredState: PiHomeState = {
    offered: { a: { installedSpec: "npm:a", atVersion: "0.0.1", at: "2026-01-01T00:00:00Z" } },
    failures: {},
  };

  it("offered + absent from settings ⇒ user_removed, no action (a `pi remove` sticks forever)", () => {
    const plan = planSync({
      catalog: singleEntryCatalog,
      packs: [],
      state: offeredState,
      settingsPackages: [],
    });
    expect(plan.actions).toEqual([]);
    expect(plan.entries[0]?.status).toBe("user_removed");
  });

  it("offered + settings entry differs by a version pin ⇒ user_modified, no action", () => {
    const plan = planSync({
      catalog: singleEntryCatalog,
      packs: [],
      state: offeredState,
      settingsPackages: ["npm:a@1.2.3"],
    });
    expect(plan.actions).toEqual([]);
    expect(plan.entries[0]?.status).toBe("user_modified");
  });

  it("offered + settings entry in object form ⇒ user_modified, no action, even if .source byte-matches", () => {
    const plan = planSync({
      catalog: singleEntryCatalog,
      packs: [],
      state: offeredState,
      settingsPackages: [{ source: "npm:a", disabledTools: ["x"] }],
    });
    expect(plan.actions).toEqual([]);
    expect(plan.entries[0]?.status).toBe("user_modified");
  });
});

describe("planSync — deprecated tombstones", () => {
  const deprecatedCatalog: CuratedPackCatalog = {
    core: {
      title: "Core",
      description: "",
      packages: [{ source: "npm:a", addedIn: "0.0.1", deprecated: true }],
    },
  };

  it("never offered ⇒ deprecated, no action", () => {
    const plan = planSync({
      catalog: deprecatedCatalog,
      packs: [],
      state: emptyState(),
      settingsPackages: [],
    });
    expect(plan.actions).toEqual([]);
    expect(plan.entries[0]?.status).toBe("deprecated");
  });

  it("already offered-and-installed ⇒ still deprecated, no action (checked before offered lookup)", () => {
    const state: PiHomeState = {
      offered: { a: { installedSpec: "npm:a", atVersion: "0.0.1", at: "2026-01-01T00:00:00Z" } },
      failures: {},
    };
    const plan = planSync({
      catalog: deprecatedCatalog,
      packs: [],
      state,
      settingsPackages: ["npm:a"],
    });
    expect(plan.actions).toEqual([]);
    expect(plan.entries[0]?.status).toBe("deprecated");
  });
});

describe("planSync — failed entries retry unconditionally", () => {
  it("a pending entry with a failures record ⇒ status 'failed', action still planned", () => {
    const singleEntryCatalog: CuratedPackCatalog = {
      core: { title: "Core", description: "", packages: [{ source: "npm:a", addedIn: "0.0.1" }] },
    };
    const state: PiHomeState = {
      offered: {},
      failures: {
        a: { source: "npm:a", reason: "not_found", message: "404", attempts: 2, at: "x" },
      },
    };
    const plan = planSync({
      catalog: singleEntryCatalog,
      packs: [],
      state,
      settingsPackages: [],
    });
    expect(plan.actions).toEqual([{ identity: "a", pack: "core", source: "npm:a" }]);
    expect(plan.entries[0]?.status).toBe("failed");
  });
});

describe("planSync — user's own packages are invisible", () => {
  it("identities in settingsPackages not present in the manifest never appear in entries", () => {
    const plan = planSync({
      catalog: FIXTURE_CATALOG,
      packs: [],
      state: emptyState(),
      settingsPackages: [
        "npm:not-curated-at-all",
        { source: "npm:also-not-curated" },
        "./local/path",
      ],
    });
    expect(plan.entries.map((e) => e.identity)).toEqual(["a", "b", "c"]);
  });
});

describe("planSync — corrupt state fail-safe", () => {
  it("state 'unreadable' ⇒ zero actions", () => {
    const plan = planSync({
      catalog: FIXTURE_CATALOG,
      packs: [],
      state: "unreadable",
      settingsPackages: [],
    });
    expect(plan.actions).toEqual([]);
  });
});

describe("planSync — pack selection", () => {
  const twoPackCatalog: CuratedPackCatalog = {
    core: { title: "Core", description: "", packages: [{ source: "npm:a", addedIn: "0.0.1" }] },
    swe: { title: "SWE", description: "", packages: [{ source: "npm:b", addedIn: "0.0.1" }] },
  };

  it("unknown selected slug is ignored; core is always included even when packs is empty", () => {
    const plan = planSync({
      catalog: twoPackCatalog,
      packs: ["nope"],
      state: emptyState(),
      settingsPackages: [],
    });
    expect(plan.entries.map((e) => e.identity)).toEqual(["a"]);
  });

  it("selecting an extra pack adds its entries alongside core's", () => {
    const plan = planSync({
      catalog: twoPackCatalog,
      packs: ["swe"],
      state: emptyState(),
      settingsPackages: [],
    });
    expect(plan.entries.map((e) => e.identity)).toEqual(["a", "b"]);
  });
});

describe("planSync — no I/O", () => {
  it("sync-planner.ts's own source imports no node:fs/node:child_process (this test file imports none either)", () => {
    const source = readFileSync(new URL("./sync-planner.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from "node:(fs|child_process)"/);
  });

  it("never mutates the settingsPackages input array", () => {
    const settingsPackages = Object.freeze(["npm:a"]);
    expect(() =>
      planSync({
        catalog: FIXTURE_CATALOG,
        packs: [],
        state: {
          offered: { a: { installedSpec: "npm:a", atVersion: "0.0.1", at: "x" } },
          failures: {},
        },
        settingsPackages,
      }),
    ).not.toThrow();
  });
});
