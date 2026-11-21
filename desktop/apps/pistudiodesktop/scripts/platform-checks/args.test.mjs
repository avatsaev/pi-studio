import { describe, expect, it } from "vitest";

import { parseOptions } from "./args.mjs";

describe("parseOptions", () => {
  it("parses a macOS run", () => {
    const options = parseOptions(["macos", "--app", "a", "--cli-entry", "c.js", "--fake-cli", "f.sh", "--shells", "bash"], "darwin");
    expect(options).toMatchObject({ mode: "macos", app: "a", shells: ["bash"], quit: "applescript", out: "platform-checks-out" });
  });

  it("defaults the quit to SIGTERM off macOS", () => {
    expect(parseOptions(["windows", "--app", "a.exe"], "win32").quit).toBe("sigterm");
  });

  it("needs a known mode, --app, and the mode's own options", () => {
    expect(() => parseOptions([], "linux")).toThrow("the mode is one of");
    expect(() => parseOptions(["macos"], "darwin")).toThrow("--app is required");
    expect(() => parseOptions(["macos", "--app", "a"], "darwin")).toThrow("--cli-entry");
    expect(() => parseOptions(["macos", "--app", "a", "--cli-entry", "c", "--fake-cli", "f", "--shells", "fish"], "darwin")).toThrow("zsh and bash");
    expect(() => parseOptions(["rehearse-webdriver", "--app", "a"], "linux")).toThrow("--webdriver-url");
    expect(() => parseOptions(["windows", "--app", "a", "--quit", "now"], "win32")).toThrow("--quit");
  });
});
