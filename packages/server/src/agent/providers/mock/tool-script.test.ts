import { describe, expect, it } from "vitest";

import {
  getToolScriptHelpText,
  parseToolScript,
  TOOL_SCRIPT_RECIPES,
  toolScriptEvents,
} from "./tool-script.js";

describe("parseToolScript", () => {
  it("returns null for an ordinary prompt or a later mention", () => {
    expect(parseToolScript("hello")).toBeNull();
    expect(parseToolScript("explain #tool please")).toBeNull();
    expect(parseToolScript("#toolbox")).toBeNull();
  });

  it("treats a bare #tool as shell and an unknown recipe as help", () => {
    expect(parseToolScript("#tool")).toBe("shell");
    expect(parseToolScript("#tool banana")).toBe("help");
  });

  it("parses every documented recipe, with a case-insensitive sentinel", () => {
    for (const recipe of TOOL_SCRIPT_RECIPES) {
      expect(parseToolScript(`#tool ${recipe}`)).toBe(recipe);
    }
    expect(parseToolScript("#TOOL empty")).toBe("empty");
  });

  it("help text names every recipe", () => {
    for (const recipe of TOOL_SCRIPT_RECIPES) {
      expect(getToolScriptHelpText()).toContain(`#tool ${recipe}`);
    }
  });
});

describe("toolScriptEvents", () => {
  it("shell: start, 3 accumulating partials, completed with the full output", () => {
    const events = toolScriptEvents("shell", "c1");
    expect(events).toHaveLength(5);
    expect(events.every((e) => e.kind === "tool_call" && e.callId === "c1")).toBe(true);
    const outputs = events.flatMap((e) =>
      e.kind === "tool_call" && e.partial
        ? [e.tool.kind === "shell" ? e.tool.output : undefined]
        : [],
    );
    expect(outputs).toHaveLength(3);
    expect(outputs[1]!.startsWith(outputs[0]!)).toBe(true);
    expect(outputs[2]!.startsWith(outputs[1]!)).toBe(true);
  });
});
