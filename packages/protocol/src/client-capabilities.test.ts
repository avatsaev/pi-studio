import { describe, expect, it } from "vitest";

import {
  CLIENT_CAPS,
  SERVER_FEATURE_COMPAT,
  SERVER_FEATURES,
  supports,
} from "./client-capabilities.js";

describe("capability flag sets", () => {
  it("exports CLIENT_CAPS keys", () => {
    expect(CLIENT_CAPS.custom_mode_icons).toBe("custom_mode_icons");
    expect(CLIENT_CAPS.reasoning_merge_enum).toBe("reasoning_merge_enum");
    expect(CLIENT_CAPS.terminal_reflowable_snapshot).toBe("terminal_reflowable_snapshot");
  });

  it("exports SERVER_FEATURES keys", () => {
    expect(Object.keys(SERVER_FEATURES).sort()).toEqual(
      [
        "checkoutGithubSetAutoMerge",
        "checkoutRefresh",
        "daemonStatusRpc",
        "providersSnapshot",
        "rewind",
        "terminal-restore-modes",
      ].sort(),
    );
  });

  it("annotates every server feature with a COMPAT tag", () => {
    for (const key of Object.keys(SERVER_FEATURES) as (keyof typeof SERVER_FEATURES)[]) {
      const tag = SERVER_FEATURE_COMPAT[key];
      expect(tag.name).toBe(key);
      expect(typeof tag.addedIn).toBe("string");
      expect(typeof tag.removeBy).toBe("string");
    }
  });
});

describe("supports(caps, flag)", () => {
  it("returns true only for advertised flags (record form)", () => {
    const caps = { custom_mode_icons: true, reasoning_merge_enum: false };
    expect(supports(caps, CLIENT_CAPS.custom_mode_icons)).toBe(true);
    expect(supports(caps, CLIENT_CAPS.reasoning_merge_enum)).toBe(false);
    expect(supports(caps, CLIENT_CAPS.terminal_reflowable_snapshot)).toBe(false);
  });

  it("supports array and Set capability forms", () => {
    expect(supports(["custom_mode_icons"], "custom_mode_icons")).toBe(true);
    expect(supports(["custom_mode_icons"], "rewind")).toBe(false);
    expect(supports(new Set(["rewind"]), "rewind")).toBe(true);
    expect(supports(new Set(["rewind"]), "custom_mode_icons")).toBe(false);
  });

  it("returns false when no capabilities are advertised", () => {
    expect(supports(undefined, "custom_mode_icons")).toBe(false);
    expect(supports({}, "custom_mode_icons")).toBe(false);
  });
});
