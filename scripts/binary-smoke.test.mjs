// Pure parts of binary-smoke.mjs. Run with `node --test scripts/binary-smoke.test.mjs` (the root
// vitest run only discovers `packages/*`).
import assert from "node:assert/strict";
import { test } from "node:test";

import { firstLine, parseArgs, smokeConfig, smokeEnv } from "./binary-smoke.mjs";

test("parseArgs takes the folder and --expect-version in both spellings", () => {
  assert.deepEqual(parseArgs(["dist-binary/x"]), {
    folder: "dist-binary/x",
    expectVersion: undefined,
  });
  assert.deepEqual(parseArgs(["x", "--expect-version", "1.2.3"]), {
    folder: "x",
    expectVersion: "1.2.3",
  });
  assert.deepEqual(parseArgs(["--expect-version=1.2.3", "x"]), {
    folder: "x",
    expectVersion: "1.2.3",
  });
});

test("parseArgs rejects a missing folder, a missing value and unknown arguments", () => {
  assert.throws(() => parseArgs([]), /usage/);
  assert.throws(() => parseArgs(["x", "--expect-version"]), /needs a value/);
  assert.throws(() => parseArgs(["x", "--all"]), /unknown argument/);
  assert.throws(() => parseArgs(["x", "y"]), /unexpected argument/);
});

test("smokeEnv drops every PI_* variable and points the binary at the temporary home", () => {
  const env = smokeEnv(
    { PATH: "/bin", PI_STUDIO_HOME: "/real", PI_CODING_AGENT_DIR: "/real/.pi", HOME: "/real" },
    "/tmp/h",
  );
  assert.deepEqual(env, {
    PATH: "/bin",
    HOME: "/tmp/h",
    PI_STUDIO_HOME: "/tmp/h/pi-studio",
    PI_CODING_AGENT_DIR: "/tmp/h/.pi/agent",
    PI_SKIP_VERSION_CHECK: "1",
    PI_TELEMETRY: "0",
  });
});

test("smokeConfig keeps the update check off", () => {
  assert.equal(smokeConfig().daemon.update.autoCheck, false);
});

test("firstLine is the first non-empty trimmed line", () => {
  assert.equal(firstLine("\n  boom  \nmore"), "boom");
  assert.equal(firstLine(""), "");
});
