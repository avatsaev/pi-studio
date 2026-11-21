import { describe, expect, it } from "vitest";
import { resolveRenameTitle } from "./rename-title.js";

describe("resolveRenameTitle", () => {
  it("returns the trimmed title for a changed input", () => {
    expect(resolveRenameTitle("  New name  ", "Old name")).toBe("New name");
  });

  it("returns nothing for a blank or whitespace-only input", () => {
    expect(resolveRenameTitle("", "Old name")).toBeNull();
    expect(resolveRenameTitle(" \t ", "Old name")).toBeNull();
  });

  it("returns nothing for an unchanged input, padded or not", () => {
    expect(resolveRenameTitle("Old name", "Old name")).toBeNull();
    expect(resolveRenameTitle("  Old name ", "Old name")).toBeNull();
  });
});
