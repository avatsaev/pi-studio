// Node's test runner: `node --test desktop/apps/pistudiodesktop/scripts/release/`.
// Spec desktop-usage-data U1, U2: the PostHog project token reaches a build only through the Bundle step
// of `bundle-release` in desktop-release.yml (the variable lives in the `desktop-release` environment, which only
// that job names), and no other step references it.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const RELEASE = ".github/workflows/desktop-release.yml";

function filesUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/** Every line of every file under `.github/workflows` and `.github/actions` that contains `needle`. */
function references(needle) {
  const hits = [];
  for (const dir of [".github/workflows", ".github/actions"]) {
    for (const path of filesUnder(join(ROOT, dir))) {
      readFileSync(path, "utf8")
        .split("\n")
        .forEach((text, index) => {
          if (text.includes(needle)) hits.push({ file: relative(ROOT, path), line: index + 1, text });
        });
    }
  }
  return hits;
}

/** The job id and step name enclosing a 1-based line of the workflow. */
function locate(file, line) {
  const lines = readFileSync(join(ROOT, file), "utf8").split("\n");
  let job = null;
  let step = null;
  for (let i = line - 1; i >= 0 && (job === null || step === null); i--) {
    if (step === null) step = /^\s*- name: (.+)$/.exec(lines[i])?.[1] ?? null;
    if (job === null) job = /^  ([A-Za-z0-9_-]+):\s*$/.exec(lines[i])?.[1] ?? null;
  }
  return { job, step };
}

describe("usage data token in the release workflow", () => {
  for (const needle of ["POSTHOG_PROJECT_TOKEN", "PISTUDIODESKTOP_POSTHOG_TOKEN"]) {
    it(`${needle} appears once, in the Bundle step of bundle-release`, () => {
      const hits = references(needle);
      assert.equal(hits.length, 1, `expected one reference, found: ${JSON.stringify(hits)}`);
      assert.equal(hits[0].file, RELEASE);
      assert.deepEqual(locate(hits[0].file, hits[0].line), { job: "bundle-release", step: "Bundle" });
    });
  }

  it("the two names sit together on one line", () => {
    const [hit] = references("PISTUDIODESKTOP_POSTHOG_TOKEN");
    assert.match(hit.text, /PISTUDIODESKTOP_POSTHOG_TOKEN: \$\{\{ vars\.POSTHOG_PROJECT_TOKEN \}\}/);
  });

  it("PISTUDIODESKTOP_USAGE_ENDPOINT appears nowhere", () => {
    assert.deepEqual(references("PISTUDIODESKTOP_USAGE_ENDPOINT"), []);
  });
});
