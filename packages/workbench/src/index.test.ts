import { describe, expect, it } from "vitest";
import { WORKBENCH_PACKAGE_NAME } from "./index.js";
import pkg from "../package.json" with { type: "json" };

describe("workbench entry", () => {
  it("names the package it is published as", () => {
    expect(WORKBENCH_PACKAGE_NAME).toBe(pkg.name);
  });
});
