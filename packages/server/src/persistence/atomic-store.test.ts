import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  atomicWriteJson,
  createQueuedJsonWriter,
  ensureDirectoryLayout,
  loadStore,
  STORE_SUBDIRECTORIES,
} from "./atomic-store.js";

const docSchema = z.object({ value: z.number(), label: z.string().default("x") });

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pi-studio-store-"));
}

const dirs: string[] = [];
afterEach(() => {
  dirs.length = 0;
});

describe("atomicWriteJson + loadStore", () => {
  it("round-trips a validated document", async () => {
    const dir = await makeTempDir();
    dirs.push(dir);
    const path = join(dir, "doc.json");
    await atomicWriteJson(path, { value: 1, label: "hi" }, docSchema);
    expect(await loadStore(path, docSchema, { value: 0, label: "x" })).toEqual({
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
    expect(await loadStore(path, docSchema, { value: 0, label: "x" })).toEqual({
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
    expect(await loadStore(path, docSchema, { value: 0, label: "x" })).toEqual({
      value: 1,
      label: "ok",
    });
  });
});

describe("loadStore fallbacks", () => {
  it("returns defaults for a missing file", async () => {
    const dir = await makeTempDir();
    const result = await loadStore(join(dir, "missing.json"), docSchema, {
      value: -1,
      label: "default",
    });
    expect(result).toEqual({ value: -1, label: "default" });
  });

  it("falls back to defaults on corrupt JSON without throwing", async () => {
    const dir = await makeTempDir();
    const path = join(dir, "corrupt.json");
    await writeFile(path, "{ not valid json", "utf8");
    const result = await loadStore(path, docSchema, { value: -1, label: "default" });
    expect(result).toEqual({ value: -1, label: "default" });
  });

  it("applies the inline normalize hook before validation", async () => {
    const dir = await makeTempDir();
    const path = join(dir, "legacy.json");
    await writeFile(path, JSON.stringify({ value: 7, legacyLabel: "old" }), "utf8");
    const result = await loadStore(
      path,
      docSchema,
      { value: 0, label: "x" },
      {
        normalize: (raw) => {
          const obj = raw as Record<string, unknown>;
          return { value: obj.value, label: obj.legacyLabel ?? obj.label };
        },
      },
    );
    expect(result).toEqual({ value: 7, label: "old" });
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

describe("createQueuedJsonWriter", () => {
  it("serializes concurrent writes in FIFO order, last value wins", async () => {
    const dir = await makeTempDir();
    const path = join(dir, "loops.json");
    const write = createQueuedJsonWriter();
    const completionOrder: number[] = [];

    const pending = Array.from({ length: 10 }, (_, i) =>
      write(path, { value: i, label: `n${i}` }, docSchema).then(() => completionOrder.push(i)),
    );
    await Promise.all(pending);

    expect(completionOrder).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const onDisk = JSON.parse(await readFile(path, "utf8"));
    expect(onDisk.value).toBe(9);
  });
});
