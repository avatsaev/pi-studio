import { describe, expect, it } from "vitest";
import { classifyImageSrc } from "./image-src.js";

describe("classifyImageSrc", () => {
  it("classifies empty src as unresolvable", () => {
    expect(classifyImageSrc("", "/repo", "/home/bob")).toEqual({ kind: "unresolvable" });
  });

  it("classifies whitespace-only src as unresolvable", () => {
    expect(classifyImageSrc("   ", "/repo", "/home/bob")).toEqual({ kind: "unresolvable" });
  });

  it("classifies http: as remote", () => {
    expect(classifyImageSrc("http://example.com/a.png", "/repo", "/home/bob")).toEqual({
      kind: "remote",
    });
  });

  it("classifies https: as remote", () => {
    expect(classifyImageSrc("https://example.com/a.png", "/repo", "/home/bob")).toEqual({
      kind: "remote",
    });
  });

  it("classifies data: as remote", () => {
    expect(classifyImageSrc("data:image/png;base64,AAAA", "/repo", "/home/bob")).toEqual({
      kind: "remote",
    });
  });

  it("classifies blob: as remote", () => {
    expect(classifyImageSrc("blob:http://example.com/uuid", "/repo", "/home/bob")).toEqual({
      kind: "remote",
    });
  });

  it("classifies file: as unresolvable", () => {
    expect(classifyImageSrc("file:///etc/shot.png", "/repo", "/home/bob")).toEqual({
      kind: "unresolvable",
    });
  });

  it("classifies an arbitrary other scheme as unresolvable", () => {
    expect(classifyImageSrc("ftp://example.com/a.png", "/repo", "/home/bob")).toEqual({
      kind: "unresolvable",
    });
  });

  it("classifies an absolute path as local, used as-is", () => {
    expect(classifyImageSrc("/repo/shot.png", "/repo", "/home/bob")).toEqual({
      kind: "local",
      path: "/repo/shot.png",
    });
  });

  it("classifies an absolute path as local even with no asset base", () => {
    expect(classifyImageSrc("/repo/shot.png", null, "/home/bob")).toEqual({
      kind: "local",
      path: "/repo/shot.png",
    });
  });

  it("expands a bare ~ against the known home dir", () => {
    expect(classifyImageSrc("~", "/repo", "/home/bob")).toEqual({ kind: "unresolvable" }); // no extension
  });

  it("expands a ~/-prefixed path against the known home dir", () => {
    expect(classifyImageSrc("~/shot.png", "/repo", "/home/bob")).toEqual({
      kind: "local",
      path: "/home/bob/shot.png",
    });
  });

  it("classifies a ~-prefixed path as unresolvable when the home dir is unknown", () => {
    expect(classifyImageSrc("~/shot.png", "/repo", null)).toEqual({ kind: "unresolvable" });
  });

  it("resolves a ./-prefixed relative path against the asset base", () => {
    expect(classifyImageSrc("./shot.png", "/repo", "/home/bob")).toEqual({
      kind: "local",
      path: "/repo/./shot.png",
    });
  });

  it("resolves a ../-prefixed relative path against the asset base", () => {
    expect(classifyImageSrc("../shot.png", "/repo/sub", "/home/bob")).toEqual({
      kind: "local",
      path: "/repo/sub/../shot.png",
    });
  });

  it("resolves a bare relative path against the asset base", () => {
    expect(classifyImageSrc("shot.png", "/repo", "/home/bob")).toEqual({
      kind: "local",
      path: "/repo/shot.png",
    });
  });

  it("classifies a relative path as unresolvable with no asset base", () => {
    expect(classifyImageSrc("./shot.png", null, "/home/bob")).toEqual({ kind: "unresolvable" });
  });

  it("classifies a non-image extension as unresolvable, never attempting a download", () => {
    expect(classifyImageSrc("notes.pdf", "/repo", "/home/bob")).toEqual({ kind: "unresolvable" });
  });

  it("classifies an unknown/extension-less relative path as unresolvable", () => {
    expect(classifyImageSrc("README", "/repo", "/home/bob")).toEqual({ kind: "unresolvable" });
  });

  it("strips a trailing query string before classifying", () => {
    expect(classifyImageSrc("shot.png?v=2", "/repo", "/home/bob")).toEqual({
      kind: "local",
      path: "/repo/shot.png",
    });
  });

  it("strips a trailing fragment before classifying", () => {
    expect(classifyImageSrc("shot.png#frag", "/repo", "/home/bob")).toEqual({
      kind: "local",
      path: "/repo/shot.png",
    });
  });

  it("admits .webp as an image extension (viewer registry EXT_TO_VIEWER)", () => {
    expect(classifyImageSrc("shot.webp", "/repo", "/home/bob")).toEqual({
      kind: "local",
      path: "/repo/shot.webp",
    });
  });

  it("admits .svg as an image extension (viewer registry EXT_TO_VIEWER)", () => {
    expect(classifyImageSrc("shot.svg", "/repo", "/home/bob")).toEqual({
      kind: "local",
      path: "/repo/shot.svg",
    });
  });
});
