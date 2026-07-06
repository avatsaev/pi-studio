import { describe, it, expect } from "vitest";
import { gitStatusToDiffFiles, fileChangeBadge } from "./git-panel.js";

describe("gitStatusToDiffFiles", () => {
  it("maps a live git status into changed-file entries with derived change status", () => {
    const files = gitStatusToDiffFiles({
      staged: ["src/a.ts"],
      unstaged: ["src/b.ts"],
      untracked: ["new.txt"],
      conflicts: ["merge.ts"],
    });
    const byPath = Object.fromEntries(files.map((f) => [f.path, f]));
    expect(byPath["src/a.ts"]?.changeStatus).toBe("modified");
    expect(byPath["src/b.ts"]?.changeStatus).toBe("modified");
    expect(byPath["new.txt"]?.changeStatus).toBe("untracked");
    expect(byPath["new.txt"]?.isNew).toBe(true);
    expect(byPath["merge.ts"]?.changeStatus).toBe("conflict");
  });

  it("derives baseName + dirName", () => {
    const [f] = gitStatusToDiffFiles({ unstaged: ["packages/app/src/x.ts"] });
    expect(f?.baseName).toBe("x.ts");
    expect(f?.dirName).toBe("packages/app/src");
  });

  it("conflict takes precedence over other states for the same path", () => {
    const files = gitStatusToDiffFiles({ staged: ["x"], conflicts: ["x"] });
    expect(files).toHaveLength(1);
    expect(files[0]?.changeStatus).toBe("conflict");
  });

  it("sorts entries by path and handles empty input", () => {
    expect(gitStatusToDiffFiles({})).toEqual([]);
    const files = gitStatusToDiffFiles({ unstaged: ["b", "a"] });
    expect(files.map((f) => f.path)).toEqual(["a", "b"]);
  });
});

describe("fileChangeBadge", () => {
  it("returns single-letter badges", () => {
    expect(fileChangeBadge("added")).toBe("A");
    expect(fileChangeBadge("modified")).toBe("M");
    expect(fileChangeBadge("deleted")).toBe("D");
    expect(fileChangeBadge("untracked")).toBe("U");
    expect(fileChangeBadge("conflict")).toBe("C");
    expect(fileChangeBadge(undefined)).toBe("•");
  });
});
