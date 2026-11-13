import { describe, expect, it } from "vitest";

import {
  getStreamScriptHelpText,
  parseStreamScript,
  STREAM_SCRIPT_RECIPES,
  streamScriptEvents,
} from "./stream-script.js";

describe("parseStreamScript", () => {
  it("returns null for an ordinary prompt or a later mention", () => {
    expect(parseStreamScript("hello")).toBeNull();
    expect(parseStreamScript("explain #stream please")).toBeNull();
    expect(parseStreamScript("#streams")).toBeNull();
  });

  it("treats a bare #stream and an unknown recipe as help", () => {
    expect(parseStreamScript("#stream")).toBe("help");
    expect(parseStreamScript("#stream banana")).toBe("help");
  });

  it("parses every documented recipe, with a case-insensitive sentinel", () => {
    for (const recipe of STREAM_SCRIPT_RECIPES) {
      expect(parseStreamScript(`#stream ${recipe}`)).toBe(recipe);
    }
    expect(parseStreamScript("#STREAM fail")).toBe("fail");
  });

  it("help text names every recipe", () => {
    for (const recipe of STREAM_SCRIPT_RECIPES) {
      expect(getStreamScriptHelpText()).toContain(`#stream ${recipe}`);
    }
  });
});

describe("streamScriptEvents", () => {
  it("every recipe ends on a terminal turn event", () => {
    for (const recipe of ["reasoning", "fail", "error"] as const) {
      const events = streamScriptEvents(recipe, "t1", "m1");
      const last = events.at(-1);
      expect(last?.kind === "turn_completed" || last?.kind === "turn_failed").toBe(true);
    }
  });

  it("error emits an error event before turn_failed", () => {
    expect(streamScriptEvents("error", "t1", "m1").map((e) => e.kind)).toEqual([
      "error",
      "turn_failed",
    ]);
  });
});
