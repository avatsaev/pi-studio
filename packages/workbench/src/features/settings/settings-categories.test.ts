/**
 * settings-categories.ts — asserts the behavior a consumer observes (a category or the gear is
 * reachable), not the shape of the `SETTINGS_CATEGORIES` array literal (sprint-073/task-006).
 */

import { describe, expect, it } from "vitest";
import { buildSettingsCategoryCapabilities, SETTINGS_CATEGORIES } from "./settings-categories.js";

const NO_HOST = { usageData: false };

describe("SETTINGS_CATEGORIES", () => {
  it("the Viewers category is available with no server capabilities at all", () => {
    const caps = buildSettingsCategoryCapabilities(undefined, NO_HOST);
    const viewers = SETTINGS_CATEGORIES.find((c) => c.id === "viewers");
    expect(viewers).toBeDefined();
    expect(viewers!.available(caps)).toBe(true);
  });

  it("Appearance is available with no server capabilities, after Model Providers", () => {
    const ids = SETTINGS_CATEGORIES.filter((c) =>
      c.available(buildSettingsCategoryCapabilities({ providerAuth: true }, NO_HOST)),
    ).map((c) => c.id);
    expect(ids[0]).toBe("providers");
    expect(ids).toContain("appearance");
    const appearance = SETTINGS_CATEGORIES.find((c) => c.id === "appearance")!;
    expect(appearance.available(buildSettingsCategoryCapabilities(undefined, NO_HOST))).toBe(true);
  });

  it("at least one category is available with no server capabilities — the settings gear must be reachable", () => {
    const caps = buildSettingsCategoryCapabilities(undefined, NO_HOST);
    expect(SETTINGS_CATEGORIES.some((c) => c.available(caps))).toBe(true);
  });

  it("Model Providers stays capability-gated: absent without providerAuth, present with it", () => {
    const withoutAuth = buildSettingsCategoryCapabilities({}, NO_HOST);
    const withAuth = buildSettingsCategoryCapabilities({ providerAuth: true }, NO_HOST);
    const providers = SETTINGS_CATEGORIES.find((c) => c.id === "providers")!;
    expect(providers.available(withoutAuth)).toBe(false);
    expect(providers.available(withAuth)).toBe(true);
  });

  it("Skills is capability-gated: absent without skills, present with it", () => {
    const withoutSkills = buildSettingsCategoryCapabilities({}, NO_HOST);
    const withSkills = buildSettingsCategoryCapabilities({ skills: true }, NO_HOST);
    const skills = SETTINGS_CATEGORIES.find((c) => c.id === "skills")!;
    expect(skills.available(withoutSkills)).toBe(false);
    expect(skills.available(withSkills)).toBe(true);
  });

  it("Daemon is capability-gated: absent without daemonUpdate, present with it", () => {
    const withoutUpdate = buildSettingsCategoryCapabilities(
      { providerAuth: true, skills: true },
      NO_HOST,
    );
    const withUpdate = buildSettingsCategoryCapabilities({ daemonUpdate: true }, NO_HOST);
    const daemon = SETTINGS_CATEGORIES.find((c) => c.id === "daemon")!;
    expect(daemon.label).toBe("Daemon");
    expect(daemon.available(withoutUpdate)).toBe(false);
    expect(daemon.available(buildSettingsCategoryCapabilities(undefined, NO_HOST))).toBe(false);
    expect(daemon.available(withUpdate)).toBe(true);
  });
});

describe("buildSettingsCategoryCapabilities", () => {
  it("reads providerAuth and skills from the features map, defaulting falsy/missing to false", () => {
    expect(buildSettingsCategoryCapabilities(undefined, NO_HOST).providerAuth).toBe(false);
    expect(buildSettingsCategoryCapabilities(undefined, NO_HOST).skills).toBe(false);
    expect(buildSettingsCategoryCapabilities({}, NO_HOST).providerAuth).toBe(false);
    expect(buildSettingsCategoryCapabilities({}, NO_HOST).skills).toBe(false);
    expect(buildSettingsCategoryCapabilities({ providerAuth: false }, NO_HOST).providerAuth).toBe(
      false,
    );
    expect(buildSettingsCategoryCapabilities({ providerAuth: true }, NO_HOST).providerAuth).toBe(
      true,
    );
    expect(buildSettingsCategoryCapabilities({ skills: false }, NO_HOST).skills).toBe(false);
    expect(buildSettingsCategoryCapabilities({ skills: true }, NO_HOST).skills).toBe(true);
    expect(buildSettingsCategoryCapabilities(undefined, NO_HOST).daemonUpdate).toBe(false);
    expect(buildSettingsCategoryCapabilities({ daemonUpdate: false }, NO_HOST).daemonUpdate).toBe(
      false,
    );
    expect(buildSettingsCategoryCapabilities({ daemonUpdate: true }, NO_HOST).daemonUpdate).toBe(
      true,
    );
  });

  it("Privacy is host-gated: absent without a usageData member, present with one", () => {
    const privacy = SETTINGS_CATEGORIES.find((c) => c.id === "privacy")!;
    expect(privacy.available(buildSettingsCategoryCapabilities({}, { usageData: false }))).toBe(
      false,
    );
    expect(privacy.available(buildSettingsCategoryCapabilities({}, { usageData: true }))).toBe(
      true,
    );
  });
});
