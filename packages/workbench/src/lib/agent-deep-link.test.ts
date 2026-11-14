import { describe, expect, it } from "vitest";
import { parseAgentDeepLink, stripAgentParam } from "./agent-deep-link.js";

describe("parseAgentDeepLink", () => {
  it("reads and decodes the agent key", () => {
    expect(parseAgentDeepLink("#agent=abc")).toBe("abc");
    expect(parseAgentDeepLink("#agent=a%20b%2Bc")).toBe("a b+c");
  });
  it("coexists with pairing keys in either order", () => {
    expect(parseAgentDeepLink("#offer=XYZ&agent=abc")).toBe("abc");
    expect(parseAgentDeepLink("#agent=abc&offer=XYZ&host=h")).toBe("abc");
  });
  it("ignores empty, absent and over-long values", () => {
    expect(parseAgentDeepLink("#agent=")).toBeUndefined();
    expect(parseAgentDeepLink("")).toBeUndefined();
    expect(parseAgentDeepLink("#agent=" + "a".repeat(257))).toBeUndefined();
    expect(parseAgentDeepLink("#agent=" + "a".repeat(256))).toBe("a".repeat(256));
  });
});

describe("stripAgentParam", () => {
  it("removes agent and keeps sibling fragment keys and the query", () => {
    expect(stripAgentParam("https://x/?host=ws%3A%2F%2Fh&connect=1#offer=XYZ&agent=abc")).toBe(
      "https://x/?host=ws%3A%2F%2Fh&connect=1#offer=XYZ",
    );
    expect(stripAgentParam("https://x/#agent=abc&offer=XYZ")).toBe("https://x/#offer=XYZ");
  });
  it("drops the # when the fragment empties", () => {
    expect(stripAgentParam("https://x/?a=1#agent=abc")).toBe("https://x/?a=1");
  });
  it("leaves a URL without agent unchanged", () => {
    expect(stripAgentParam("https://x/?a=1#offer=XYZ")).toBe("https://x/?a=1#offer=XYZ");
    expect(stripAgentParam("https://x/")).toBe("https://x/");
  });
});
