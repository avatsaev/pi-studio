/**
 * settings-categories.ts — asserts the behavior a consumer observes (a category or the gear is
 * reachable), not the shape of the `SETTINGS_CATEGORIES` array literal (sprint-073/task-006).
 */

import { describe, expect, it } from "vitest";
import { buildSettingsCategoryCapabilities, SETTINGS_CATEGORIES } from "./settings-categories.js";

describe("SETTINGS_CATEGORIES", () => {
  it("the Viewers category is available with no server capabilities at all", () => {
    const caps = buildSettingsCategoryCapabilities(undefined);
    const viewers = SETTINGS_CATEGORIES.find((c) => c.id === "viewers");
    expect(viewers).toBeDefined();
    expect(viewers!.available(caps)).toBe(true);
  });

  it("at least one category is available with no server capabilities — the settings gear must be reachable", () => {
    const caps = buildSettingsCategoryCapabilities(undefined);
    expect(SETTINGS_CATEGORIES.some((c) => c.available(caps))).toBe(true);
  });

  it("Model Providers stays capability-gated: absent without providerAuth, present with it", () => {
    const withoutAuth = buildSettingsCategoryCapabilities({});
    const withAuth = buildSettingsCategoryCapabilities({ providerAuth: true });
    const providers = SETTINGS_CATEGORIES.find((c) => c.id === "providers")!;
    expect(providers.available(withoutAuth)).toBe(false);
    expect(providers.available(withAuth)).toBe(true);
  });
});

describe("buildSettingsCategoryCapabilities", () => {
  it("reads providerAuth from the features map, defaulting falsy/missing to false", () => {
    expect(buildSettingsCategoryCapabilities(undefined).providerAuth).toBe(false);
    expect(buildSettingsCategoryCapabilities({}).providerAuth).toBe(false);
    expect(buildSettingsCategoryCapabilities({ providerAuth: false }).providerAuth).toBe(false);
    expect(buildSettingsCategoryCapabilities({ providerAuth: true }).providerAuth).toBe(true);
  });
});
