import { describe, expect, it } from "vitest";

import { identityOf, parseSource } from "./pi-source.js";

describe("parseSource", () => {
  it("detects pinned npm specs (exact version) vs unpinned", () => {
    expect(parseSource("npm:foo@1.2.3")).toEqual({ kind: "npm", identity: "foo", pinned: true });
    expect(parseSource("npm:foo")).toEqual({ kind: "npm", identity: "foo", pinned: false });
  });

  it("does not split a scoped package's leading @ as a version separator", () => {
    expect(parseSource("npm:@scope/foo")).toEqual({
      kind: "npm",
      identity: "@scope/foo",
      pinned: false,
    });
    expect(parseSource("npm:@scope/foo@1.2.3")).toEqual({
      kind: "npm",
      identity: "@scope/foo",
      pinned: true,
    });
  });

  it("detects pinned git specs (a ref) vs unpinned, scp-like form", () => {
    expect(parseSource("git:git@github.com:o/r@v1")).toEqual({
      kind: "git",
      identity: "git@github.com:o/r",
      pinned: true,
    });
    expect(parseSource("git:git@github.com:o/r")).toEqual({
      kind: "git",
      identity: "git@github.com:o/r",
      pinned: false,
    });
  });

  it("throws on a source with neither npm: nor git: scheme", () => {
    expect(() => parseSource("pi-web-access")).toThrow();
  });
});

describe("identityOf", () => {
  it("strips the version/ref, matching parseSource(...).identity", () => {
    expect(identityOf("npm:@scope/foo")).toBe("@scope/foo");
    expect(identityOf("npm:pi-web-access@1.0.0")).toBe("pi-web-access");
    expect(identityOf("git:git@github.com:o/r@main")).toBe("git@github.com:o/r");
  });
});
