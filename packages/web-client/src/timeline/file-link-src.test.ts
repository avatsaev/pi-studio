import { describe, expect, it } from "vitest";
import { classifyFileLinkSrc } from "./file-link-src.js";

describe("classifyFileLinkSrc", () => {
  describe("empty/whitespace hrefs", () => {
    it("classifies empty href as external", () => {
      expect(classifyFileLinkSrc("", "/repo", "/home/bob")).toEqual({ kind: "external" });
    });

    it("classifies whitespace-only href as external", () => {
      expect(classifyFileLinkSrc("   ", "/repo", "/home/bob")).toEqual({ kind: "external" });
    });
  });

  describe("fragment-only hrefs", () => {
    it("classifies fragment-only href as external (in-page anchor)", () => {
      expect(classifyFileLinkSrc("#section", "/repo", "/home/bob")).toEqual({
        kind: "external",
      });
    });

    it("classifies empty fragment as external", () => {
      expect(classifyFileLinkSrc("#", "/repo", "/home/bob")).toEqual({ kind: "external" });
    });
  });

  describe("hrefs with fragments (path + fragment)", () => {
    it("strips fragment and resolves path", () => {
      expect(classifyFileLinkSrc("README.md#usage", "/repo", "/home/bob")).toEqual({
        kind: "local",
        path: "/repo/README.md",
      });
    });

    it("normalizes path after stripping fragment", () => {
      expect(classifyFileLinkSrc("./notes.md#section", "/repo", "/home/bob")).toEqual({
        kind: "local",
        path: "/repo/notes.md",
      });
    });

    it("handles absolute path with fragment", () => {
      expect(classifyFileLinkSrc("/etc/hosts#line10", null, "/home/bob")).toEqual({
        kind: "local",
        path: "/etc/hosts",
      });
    });

    it("handles tilde path with fragment", () => {
      expect(classifyFileLinkSrc("~/.bashrc#prompt", null, "/home/bob")).toEqual({
        kind: "local",
        path: "/home/bob/.bashrc",
      });
    });
  });

  describe("explicit schemes", () => {
    it("classifies http: as external", () => {
      expect(classifyFileLinkSrc("http://example.com/file.md", "/repo", "/home/bob")).toEqual({
        kind: "external",
      });
    });

    it("classifies https: as external", () => {
      expect(classifyFileLinkSrc("https://example.com/file.md", "/repo", "/home/bob")).toEqual({
        kind: "external",
      });
    });

    it("classifies file: as external", () => {
      expect(classifyFileLinkSrc("file:///etc/hosts", "/repo", "/home/bob")).toEqual({
        kind: "external",
      });
    });

    it("classifies mailto: as external", () => {
      expect(classifyFileLinkSrc("mailto:user@example.com", "/repo", "/home/bob")).toEqual({
        kind: "external",
      });
    });

    it("classifies tel: as external", () => {
      expect(classifyFileLinkSrc("tel:+1234567890", "/repo", "/home/bob")).toEqual({
        kind: "external",
      });
    });

    it("classifies ftp: as external", () => {
      expect(classifyFileLinkSrc("ftp://example.com/file", "/repo", "/home/bob")).toEqual({
        kind: "external",
      });
    });
  });

  describe("absolute paths (/ prefix)", () => {
    it("classifies absolute path as local", () => {
      expect(classifyFileLinkSrc("/repo/notes.md", null, "/home/bob")).toEqual({
        kind: "local",
        path: "/repo/notes.md",
      });
    });

    it("normalizes absolute path with . segments", () => {
      expect(classifyFileLinkSrc("/repo/./notes.md", null, "/home/bob")).toEqual({
        kind: "local",
        path: "/repo/notes.md",
      });
    });

    it("normalizes absolute path with .. segments", () => {
      expect(classifyFileLinkSrc("/repo/sub/../notes.md", null, "/home/bob")).toEqual({
        kind: "local",
        path: "/repo/notes.md",
      });
    });

    it("classifies directory as local (no extension gate)", () => {
      expect(classifyFileLinkSrc("/repo/subdir", null, "/home/bob")).toEqual({
        kind: "local",
        path: "/repo/subdir",
      });
    });
  });

  describe("tilde paths (~ prefix)", () => {
    it("expands tilde with known home dir", () => {
      expect(classifyFileLinkSrc("~/notes.md", "/repo", "/home/bob")).toEqual({
        kind: "local",
        path: "/home/bob/notes.md",
      });
    });

    it("expands bare tilde to home dir", () => {
      expect(classifyFileLinkSrc("~", "/repo", "/home/bob")).toEqual({
        kind: "local",
        path: "/home/bob",
      });
    });

    it("classifies tilde path as external when home dir unknown", () => {
      expect(classifyFileLinkSrc("~/notes.md", "/repo", null)).toEqual({
        kind: "external",
      });
    });

    it("normalizes tilde path after expansion", () => {
      expect(classifyFileLinkSrc("~/../bob/notes.md", null, "/home/alice")).toEqual({
        kind: "local",
        path: "/home/bob/notes.md",
      });
    });
  });

  describe("relative paths (./ and ../ prefix)", () => {
    it("resolves ./ relative to base", () => {
      expect(classifyFileLinkSrc("./notes.md", "/repo", "/home/bob")).toEqual({
        kind: "local",
        path: "/repo/notes.md",
      });
    });

    it("resolves ../ relative to base", () => {
      expect(classifyFileLinkSrc("../notes.md", "/repo/sub", "/home/bob")).toEqual({
        kind: "local",
        path: "/repo/notes.md",
      });
    });

    it("normalizes complex relative paths", () => {
      expect(classifyFileLinkSrc("../x/../notes.md", "/repo/a", null)).toEqual({
        kind: "local",
        path: "/repo/notes.md",
      });
    });

    it("classifies relative path as external with no base", () => {
      expect(classifyFileLinkSrc("./notes.md", null, "/home/bob")).toEqual({
        kind: "external",
      });
    });

    it("classifies bare relative path as external with no base", () => {
      expect(classifyFileLinkSrc("notes.md", null, "/home/bob")).toEqual({
        kind: "external",
      });
    });
  });

  describe("bare relative paths (no ./ or ../ prefix)", () => {
    it("resolves bare relative path to base", () => {
      expect(classifyFileLinkSrc("notes.md", "/repo", "/home/bob")).toEqual({
        kind: "local",
        path: "/repo/notes.md",
      });
    });

    it("treats bare relative as external when no base", () => {
      expect(classifyFileLinkSrc("notes.md", null, "/home/bob")).toEqual({
        kind: "external",
      });
    });
  });

  describe("percent-decoding", () => {
    it("percent-decodes spaces in filenames", () => {
      expect(classifyFileLinkSrc("my%20notes.md", "/repo", null)).toEqual({
        kind: "local",
        path: "/repo/my notes.md",
      });
    });

    it("percent-decodes in relative paths", () => {
      expect(classifyFileLinkSrc("./my%20file.md", "/repo", null)).toEqual({
        kind: "local",
        path: "/repo/my file.md",
      });
    });

    it("keeps malformed percent sequences unchanged", () => {
      expect(classifyFileLinkSrc("my%E0%notes.md", "/repo", null)).toEqual({
        kind: "local",
        path: "/repo/my%E0%notes.md",
      });
    });
  });

  describe("normalization + percent-decoding combined", () => {
    it("normalizes and percent-decodes together", () => {
      expect(classifyFileLinkSrc("./my%20notes.md", "/repo", null)).toEqual({
        kind: "local",
        path: "/repo/my notes.md",
      });
    });

    it("normalizes .. and decodes in same path", () => {
      expect(classifyFileLinkSrc("../my%20file.md", "/repo/sub", null)).toEqual({
        kind: "local",
        path: "/repo/my file.md",
      });
    });

    it("acceptance: ./notes.md with normalization", () => {
      expect(classifyFileLinkSrc("./notes.md", "/repo", null)).toEqual({
        kind: "local",
        path: "/repo/notes.md",
      });
    });

    it("acceptance: ../x/../notes.md with normalization", () => {
      expect(classifyFileLinkSrc("../x/../notes.md", "/repo/a", null)).toEqual({
        kind: "local",
        path: "/repo/notes.md",
      });
    });

    it("acceptance: percent-decoding", () => {
      expect(classifyFileLinkSrc("my%20notes.md", "/repo", null)).toEqual({
        kind: "local",
        path: "/repo/my notes.md",
      });
    });
  });

  describe("query strings", () => {
    it("strips query string before classifying", () => {
      expect(classifyFileLinkSrc("notes.md?v=1", "/repo", null)).toEqual({
        kind: "local",
        path: "/repo/notes.md",
      });
    });

    it("strips query with multiple parameters", () => {
      expect(classifyFileLinkSrc("file.md?a=1&b=2", "/repo", null)).toEqual({
        kind: "local",
        path: "/repo/file.md",
      });
    });
  });

  describe("edge cases", () => {
    it("handles absolute path with multiple . and .. segments", () => {
      expect(classifyFileLinkSrc("/a/./b/../c/./d", null, null)).toEqual({
        kind: "local",
        path: "/a/c/d",
      });
    });

    it("handles leading ../ that goes above root", () => {
      expect(classifyFileLinkSrc("/../notes.md", null, null)).toEqual({
        kind: "local",
        path: "/notes.md",
      });
    });

    it("classifies directory target as local (no extension gate)", () => {
      expect(classifyFileLinkSrc("./subdir", "/repo", null)).toEqual({
        kind: "local",
        path: "/repo/subdir",
      });
    });

    it("classifies file without extension as local", () => {
      expect(classifyFileLinkSrc("Makefile", "/repo", null)).toEqual({
        kind: "local",
        path: "/repo/Makefile",
      });
    });
  });

  describe("state presence/absence", () => {
    it("handles null base with absolute path", () => {
      expect(classifyFileLinkSrc("/repo/notes.md", null, null)).toEqual({
        kind: "local",
        path: "/repo/notes.md",
      });
    });

    it("handles null homeDir with absolute path", () => {
      expect(classifyFileLinkSrc("/home/alice/notes.md", "/repo", null)).toEqual({
        kind: "local",
        path: "/home/alice/notes.md",
      });
    });

    it("handles both base and homeDir present", () => {
      expect(classifyFileLinkSrc("./notes.md", "/repo", "/home/bob")).toEqual({
        kind: "local",
        path: "/repo/notes.md",
      });
    });

    it("handles both base and homeDir absent for relative", () => {
      expect(classifyFileLinkSrc("./notes.md", null, null)).toEqual({
        kind: "external",
      });
    });
  });
});
