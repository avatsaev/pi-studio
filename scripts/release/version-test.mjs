import assert from "node:assert/strict";
import { test } from "node:test";
import { bump, compare, highest, nextRelease, parse, resolveTarget } from "./version.mjs";

test("compare orders numerically, not as text", () => {
  assert.ok(compare("0.0.10", "0.0.9") > 0);
  assert.ok(compare("0.1.0", "0.0.200") > 0);
  assert.equal(compare("1.2.3", "1.2.3"), 0);
});

test("parse refuses anything but MAJOR.MINOR.PATCH", () => {
  for (const bad of ["1.2", "1.2.3-beta.1", "v1.2.3", "latest", ""])
    assert.throws(() => parse(bad), /MAJOR\.MINOR\.PATCH/);
});

test("highest ignores pre-releases and junk", () => {
  assert.equal(highest(["0.0.9", "0.0.10", "0.1.0-rc.1", "x"]), "0.0.10");
  assert.equal(highest([]), undefined);
  assert.equal(highest(["0.2.0-rc.1"]), undefined);
});

test("a release is the patch after the highest published version", () => {
  assert.equal(nextRelease({ floor: "0.0.134", published: ["0.0.133", "0.0.134"] }), "0.0.135");
});

test("a floor above everything published is released as it is (a minor or major release)", () => {
  assert.equal(nextRelease({ floor: "0.1.0", published: ["0.0.134"] }), "0.1.0");
});

test("a floor equal to the highest published version does not repeat it", () => {
  assert.equal(nextRelease({ floor: "0.0.134", published: ["0.0.134"] }), "0.0.135");
});

test("a version only some packages reached is skipped over, never completed", () => {
  assert.equal(nextRelease({ floor: "0.0.134", published: ["0.0.134", "0.0.135"] }), "0.0.136");
});

test("with nothing published the floor is the release", () => {
  assert.equal(nextRelease({ floor: "0.0.1", published: [] }), "0.0.1");
});

test("bump raises one component and resets the lower ones", () => {
  assert.equal(bump("0.0.134", "patch"), "0.0.135");
  assert.equal(bump("0.3.9", "minor"), "0.4.0");
  assert.equal(bump("0.3.9", "major"), "1.0.0");
  assert.throws(() => bump("0.0.1", "next"), /patch, minor or major/);
});

test("an explicit target must be higher than the current version", () => {
  assert.equal(resolveTarget("0.0.140", "0.0.134"), "0.0.140");
  assert.equal(resolveTarget("minor", "0.0.134"), "0.1.0");
  assert.throws(() => resolveTarget("0.0.134", "0.0.134"), /not higher/);
  assert.throws(() => resolveTarget("0.0.133", "0.0.134"), /not higher/);
});
