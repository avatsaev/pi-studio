import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileExplorerService } from "./file-explorer.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pi-studio-fe-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("FileExplorerService.listOrPreview", () => {
  it("lists a directory with entry kinds, sizes, and icon hints", async () => {
    await writeFile(join(dir, "a.ts"), "export const x = 1;\n");
    await writeFile(join(dir, "b.txt"), "hello");
    const svc = new FileExplorerService();
    const result = await svc.listOrPreview(dir);
    expect(result.ok).toBe(true);
    if (result.ok && result.kind === "directory") {
      const names = result.entries.map((e) => e.name);
      expect(names).toContain("a.ts");
      const tsEntry = result.entries.find((e) => e.name === "a.ts")!;
      expect(tsEntry.kind).toBe("file");
      expect(tsEntry.iconHint).toBe("ts");
      expect(tsEntry.size).toBeGreaterThan(0);
    }
  });

  it("previews a text file inline", async () => {
    await writeFile(join(dir, "note.md"), "# Title\nbody");
    const svc = new FileExplorerService();
    const result = await svc.listOrPreview(join(dir, "note.md"));
    expect(result.ok).toBe(true);
    if (result.ok && result.kind === "text") {
      expect(result.content).toBe("# Title\nbody");
      expect(result.truncated).toBe(false);
    } else {
      throw new Error("expected text preview");
    }
  });

  it("returns metadata + a transfer token for a binary file (no inline content)", async () => {
    // A file with a NUL byte is treated as binary.
    await writeFile(join(dir, "blob.bin"), Buffer.from([0x00, 0x01, 0x02, 0x99]));
    let issuedFor = "";
    const svc = new FileExplorerService({
      issueDownloadToken: (p) => {
        issuedFor = p;
        return "tok-123";
      },
    });
    const result = await svc.listOrPreview(join(dir, "blob.bin"));
    expect(result.ok).toBe(true);
    if (result.ok && result.kind === "binary") {
      expect(result.transferToken).toBe("tok-123");
      expect(result.metadata.size).toBe(4);
      expect(issuedFor).toBe(result.resolvedPath);
    } else {
      throw new Error("expected binary metadata");
    }
  });

  it("resolves symlinks server-side (normalization is on the daemon)", async () => {
    const real = join(dir, "real.txt");
    const link = join(dir, "link.txt");
    await writeFile(real, "linked content");
    await symlink(real, link);
    const svc = new FileExplorerService();
    const result = await svc.listOrPreview(link);
    expect(result.ok).toBe(true);
    if (result.ok && result.kind === "text") {
      expect(result.content).toBe("linked content");
      // The reported resolvedPath is the real target, not the symlink.
      expect(result.resolvedPath.endsWith("real.txt")).toBe(true);
    }
  });

  it("returns an error result for an unreadable / missing path", async () => {
    const svc = new FileExplorerService();
    const result = await svc.listOrPreview(join(dir, "does-not-exist"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("not_found");
  });
});

describe("FileExplorerService.deleteFile", () => {
  it("deletes a file", async () => {
    const target = join(dir, "gone.txt");
    await writeFile(target, "bye");
    const svc = new FileExplorerService();
    const result = await svc.deleteFile(target);
    expect(result.ok).toBe(true);
    await expect(stat(target)).rejects.toThrow();
  });

  it("deletes a directory recursively", async () => {
    const target = join(dir, "sub");
    await mkdir(target);
    await writeFile(join(target, "nested.txt"), "x");
    const svc = new FileExplorerService();
    const result = await svc.deleteFile(target);
    expect(result.ok).toBe(true);
    await expect(stat(target)).rejects.toThrow();
  });

  it("resolves symlinks before deleting (removes the real target)", async () => {
    const real = join(dir, "real2.txt");
    const link = join(dir, "link2.txt");
    await writeFile(real, "content");
    await symlink(real, link);
    const svc = new FileExplorerService();
    const result = await svc.deleteFile(link);
    expect(result.ok).toBe(true);
    await expect(stat(real)).rejects.toThrow();
  });

  it("returns not_found for a missing path", async () => {
    const svc = new FileExplorerService();
    const result = await svc.deleteFile(join(dir, "does-not-exist"));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("not_found");
  });

  it("returns empty_path for an empty path", async () => {
    const svc = new FileExplorerService();
    const result = await svc.deleteFile("");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("empty_path");
  });
});

describe("FileExplorerService.createEntry", () => {
  it("creates an empty file", async () => {
    const svc = new FileExplorerService();
    const result = await svc.createEntry(dir, "notes.txt", "file");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.kind).toBe("file");
    const info = await stat(result.path);
    expect(info.isFile()).toBe(true);
    expect(info.size).toBe(0);
  });

  it("creates a directory", async () => {
    const svc = new FileExplorerService();
    const result = await svc.createEntry(dir, "sub", "directory");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.kind).toBe("directory");
    const info = await stat(result.path);
    expect(info.isDirectory()).toBe(true);
  });

  it("returns exists for a colliding file name and leaves the existing content untouched", async () => {
    const target = join(dir, "keep.txt");
    await writeFile(target, "keep");
    const svc = new FileExplorerService();
    const result = await svc.createEntry(dir, "keep.txt", "file");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("exists");
    expect(await readFile(target, "utf8")).toBe("keep");
  });

  it("returns exists for a colliding directory name", async () => {
    await mkdir(join(dir, "existing"));
    const svc = new FileExplorerService();
    const result = await svc.createEntry(dir, "existing", "directory");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("exists");
  });

  it.each(["a/b", "", ".."])("returns invalid_name for %j", async (name) => {
    const svc = new FileExplorerService();
    const result = await svc.createEntry(dir, name, "file");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("invalid_name");
  });

  it("returns not_found for a missing parent", async () => {
    const svc = new FileExplorerService();
    const result = await svc.createEntry(join(dir, "does-not-exist"), "x.txt", "file");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("not_found");
  });

  it("returns not_a_directory when the parent is a regular file", async () => {
    const parent = join(dir, "not-a-dir.txt");
    await writeFile(parent, "x");
    const svc = new FileExplorerService();
    const result = await svc.createEntry(parent, "x.txt", "file");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("not_a_directory");
  });

  it("returns empty_path for an empty parent path", async () => {
    const svc = new FileExplorerService();
    const result = await svc.createEntry("", "x.txt", "file");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("empty_path");
  });
});

describe("FileExplorerService.writeFile", () => {
  it("overwrites an existing file's content atomically", async () => {
    const target = join(dir, "doc.md");
    await writeFile(target, "old content");
    const svc = new FileExplorerService();
    const result = await svc.writeFile(target, "new content");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.size).toBe(Buffer.byteLength("new content"));
    await expect(readFile(target, "utf8")).resolves.toBe("new content");
  });

  it("preserves the target's permission bits (an edited executable stays executable)", async () => {
    const target = join(dir, "run.sh");
    await writeFile(target, "#!/bin/sh\necho old\n");
    await chmod(target, 0o755);
    const svc = new FileExplorerService();
    const result = await svc.writeFile(target, "#!/bin/sh\necho new\n");
    expect(result.ok).toBe(true);
    expect((await stat(target)).mode & 0o777).toBe(0o755);
    await expect(readFile(target, "utf8")).resolves.toBe("#!/bin/sh\necho new\n");
  });

  it("returns not_found when the target does not exist (write never creates)", async () => {
    const svc = new FileExplorerService();
    const result = await svc.writeFile(join(dir, "does-not-exist.txt"), "x");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("not_found");
  });

  it("returns not_a_file when the target is a directory", async () => {
    const target = join(dir, "sub");
    await mkdir(target);
    const svc = new FileExplorerService();
    const result = await svc.writeFile(target, "x");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("not_a_file");
  });

  it("returns empty_path for an empty path", async () => {
    const svc = new FileExplorerService();
    const result = await svc.writeFile("", "x");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("empty_path");
  });

  it("returns too_large when content exceeds the inline cap", async () => {
    const target = join(dir, "big.txt");
    await writeFile(target, "small");
    const svc = new FileExplorerService();
    const result = await svc.writeFile(target, "x".repeat(5 * 1024 * 1024 + 1));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("too_large");
    // Rejected write must not touch the existing file.
    await expect(readFile(target, "utf8")).resolves.toBe("small");
  });

  it("resolves a symlinked target before writing", async () => {
    const real = join(dir, "real.txt");
    const link = join(dir, "link.txt");
    await writeFile(real, "old");
    await symlink(real, link);
    const svc = new FileExplorerService();
    const result = await svc.writeFile(link, "updated");
    expect(result.ok).toBe(true);
    await expect(readFile(real, "utf8")).resolves.toBe("updated");
  });

  it("does not leave a temp file behind on success", async () => {
    const target = join(dir, "clean.txt");
    await writeFile(target, "old");
    const svc = new FileExplorerService();
    await svc.writeFile(target, "new");
    const entries = await readdir(dir);
    expect(entries).toEqual(["clean.txt"]);
  });
});

describe("FileExplorerService.moveEntry", () => {
  it("moves a file into a sibling directory", async () => {
    const sub = join(dir, "sub");
    await mkdir(sub);
    const source = join(dir, "note.txt");
    await writeFile(source, "hello");
    const svc = new FileExplorerService();
    const result = await svc.moveEntry(source, join(sub, "note.txt"));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.destination).toBe(join(sub, "note.txt"));
    await expect(readFile(join(sub, "note.txt"), "utf8")).resolves.toBe("hello");
    await expect(stat(source)).rejects.toThrow();
  });

  it("renames within the same parent", async () => {
    const source = join(dir, "old.txt");
    await writeFile(source, "hi");
    const svc = new FileExplorerService();
    const result = await svc.moveEntry(source, join(dir, "new.txt"));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    await expect(readFile(join(dir, "new.txt"), "utf8")).resolves.toBe("hi");
  });

  it("moves a directory carrying its nested contents", async () => {
    const source = join(dir, "src");
    await mkdir(join(source, "sub"), { recursive: true });
    await writeFile(join(source, "sub", "deep.txt"), "deep");
    const dest = join(dir, "dst");
    const svc = new FileExplorerService();
    const result = await svc.moveEntry(source, dest);
    expect(result.ok).toBe(true);
    await expect(readFile(join(dest, "sub", "deep.txt"), "utf8")).resolves.toBe("deep");
  });

  it("returns exists for a colliding destination and leaves both paths untouched", async () => {
    const source = join(dir, "a.txt");
    const dest = join(dir, "b.txt");
    await writeFile(source, "a");
    await writeFile(dest, "b");
    const svc = new FileExplorerService();
    const result = await svc.moveEntry(source, dest);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("exists");
    await expect(readFile(source, "utf8")).resolves.toBe("a");
    await expect(readFile(dest, "utf8")).resolves.toBe("b");
  });

  it("returns into_descendant when a directory is moved into its own subtree", async () => {
    const source = join(dir, "parent");
    await mkdir(join(source, "child"), { recursive: true });
    const svc = new FileExplorerService();
    const result = await svc.moveEntry(source, join(source, "child", "parent"));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("into_descendant");
  });

  it("returns same_path for identical source and destination", async () => {
    const source = join(dir, "same.txt");
    await writeFile(source, "x");
    const svc = new FileExplorerService();
    const result = await svc.moveEntry(source, source);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("same_path");
  });

  it("returns not_found for a missing source or missing destination parent", async () => {
    const svc = new FileExplorerService();
    const missingSource = await svc.moveEntry(
      join(dir, "does-not-exist.txt"),
      join(dir, "dest.txt"),
    );
    expect(missingSource.ok).toBe(false);
    if (missingSource.ok) throw new Error("unreachable");
    expect(missingSource.error).toBe("not_found");

    const source = join(dir, "real.txt");
    await writeFile(source, "x");
    const missingDestParent = await svc.moveEntry(source, join(dir, "does-not-exist", "dest.txt"));
    expect(missingDestParent.ok).toBe(false);
    if (missingDestParent.ok) throw new Error("unreachable");
    expect(missingDestParent.error).toBe("not_found");
  });

  it("returns not_a_directory when the destination parent is a regular file", async () => {
    const source = join(dir, "s.txt");
    await writeFile(source, "x");
    const notADir = join(dir, "not-a-dir.txt");
    await writeFile(notADir, "x");
    const svc = new FileExplorerService();
    const result = await svc.moveEntry(source, join(notADir, "dest.txt"));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("not_a_directory");
  });

  it("returns invalid_name for a '..' destination basename", async () => {
    const source = join(dir, "s2.txt");
    await writeFile(source, "x");
    const svc = new FileExplorerService();
    const result = await svc.moveEntry(source, `${dir}/..`);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("invalid_name");
  });

  it("returns empty_path when either path is empty", async () => {
    const svc = new FileExplorerService();
    const a = await svc.moveEntry("", join(dir, "x"));
    expect(a.ok).toBe(false);
    if (a.ok) throw new Error("unreachable");
    expect(a.error).toBe("empty_path");

    const b = await svc.moveEntry(join(dir, "x"), "");
    expect(b.ok).toBe(false);
    if (b.ok) throw new Error("unreachable");
    expect(b.error).toBe("empty_path");
  });

  it("moves a symlink itself, not its target", async () => {
    const real = join(dir, "real-target.txt");
    await writeFile(real, "content");
    const link = join(dir, "the-link");
    await symlink(real, link);
    const sub = join(dir, "sub");
    await mkdir(sub);
    const svc = new FileExplorerService();
    const result = await svc.moveEntry(link, join(sub, "the-link"));
    expect(result.ok).toBe(true);
    const movedInfo = await lstat(join(sub, "the-link"));
    expect(movedInfo.isSymbolicLink()).toBe(true);
    await expect(readFile(real, "utf8")).resolves.toBe("content");
  });

  it("moves to the trimmed destination basename (no padded name on disk)", async () => {
    const source = join(dir, "pad-src.txt");
    await writeFile(source, "padded");
    const svc = new FileExplorerService();
    const result = await svc.moveEntry(source, join(dir, " padded.txt "));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.destination).toBe(join(dir, "padded.txt"));
    await expect(readFile(join(dir, "padded.txt"), "utf8")).resolves.toBe("padded");
    await expect(stat(join(dir, " padded.txt "))).rejects.toThrow();
    await expect(stat(source)).rejects.toThrow();
  });

  it("returns invalid_name when the destination basename is only whitespace", async () => {
    const source = join(dir, "ws-src.txt");
    await writeFile(source, "x");
    const svc = new FileExplorerService();
    const result = await svc.moveEntry(source, join(dir, "   "));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("invalid_name");
    await expect(readFile(source, "utf8")).resolves.toBe("x");
  });
});
