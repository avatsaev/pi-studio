import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
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
