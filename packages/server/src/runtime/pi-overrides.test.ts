import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BINARY_EXCLUDED_PACKAGES } from "./excluded-packages.js";
import { applyPiOverrides, withoutExcluded } from "./pi-overrides.js";

/**
 * Against Pi's real `SettingsManager` and `DefaultPackageManager` in a temporary agent folder
 * (swe/architecture/single-binary-daemon.md § Pi's settings). The patch is on the classes' prototypes
 * for this file's module graph only: vitest isolates each test file.
 */

const EXCLUDED = BINARY_EXCLUDED_PACKAGES[0] ?? "";
const OTHER = "npm:pi-powerline-footer";
const BUN = "/opt/pi-studio/bun";

let agentDir: string;
let cwd: string;
let settingsFile: string;

beforeAll(() => {
  agentDir = mkdtempSync(join(tmpdir(), "pi-overrides-agent-"));
  cwd = mkdtempSync(join(tmpdir(), "pi-overrides-cwd-"));
  settingsFile = join(agentDir, "settings.json");
  writeFileSync(
    settingsFile,
    JSON.stringify({ packages: [EXCLUDED, OTHER, { source: `${EXCLUDED}@1.2.3` }] }, null, 2),
  );
  applyPiOverrides(
    { SettingsManager, DefaultPackageManager },
    { bunScript: BUN, excluded: BINARY_EXCLUDED_PACKAGES },
  );
});

afterAll(() => {
  rmSync(agentDir, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

function open() {
  const settings = SettingsManager.create(cwd, agentDir);
  return {
    settings,
    packages: new DefaultPackageManager({ cwd, agentDir, settingsManager: settings }),
  };
}

function readPackages(): unknown[] {
  const parsed: unknown = JSON.parse(readFileSync(settingsFile, "utf8"));
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("packages" in parsed) ||
    !Array.isArray(parsed.packages)
  )
    return [];
  return parsed.packages;
}

function sourceOf(entry: unknown): unknown {
  if (typeof entry === "object" && entry !== null && "source" in entry) return entry.source;
  return entry;
}

describe("applyPiOverrides", () => {
  it("makes the bun script Pi's package manager", () => {
    expect(open().settings.getNpmCommand()).toEqual([BUN]);
  });

  it("does not offer an excluded package to resolve(), by any spelling, and still offers the others", async () => {
    const { packages } = open();
    const asked: string[] = [];
    await packages.resolve(async (source: string) => {
      asked.push(source);
      return "skip";
    });
    expect(asked).toEqual([OTHER]);
  });

  it("keeps the excluded entries in the settings Pi reads outside resolve(), so a write never drops them", () => {
    const { settings } = open();
    expect(settings.getGlobalSettings().packages?.map(sourceOf)).toEqual([
      EXCLUDED,
      OTHER,
      `${EXCLUDED}@1.2.3`,
    ]);
  });
  it("installing a package keeps every entry and writes no other file", async () => {
    const before = readPackages();
    const { settings, packages } = open();
    expect(packages.addSourceToSettings("npm:another-package")).toBe(true);
    await settings.flush();
    expect(readPackages()).toEqual([...before, "npm:another-package"]);
    expect(readdirSync(agentDir)).toEqual(["settings.json"]);
  });

  it("is idempotent", () => {
    applyPiOverrides(
      { SettingsManager, DefaultPackageManager },
      { bunScript: "/elsewhere/bun", excluded: [] },
    );
    expect(open().settings.getNpmCommand()).toEqual([BUN]);
  });
});

describe("withoutExcluded", () => {
  const identities = new Set(["@scope/excluded"]);

  it("drops string and object entries by identity, ignoring the version", () => {
    const kept = withoutExcluded(
      ["npm:@scope/excluded@2.0.0", { source: "npm:@scope/excluded" }, "npm:keep"],
      identities,
    );
    expect(kept).toEqual(["npm:keep"]);
  });

  it("keeps local paths", () => {
    expect(withoutExcluded(["./my-extension"], identities)).toEqual(["./my-extension"]);
  });

  it("passes an absent list through", () => {
    expect(withoutExcluded(undefined, identities)).toBeUndefined();
  });
});
