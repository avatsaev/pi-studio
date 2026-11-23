// Node's test runner: `node --test desktop/apps/pistudiodesktop/scripts/release/`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compareVersions, nextVersion, releasedVersions } from "./next-version.mjs";

describe("releasedVersions", () => {
  it("keeps only desktop-v<major.minor.patch> tags, highest first (numeric, not text)", () => {
    assert.deepEqual(releasedVersions(["desktop-v0.3.9", "desktop-v0.3.10", "desktop-v0.4.0", "desktop-v0.3.2"]), ["0.4.0", "0.3.10", "0.3.9", "0.3.2"]);
  });

  it("ignores the tag of the release that holds the offered manifest, and every other tag", () => {
    const tags = ["desktop-updates", "v1.2.3", "desktop-v0.3.0-selfcheck", "desktop-v1.0", "desktop-vX", "relay-v9.9.9", "desktop-v0.3.1", ""];
    assert.deepEqual(releasedVersions(tags), ["0.3.1"]);
  });
});

describe("nextVersion", () => {
  it("is the patch after the highest tag", () => {
    assert.deepEqual(nextVersion({ floor: "0.3.0", tags: ["desktop-v0.3.0", "desktop-v0.3.4"] }), { latest: "0.3.4", version: "0.3.5" });
  });

  it("is not moved by the tag of the manifest's release", () => {
    const tags = ["desktop-v0.3.4", "desktop-updates"];
    assert.deepEqual(nextVersion({ floor: "0.3.0", tags }), nextVersion({ floor: "0.3.0", tags: ["desktop-v0.3.4"] }));
    assert.deepEqual(nextVersion({ floor: "0.3.0", tags: ["desktop-updates"] }), { latest: undefined, version: "0.3.0" });
  });

  it("is the floor when no release exists yet, or when the floor is higher", () => {
    assert.deepEqual(nextVersion({ floor: "0.3.0", tags: [] }), { latest: undefined, version: "0.3.0" });
    assert.deepEqual(nextVersion({ floor: "0.4.0", tags: ["desktop-v0.3.9"] }), { latest: "0.3.9", version: "0.4.0" });
  });

  it("is the patch after the highest tag when the floor equals or is below it", () => {
    assert.deepEqual(nextVersion({ floor: "0.3.4", tags: ["desktop-v0.3.4"] }).version, "0.3.5");
    assert.deepEqual(nextVersion({ floor: "0.2.0", tags: ["desktop-v0.3.4"] }).version, "0.3.5");
  });

  it("refuses a floor that is not major.minor.patch", () => {
    assert.throws(() => nextVersion({ floor: "0.3", tags: [] }), /not MAJOR\.MINOR\.PATCH/);
    assert.throws(() => nextVersion({ floor: "", tags: [] }), /not MAJOR\.MINOR\.PATCH/);
  });
});

describe("compareVersions", () => {
  it("compares each part as a number", () => {
    assert.ok(compareVersions("0.3.10", "0.3.9") > 0);
    assert.ok(compareVersions("1.0.0", "0.99.99") > 0);
    assert.equal(compareVersions("0.3.0", "0.3.0"), 0);
  });
});
