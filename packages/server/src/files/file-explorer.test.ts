import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
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
