import { describe, it, expect } from "vitest";
import {
  parseProviderList,
  resolveInitialSelection,
  modeOptionsFor,
  withSelectionPreference,
  FALLBACK_PROVIDERS,
} from "./provider-picker.js";

const SAMPLE = {
  type: "list_providers_response",
  providers: [
    {
      id: "pi",
      label: "Pi",
      modes: [
        { id: "plan", label: "Plan" },
        { id: "default", label: "Default" },
      ],
    },
    { id: "my-fork", label: "My Fork", extends: "pi", modes: [{ id: "default", label: "Default" }] },
  ],
};

describe("parseProviderList", () => {
  it("parses providers, marks profiles, and appends mock when missing", () => {
    const opts = parseProviderList(SAMPLE);
    expect(opts.map((o) => o.id)).toEqual(["pi", "my-fork", "mock"]);
    expect(opts.find((o) => o.id === "my-fork")?.isProfile).toBe(true);
    expect(opts.find((o) => o.id === "pi")?.isProfile).toBe(false);
    expect(opts.find((o) => o.id === "pi")?.modes).toHaveLength(2);
  });

  it("falls back to the default provider list on empty/garbage input", () => {
    expect(parseProviderList(undefined)).toEqual(FALLBACK_PROVIDERS);
    expect(parseProviderList({})).toEqual(FALLBACK_PROVIDERS);
    expect(parseProviderList({ providers: "nope" })).toEqual(FALLBACK_PROVIDERS);
  });

  it("does not duplicate mock when the daemon already provides it", () => {
    const opts = parseProviderList({ providers: [{ id: "mock", label: "Mock", modes: [] }] });
    expect(opts.filter((o) => o.id === "mock")).toHaveLength(1);
  });
});

describe("resolveInitialSelection", () => {
  const opts = parseProviderList(SAMPLE);

  it("uses last-used preference when still available", () => {
    const sel = resolveInitialSelection(opts, {
      provider: "pi",
      providerPreferences: { pi: { mode: "default" } },
    });
    expect(sel).toEqual({ provider: "pi", modeId: "default" });
  });

  it("falls back to the first provider + first mode when no/invalid preference", () => {
    expect(resolveInitialSelection(opts, undefined)).toEqual({ provider: "pi", modeId: "plan" });
    expect(resolveInitialSelection(opts, { provider: "ghost" })).toEqual({ provider: "pi", modeId: "plan" });
  });

  it("degrades to mock when there are no options", () => {
    expect(resolveInitialSelection([], undefined)).toEqual({ provider: "mock" });
  });
});

describe("modeOptionsFor", () => {
  const opts = parseProviderList(SAMPLE);
  it("returns modes for a known provider and empty for unknown", () => {
    expect(modeOptionsFor(opts, "pi").map((m) => m.id)).toEqual(["plan", "default"]);
    expect(modeOptionsFor(opts, "ghost")).toEqual([]);
  });
});

describe("withSelectionPreference", () => {
  it("stores the last-used provider and per-provider mode", () => {
    const next = withSelectionPreference(undefined, { provider: "pi", modeId: "plan" });
    expect(next.provider).toBe("pi");
    expect(next.providerPreferences?.pi?.mode).toBe("plan");
  });

  it("preserves other providers' preferences", () => {
    const prev = { provider: "mock", providerPreferences: { mock: { mode: "default" } } };
    const next = withSelectionPreference(prev, { provider: "pi", modeId: "default" });
    expect(next.providerPreferences?.mock?.mode).toBe("default");
    expect(next.providerPreferences?.pi?.mode).toBe("default");
    expect(next.provider).toBe("pi");
  });
});
