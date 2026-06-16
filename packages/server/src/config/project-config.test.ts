import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  isServiceScript,
  normalizeProjectConfig,
  readProjectConfig,
  scriptEntrySchema,
  writeProjectConfig,
} from "./project-config.js";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pi-studio-project-"));
}

describe("setup/teardown normalization", () => {
  it("normalizes a string to a single-element array", () => {
    const cfg = normalizeProjectConfig({ worktree: { setup: "npm install" } });
    expect(cfg.worktree.setup).toEqual(["npm install"]);
    expect(cfg.worktree.teardown).toEqual([]);
  });

  it("defaults to empty arrays when absent", () => {
    expect(normalizeProjectConfig({}).worktree).toEqual({ setup: [], teardown: [] });
  });

  it("drops blank commands from an array", () => {
    const cfg = normalizeProjectConfig({ worktree: { teardown: ["  ", "cleanup", ""] } });
    expect(cfg.worktree.teardown).toEqual(["cleanup"]);
  });
});

describe("scripts", () => {
  it("parses a service script and flags it for proxying", () => {
    const cfg = normalizeProjectConfig({
      scripts: { dev: { type: "service", command: "npm run dev" } },
    });
    const dev = cfg.scripts.dev;
    expect(dev).toBeDefined();
    expect(isServiceScript(dev!)).toBe(true);
  });

  it("treats a non-service script as not proxied", () => {
    const entry = scriptEntrySchema.parse({ command: "echo hi" });
    expect(isServiceScript(entry)).toBe(false);
  });

  it("rejects a script entry missing command", () => {
    expect(scriptEntrySchema.safeParse({ type: "service" }).success).toBe(false);
  });
});

describe("revision / stale-write model", () => {
  it("writes successfully when the revision matches, then reports stale on a changed file", async () => {
    const dir = await tempDir();
    const path = join(dir, "pi-studio.json");

    // Initial create (no file yet → expected revision null).
    const first = await writeProjectConfig(path, { worktree: { setup: "a" } }, null);
    expect(first.ok).toBe(true);

    const read = await readProjectConfig(path);
    expect(read.revision).not.toBeNull();

    // Someone else edits the file on disk → revision changes.
    await writeFile(path, JSON.stringify({ worktree: { setup: "external" } }), "utf8");

    // A write against the now-stale revision is rejected.
    const stale = await writeProjectConfig(path, { worktree: { setup: "b" } }, read.revision);
    expect(stale).toEqual({ ok: false, error: "stale_project_config" });
  });

  it("returns invalid_project_config for a bad document", async () => {
    const dir = await tempDir();
    const path = join(dir, "pi-studio.json");
    const result = await writeProjectConfig(
      path,
      { scripts: { dev: { type: "service" } } }, // missing command
      null,
    );
    expect(result).toEqual({ ok: false, error: "invalid_project_config" });
  });

  it("returns project_not_found when the project root is missing", async () => {
    const result = await writeProjectConfig(
      join(tmpdir(), "no-such-pi-studio-dir-xyz", "pi-studio.json"),
      {},
      null,
    );
    expect(result).toEqual({ ok: false, error: "project_not_found" });
  });

  it("round-trips written config through normalization", async () => {
    const dir = await tempDir();
    const path = join(dir, "pi-studio.json");
    await writeProjectConfig(
      path,
      { worktree: { setup: ["x", "y"] }, instructions: "be safe" },
      null,
    );
    const onDisk = JSON.parse(await readFile(path, "utf8"));
    expect(onDisk.worktree.setup).toEqual(["x", "y"]);
    const { config } = await readProjectConfig(path);
    expect(config.instructions).toBe("be safe");
  });
});
