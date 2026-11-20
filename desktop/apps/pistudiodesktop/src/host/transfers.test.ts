import { describe, expect, it, vi } from "vitest";

import { type Ipc } from "./ipc.js";
import { countTransfers, createSaveTarget } from "./transfers.js";

const fake = (impl: Ipc["invoke"]) => ({ invoke: vi.fn<Ipc["invoke"]>(impl) });

describe("save target", () => {
  it("a cancelled dialog gives null", async () => {
    const ipc = fake(async () => null);
    expect(await createSaveTarget(ipc)("a.txt")).toBeNull();
    expect(ipc.invoke).toHaveBeenCalledWith("save_begin", { suggestedName: "a.txt" });
  });

  it("writes in order, each waiting for its answer, then finishes once", async () => {
    const log: string[] = [];
    let release: (() => void) | undefined;
    const ipc = fake(async (command, _args, options) => {
      log.push(`${command}${options ? ":" + options.headers.handle : ""}`);
      if (command === "save_begin") return { handle: "h1" };
      if (command === "save_write") await new Promise<void>((r) => (release = r));
      return null;
    });
    const target = await createSaveTarget(ipc)("a.txt");
    const first = target?.write(new Uint8Array([1]));
    await Promise.resolve();
    await Promise.resolve();
    expect(log).toEqual(["save_begin", "save_write:h1"]);
    release?.();
    await first;
    const second = target?.write(new Uint8Array([2]));
    await Promise.resolve();
    await Promise.resolve();
    release?.();
    await second;
    await target?.finish();
    expect(log).toEqual(["save_begin", "save_write:h1", "save_write:h1", "save_finish"]);
    expect(ipc.invoke).toHaveBeenCalledWith("save_finish", { handle: "h1" });
  });

  it("discard reaches Rust once", async () => {
    const ipc = fake(async (command) => (command === "save_begin" ? { handle: "h" } : null));
    const target = await createSaveTarget(ipc)("a");
    await target?.discard();
    expect(ipc.invoke.mock.calls.filter(([c]) => c === "save_discard")).toHaveLength(1);
  });
});

describe("transfer count", () => {
  it("overlapping transfers report 1, 2, 1, 0, and a rejection counts down too", async () => {
    const releases: Array<(fail: boolean) => void> = [];
    const pending = () => new Promise<void>((resolve, reject) => releases.push((fail) => (fail ? reject(new Error("x")) : resolve())));
    const files = { upload: pending, saveToDisk: pending } as unknown as Parameters<typeof countTransfers>[0];
    const seen: number[] = [];
    const counted = countTransfers(files, (n) => seen.push(n));
    const a = counted.upload("/w", {} as never);
    const b = counted.saveToDisk("/w/f");
    releases[0]?.(false);
    await a;
    releases[1]?.(true);
    await expect(b).rejects.toThrow("x");
    expect(seen).toEqual([1, 2, 1, 0]);
  });
});
