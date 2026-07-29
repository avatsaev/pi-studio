import { homedir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { expandHome } from "./resolve-path.js";

describe("expandHome", () => {
  it("expands a bare ~ to the home directory", () => {
    expect(expandHome("~")).toBe(homedir());
  });

  it("expands a ~/-prefixed path against the home directory", () => {
    expect(expandHome("~/x")).toBe(join(homedir(), "x"));
  });

  it("leaves ~otheruser/x unexpanded (not rewritten to $HOME/otheruser/x)", () => {
    expect(expandHome("~otheruser/x")).toBe("~otheruser/x");
  });

  it("leaves an absolute path as-is", () => {
    expect(expandHome("/abs/path")).toBe("/abs/path");
  });

  it("leaves a relative path as-is", () => {
    expect(expandHome("rel/path")).toBe("rel/path");
  });

  it("leaves an empty path as-is", () => {
    expect(expandHome("")).toBe("");
  });
});
