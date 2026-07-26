import { describe, expect, it } from "vitest";

import {
  applyCommand,
  commandOptions,
  knownCommandSpan,
  moveHighlight,
  parseSlashToken,
  shouldOpenMenu,
} from "./slash-commands.js";

describe("parseSlashToken", () => {
  it("returns null for text with no leading slash", () => {
    expect(parseSlashToken("")).toBeNull();
    expect(parseSlashToken("hi")).toBeNull();
  });

  it("parses a bare slash as an empty-name token", () => {
    expect(parseSlashToken("/")).toEqual({ name: "", end: 1, hasArgs: false });
  });

  it("parses a plain command name with no trailing space", () => {
    expect(parseSlashToken("/fix")).toEqual({ name: "fix", end: 4, hasArgs: false });
  });

  it("treats a trailing space with no content as having no args", () => {
    expect(parseSlashToken("/fix ")).toEqual({ name: "fix", end: 4, hasArgs: false });
  });

  it("detects args after the token", () => {
    expect(parseSlashToken("/fix a b")).toEqual({ name: "fix", end: 4, hasArgs: true });
  });

  it("handles a colon-namespaced skill command name", () => {
    expect(parseSlashToken("/skill:brave-search x")).toEqual({
      name: "skill:brave-search",
      end: 19,
      hasArgs: true,
    });
  });
});

describe("shouldOpenMenu", () => {
  it("is true while only a command name is being typed", () => {
    expect(shouldOpenMenu("/")).toBe(true);
    expect(shouldOpenMenu("/fi")).toBe(true);
  });

  it("is false once the draft has content beyond a bare command token", () => {
    expect(shouldOpenMenu("")).toBe(false);
    expect(shouldOpenMenu("/fi ")).toBe(false);
    expect(shouldOpenMenu("hi /fi")).toBe(false);
  });
});

describe("commandOptions", () => {
  const commands = [
    { name: "session-name", description: "Set or clear session name", source: "extension" },
    { name: "fix-tests", description: "Fix failing tests", source: "prompt" },
    { name: "skill:brave-search", description: "Web search via Brave API", source: "skill" },
  ];

  it("maps name/description/source to label/description/kind, preserving order", () => {
    const { options, hiddenExtensionCount } = commandOptions(commands, { running: false });
    expect(options).toEqual([
      {
        value: "session-name",
        label: "/session-name",
        description: "Set or clear session name",
        kind: "extension",
      },
      { value: "fix-tests", label: "/fix-tests", description: "Fix failing tests", kind: "prompt" },
      {
        value: "skill:brave-search",
        label: "/skill:brave-search",
        description: "Web search via Brave API",
        kind: "skill",
      },
    ]);
    expect(hiddenExtensionCount).toBe(0);
  });

  it("hides extension-sourced commands while running and reports how many", () => {
    const { options, hiddenExtensionCount } = commandOptions(commands, { running: true });
    expect(options.map((o) => o.value)).toEqual(["fix-tests", "skill:brave-search"]);
    expect(hiddenExtensionCount).toBe(1);
  });
});

describe("moveHighlight", () => {
  it("wraps forward past the end of the list", () => {
    expect(moveHighlight(2, 1, 3)).toBe(0);
  });

  it("wraps backward past the start of the list", () => {
    expect(moveHighlight(0, -1, 3)).toBe(2);
  });

  it("returns 0 for an empty list", () => {
    expect(moveHighlight(0, 1, 0)).toBe(0);
    expect(moveHighlight(5, -1, 0)).toBe(0);
  });
});

describe("applyCommand", () => {
  it("fills an empty draft with the command and a trailing space", () => {
    expect(applyCommand("", "fix-tests")).toBe("/fix-tests ");
  });

  it("replaces a partial token and adds a trailing space", () => {
    expect(applyCommand("/fi", "fix-tests")).toBe("/fix-tests ");
  });

  it("preserves args exactly when the token already has them", () => {
    expect(applyCommand("/fi src/foo.ts extra", "fix-tests")).toBe("/fix-tests src/foo.ts extra");
  });

  it("prefixes the command onto a draft with no leading slash", () => {
    expect(applyCommand("hello", "fix-tests")).toBe("/fix-tests hello");
  });
});

describe("knownCommandSpan", () => {
  const names = ["fix-tests", "session-name"];

  it("returns the token span for an exact match", () => {
    expect(knownCommandSpan("/fix-tests", names)).toEqual({ end: 10 });
  });

  it("returns null on a case mismatch", () => {
    expect(knownCommandSpan("/Fix-Tests", names)).toBeNull();
  });

  it("returns null for an unknown command name", () => {
    expect(knownCommandSpan("/nope", names)).toBeNull();
  });

  it("tolerates trailing args after a matched name", () => {
    expect(knownCommandSpan("/fix-tests src/foo.ts", names)).toEqual({ end: 10 });
  });
});
