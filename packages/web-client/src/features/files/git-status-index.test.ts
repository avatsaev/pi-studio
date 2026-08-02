import { describe, expect, it } from "vitest";
import { buildGitStatusLookup, buildIgnoredMatcher } from "./git-status-index.js";
import type { ChangeEntry } from "@pi-studio-ui/stores/git-store.js";

function modified(path: string): ChangeEntry {
  return { path, status: "modified", staged: false };
}
function added(path: string): ChangeEntry {
  return { path, status: "added", staged: false };
}
function deleted(path: string): ChangeEntry {
  return { path, status: "deleted", staged: true };
}

describe("buildGitStatusLookup", () => {
  it("joins the workspace-relative change path onto the absolute tree root", () => {
    const lookup = buildGitStatusLookup("/home/dev/proj", [modified("src/index.ts")]);
    expect(lookup("/home/dev/proj/src/index.ts")).toBe("modified");
    expect(lookup("src/index.ts")).toBeUndefined();
  });

  it("returns undefined for clean paths and for anything outside the root", () => {
    const lookup = buildGitStatusLookup("/proj", [modified("a.txt")]);
    expect(lookup("/proj/b.txt")).toBeUndefined();
    expect(lookup("/elsewhere/a.txt")).toBeUndefined();
  });

  it("propagates a change to every ancestor directory, however deep", () => {
    const lookup = buildGitStatusLookup("/proj", [modified("src/deep/nested/file.ts")]);
    expect(lookup("/proj/src/deep/nested")).toBe("modified");
    expect(lookup("/proj/src/deep")).toBe("modified");
    expect(lookup("/proj/src")).toBe("modified");
  });

  it("keeps a directory green only while everything beneath it is new", () => {
    const allNew = buildGitStatusLookup("/proj", [added("src/a.ts"), added("src/b.ts")]);
    expect(allNew("/proj/src")).toBe("added");

    const mixed = buildGitStatusLookup("/proj", [added("src/a.ts"), modified("src/b.ts")]);
    expect(mixed("/proj/src")).toBe("modified");
  });

  it("rolls a deletion up as a modification — the folder changed, it was not added", () => {
    const lookup = buildGitStatusLookup("/proj", [deleted("src/gone.ts")]);
    expect(lookup("/proj/src/gone.ts")).toBe("deleted");
    expect(lookup("/proj/src")).toBe("modified");
  });

  it('prefers "added" over "modified" for a file git reports as both (AM)', () => {
    const lookup = buildGitStatusLookup("/proj", [
      { path: "new.ts", status: "added", staged: true },
      { path: "new.ts", status: "modified", staged: false },
    ]);
    expect(lookup("/proj/new.ts")).toBe("added");
  });

  it("marks descendants of a collapsed untracked directory entry as added", () => {
    // porcelain v2 with the default -unormal emits "sub/" instead of listing its files.
    const lookup = buildGitStatusLookup("/proj", [added("src/sub/")]);
    expect(lookup("/proj/src/sub")).toBe("added");
    expect(lookup("/proj/src/sub/deep/file.ts")).toBe("added");
    expect(lookup("/proj/src")).toBe("added");
    expect(lookup("/proj/src/subtle.ts")).toBeUndefined();
  });

  it("does not double the separator when the root is / or has a trailing slash", () => {
    expect(buildGitStatusLookup("/", [modified("a.txt")])("/a.txt")).toBe("modified");
    expect(buildGitStatusLookup("/proj/", [modified("src/a.txt")])("/proj/src/a.txt")).toBe(
      "modified",
    );
  });

  it("never reports a status for the root itself", () => {
    const lookup = buildGitStatusLookup("/proj", [modified("src/a.ts")]);
    expect(lookup("/proj")).toBeUndefined();
  });

  it("returns an empty lookup with no root or no changes", () => {
    expect(buildGitStatusLookup("", [modified("a.txt")])("/proj/a.txt")).toBeUndefined();
    expect(buildGitStatusLookup("/proj", [])("/proj/a.txt")).toBeUndefined();
  });
});

describe("buildIgnoredMatcher", () => {
  it("matches an ignored file exactly, joined onto the tree root", () => {
    const isIgnored = buildIgnoredMatcher("/proj", [".env"]);
    expect(isIgnored("/proj/.env")).toBe(true);
    expect(isIgnored("/proj/.env.example")).toBe(false);
    expect(isIgnored("/other/.env")).toBe(false);
  });

  it("claims everything beneath a collapsed ignored directory", () => {
    // git stops walking an ignored directory, so `node_modules/` is all we get for the subtree.
    const isIgnored = buildIgnoredMatcher("/proj", ["node_modules/"]);
    expect(isIgnored("/proj/node_modules")).toBe(true);
    expect(isIgnored("/proj/node_modules/react/index.js")).toBe(true);
    expect(isIgnored("/proj/node_modules_notreally")).toBe(false);
    expect(isIgnored("/proj/src/index.ts")).toBe(false);
  });

  it("handles nested ignored directories and a / root", () => {
    const isIgnored = buildIgnoredMatcher("/proj", ["packages/web-client/dist/"]);
    expect(isIgnored("/proj/packages/web-client/dist/assets/app.js")).toBe(true);
    expect(isIgnored("/proj/packages/web-client/src")).toBe(false);
    expect(buildIgnoredMatcher("/", ["tmp/"])("/tmp/x")).toBe(true);
  });

  it("matches nothing without a root or an ignore list", () => {
    expect(buildIgnoredMatcher("", ["node_modules/"])("/proj/node_modules")).toBe(false);
    expect(buildIgnoredMatcher("/proj", [])("/proj/node_modules")).toBe(false);
  });
});
