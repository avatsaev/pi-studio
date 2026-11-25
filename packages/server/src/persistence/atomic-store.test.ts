import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { silentLogger } from "../logging/logger.js";
import { recordingLogger } from "../test-support/recording-logger.js";
import {
  atomicWriteJson,
  ensureDirectoryLayout,
  loadStore,
  quarantineFile,
  STORE_SUBDIRECTORIES,
} from "./atomic-store.js";

const docSchema = z.object({ value: z.number(), label: z.string().default("x") });
const defaults = { value: -1, label: "default" };

const dirs: string[] = [];
async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-studio-store-"));
  dirs.push(dir);
  return dir;
}

/** The set-aside files in `dir`, sorted. */
async function damagedFiles(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((name) => name.includes(".corrupt-")).toSorted();
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("atomicWriteJson + loadStore", () => {
  it("round-trips a validated document", async () => {
    const dir = await makeTempDir();
    const path = join(dir, "doc.json");
    await atomicWriteJson(path, { value: 1, label: "hi" }, docSchema);
    expect(await loadStore(path, docSchema, { value: 0, label: "x" }, silentLogger())).toEqual({
      value: 1,
      label: "hi",
    });
  });

  it("leaves the previous file intact when a temp exists but no rename happened (crash sim)", async () => {
    const dir = await makeTempDir();
    const path = join(dir, "doc.json");
    await atomicWriteJson(path, { value: 42, label: "v1" }, docSchema);
    const before = await readFile(path, "utf8");

    // Simulate a crash AFTER temp-write but BEFORE rename: a stray temp file is left behind.
    await writeFile(`${path}.99999.abc.tmp`, '{ "value": 999, "label": "torn', "utf8");

    // Primary file is byte-identical and still loads as v1; the temp is ignored.
    expect(await readFile(path, "utf8")).toBe(before);
    expect(await loadStore(path, docSchema, { value: 0, label: "x" }, silentLogger())).toEqual({
      value: 42,
      label: "v1",
    });
  });

  it("rejects invalid data before touching the primary file", async () => {
    const dir = await makeTempDir();
    const path = join(dir, "doc.json");
    await atomicWriteJson(path, { value: 1, label: "ok" }, docSchema);
    await expect(
      // @ts-expect-error — value must be a number
      atomicWriteJson(path, { value: "nope" }, docSchema),
    ).rejects.toBeDefined();
    expect(await loadStore(path, docSchema, { value: 0, label: "x" }, silentLogger())).toEqual({
      value: 1,
      label: "ok",
    });
  });

  it("runs 50 concurrent writes to one path in call order: the last wins, no temp file is left", async () => {
    const dir = await makeTempDir();
    const path = join(dir, "doc.json");
    const completed: number[] = [];

    await Promise.all(
      Array.from({ length: 50 }, async (_, i) => {
        await atomicWriteJson(path, { value: i, label: `v${i}` }, docSchema);
        completed.push(i);
      }),
    );

    expect(completed).toEqual(Array.from({ length: 50 }, (_, i) => i));
    expect(await loadStore(path, docSchema, defaults, silentLogger())).toEqual({
      value: 49,
      label: "v49",
    });
    expect(await readdir(dir)).toEqual(["doc.json"]);
  });

  it("leaves no temp file after a failed write and does not block the next one", async () => {
    const dir = await makeTempDir();
    const path = join(dir, "doc.json");
    await mkdir(path); // a directory where the file belongs: the rename fails

    const results = await Promise.allSettled([
      atomicWriteJson(path, { value: 1, label: "a" }, docSchema),
      atomicWriteJson(path, { value: 2, label: "b" }, docSchema),
    ]);
    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(await readdir(dir)).toEqual(["doc.json"]);

    await rm(path, { recursive: true });
    await atomicWriteJson(path, { value: 3, label: "c" }, docSchema);
    expect(await loadStore(path, docSchema, defaults, silentLogger())).toEqual({
      value: 3,
      label: "c",
    });
  });
});

describe("loadStore", () => {
  it("returns defaults for a missing file and logs nothing", async () => {
    const dir = await makeTempDir();
    const { logger, lines } = recordingLogger();

    expect(await loadStore(join(dir, "missing.json"), docSchema, defaults, logger)).toEqual(
      defaults,
    );

    expect(lines).toEqual([]);
    expect(await readdir(dir)).toEqual([]);
  });

  it("sets aside a file that is not JSON: original bytes kept, defaults returned, one error logged", async () => {
    const dir = await makeTempDir();
    const path = join(dir, "doc.json");
    await writeFile(path, "{ not valid json", "utf8");
    const { logger, lines } = recordingLogger();

    expect(await loadStore(path, docSchema, defaults, logger)).toEqual(defaults);

    expect(existsSync(path)).toBe(false);
    const [aside, ...rest] = await damagedFiles(dir);
    expect(rest).toEqual([]);
    expect(aside).toMatch(/^doc\.json\.corrupt-\d{8}T\d{6}Z$/);
    expect(await readFile(join(dir, aside as string), "utf8")).toBe("{ not valid json");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "error",
      obj: {
        path,
        quarantinedTo: join(dir, aside as string),
        reason: expect.stringContaining("invalid JSON"),
      },
    });
  });

  it("sets aside a file that fails its schema: original bytes kept, defaults returned, one error logged", async () => {
    const dir = await makeTempDir();
    const path = join(dir, "doc.json");
    const original = `${JSON.stringify({ value: "nope" })}\n`;
    await writeFile(path, original, "utf8");
    const { logger, lines } = recordingLogger();

    expect(await loadStore(path, docSchema, defaults, logger)).toEqual(defaults);

    expect(existsSync(path)).toBe(false);
    const [aside, ...rest] = await damagedFiles(dir);
    expect(rest).toEqual([]);
    expect(await readFile(join(dir, aside as string), "utf8")).toBe(original);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "error",
      obj: { path, reason: expect.stringMatching(/schema mismatch.*value/) },
    });
  });

  it("keeps the set-aside file when the next save writes a fresh one", async () => {
    const dir = await makeTempDir();
    const path = join(dir, "doc.json");
    await writeFile(path, "{ torn", "utf8");

    await loadStore(path, docSchema, defaults, silentLogger());
    await atomicWriteJson(path, { value: 1, label: "fresh" }, docSchema);

    expect(await loadStore(path, docSchema, defaults, silentLogger())).toEqual({
      value: 1,
      label: "fresh",
    });
    const [aside] = await damagedFiles(dir);
    expect(await readFile(join(dir, aside as string), "utf8")).toBe("{ torn");
  });

  it("gives two files damaged in the same second two different names", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-25T14:30:12.345Z") });
    const dir = await makeTempDir();
    const path = join(dir, "doc.json");

    await writeFile(path, "first", "utf8");
    await loadStore(path, docSchema, defaults, silentLogger());
    await writeFile(path, "second", "utf8");
    await loadStore(path, docSchema, defaults, silentLogger());

    expect(await damagedFiles(dir)).toEqual([
      "doc.json.corrupt-20261125T143012Z",
      "doc.json.corrupt-20261125T143012Z-1",
    ]);
    expect(await readFile(join(dir, "doc.json.corrupt-20261125T143012Z"), "utf8")).toBe("first");
    expect(await readFile(join(dir, "doc.json.corrupt-20261125T143012Z-1"), "utf8")).toBe("second");
  });

  it("throws, and leaves the file alone, when it cannot be read", async () => {
    const dir = await makeTempDir();
    const path = join(dir, "doc.json");
    await mkdir(path); // a directory: unreadable, not known to be damaged
    const { logger, lines } = recordingLogger();

    await expect(loadStore(path, docSchema, defaults, logger)).rejects.toThrow();

    expect(lines).toEqual([]);
    expect(await readdir(dir)).toEqual(["doc.json"]);
  });
});

describe("quarantineFile", () => {
  it("renames to <name>.corrupt-<UTC timestamp>, logs the path and the reason, and returns the new path", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-25T14:30:12.345Z") });
    const dir = await makeTempDir();
    const path = join(dir, "doc.json");
    await writeFile(path, "bytes", "utf8");
    const { logger, lines } = recordingLogger();

    const target = await quarantineFile(path, "because", logger);

    expect(target).toBe(`${path}.corrupt-20261125T143012Z`);
    expect(await readFile(target, "utf8")).toBe("bytes");
    expect(existsSync(path)).toBe(false);
    expect(lines).toEqual([
      {
        level: "error",
        msg: "damaged file set aside",
        obj: { path, quarantinedTo: target, reason: "because" },
      },
    ]);
  });
});

describe("ensureDirectoryLayout", () => {
  it("creates all required subdirectories idempotently", async () => {
    const dir = await makeTempDir();
    const home = join(dir, "home");
    await ensureDirectoryLayout(home);
    await ensureDirectoryLayout(home); // idempotent: no throw on second call
    for (const sub of STORE_SUBDIRECTORIES) {
      expect(existsSync(join(home, sub))).toBe(true);
    }
  });
});
