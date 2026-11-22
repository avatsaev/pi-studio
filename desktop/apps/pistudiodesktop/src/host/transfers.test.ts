import { type TransferState, type WorkbenchHost } from "@av-pi-studio/workbench";
import { describe, expect, it, vi } from "vitest";

import { type BootSnapshot } from "./boot.js";
import { type Ipc, type IpcEvents } from "./ipc.js";
import { countTransfers, createEngineFiles, createSaveTarget, engineServes } from "./transfers.js";

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
    const pending = () =>
      new Promise<void>((resolve, reject) => releases.push((fail) => (fail ? reject(new Error("x")) : resolve())));
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

const snapshotWith = (transfers: "engine" | "page", kind: "local" | "direct" | "relay" | null): BootSnapshot =>
  ({
    transfers,
    daemons: {
      currentId: kind === null ? null : "e1",
      entries: kind === null ? [] : [{ id: "e1", kind, name: "n", hasPassword: false }],
    },
  }) as unknown as BootSnapshot;

describe("engineServes", () => {
  it.each([
    ["engine", "local", true],
    ["engine", "direct", true],
    ["engine", "relay", true],
    ["engine", null, false],
    ["page", "local", false],
    ["page", "direct", false],
  ] as const)("transfers %s, entry %s: %s", (transfers, kind, expected) => {
    expect(engineServes(snapshotWith(transfers, kind))).toBe(expected);
  });
});

describe("engine files", () => {
  type Handler = (payload: unknown) => void;

  /** A fake `ipc` whose commands answer by name; `emit` sends a `transfer_progress` payload. */
  function setup(answers: Record<string, (args: unknown) => unknown> = {}) {
    let handler: Handler | undefined;
    let listened = 0;
    const invoke = vi.fn<Ipc["invoke"]>(async (command, args) => {
      const answer = answers[command];
      return answer ? answer(args) : null;
    });
    const ipc: Ipc & IpcEvents = {
      invoke,
      listen: async (event, next) => {
        expect(event).toBe("transfer_progress");
        listened += 1;
        handler = next;
        return () => undefined;
      },
    };
    const baseUpload = vi.fn<WorkbenchHost["files"]["upload"]>(async () => undefined);
    const baseSave = vi.fn<WorkbenchHost["files"]["saveToDisk"]>(async () => undefined);
    const openForView = vi.fn<WorkbenchHost["files"]["openForView"]>();
    const base: WorkbenchHost["files"] = { upload: baseUpload, saveToDisk: baseSave, openForView };
    const log = vi.fn<(message: string, error: unknown) => void>();
    const files = createEngineFiles(base, ipc, log);
    const commands = (name: string) => invoke.mock.calls.filter(([command]) => command === name);
    return {
      files,
      invoke,
      commands,
      baseUpload,
      baseSave,
      log,
      emit: (payload: unknown) => handler?.(payload),
      listened: () => listened,
    };
  }

  const pick = async (t: ReturnType<typeof setup>) => {
    const [source] = (await t.files.pickUploads?.()) ?? [];
    if (!source) throw new Error("nothing picked");
    return source;
  };
  const picked = { upload_pick: () => [{ handle: "h".repeat(32), name: "a.txt", size: 7 }] };
  const idOf = (t: ReturnType<typeof setup>, command: string): string =>
    (t.commands(command)[0]?.[1] as { id: string } | undefined)?.id ?? "";
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  it("a picked source keeps its handle out of sight and uploads through transfer_upload with <dir>/<name>", async () => {
    const t = setup(picked);
    const source = await pick(t);
    expect(source).toEqual({ name: "a.txt", size: 7 });
    expect(JSON.stringify(source)).not.toContain("hhhh");
    await t.files.upload("/w/dir", source);
    expect(t.commands("transfer_upload")).toHaveLength(1);
    expect(t.invoke).toHaveBeenCalledWith("transfer_upload", {
      id: expect.stringMatching(/^[A-Za-z0-9-]{1,64}$/),
      handle: "h".repeat(32),
      path: "/w/dir/a.txt",
    });
    expect(t.baseUpload).not.toHaveBeenCalled();
  });

  it("an empty dir uploads to the bare name; a source without a size has none", async () => {
    const t = setup({ upload_pick: () => [{ handle: "x", name: "b" }] });
    const source = await pick(t);
    expect(source).toEqual({ name: "b" });
    await t.files.upload("", source);
    expect(t.invoke).toHaveBeenCalledWith("transfer_upload", expect.objectContaining({ path: "b" }));
  });

  it("a Blob goes to the browser host's upload", async () => {
    const t = setup();
    const blob = new File(["x"], "d.txt");
    const options = { onProgress: vi.fn<(done: number, total?: number) => void>() };
    await t.files.upload("/w", blob, options);
    expect(t.baseUpload).toHaveBeenCalledWith("/w", blob, options);
    expect(t.commands("transfer_upload")).toHaveLength(0);
  });

  it("a pick that gives a wrong shape rejects", async () => {
    await expect(setup({ upload_pick: () => "nope" }).files.pickUploads?.()).rejects.toThrow("upload_pick");
    await expect(setup({ upload_pick: () => [{ name: "a" }] }).files.pickUploads?.()).rejects.toThrow("upload_pick");
    expect(await setup({ upload_pick: () => [] }).files.pickUploads?.()).toEqual([]);
  });

  it("a save goes through save_begin, then transfer_save, with the file's name", async () => {
    const t = setup({ save_begin: () => ({ handle: "s1" }) });
    await t.files.saveToDisk("/w/dir/f.bin");
    expect(t.invoke.mock.calls.map(([command]) => command)).toEqual(["save_begin", "transfer_save"]);
    expect(t.invoke).toHaveBeenNthCalledWith(1, "save_begin", { suggestedName: "f.bin" });
    expect(t.invoke).toHaveBeenNthCalledWith(2, "transfer_save", {
      id: expect.any(String),
      handle: "s1",
      path: "/w/dir/f.bin",
    });
    expect(t.baseSave).not.toHaveBeenCalled();
  });

  it("a cancelled dialog resolves without transfer_save or a callback", async () => {
    const t = setup({ save_begin: () => null });
    const options = {
      onProgress: vi.fn<(done: number, total?: number) => void>(),
      onStateChange: vi.fn<(state: TransferState) => void>(),
    };
    await expect(t.files.saveToDisk("/w/f", options)).resolves.toBeUndefined();
    expect(t.commands("transfer_save")).toHaveLength(0);
    expect(options.onProgress).not.toHaveBeenCalled();
    expect(options.onStateChange).not.toHaveBeenCalled();
  });

  it("registers one listener and dispatches by id, ignoring other ids", async () => {
    let finish: (() => void) | undefined;
    let first = true;
    const t = setup({
      ...picked,
      transfer_upload: () => {
        if (!first) return null;
        first = false;
        return new Promise<void>((resolve) => (finish = resolve));
      },
    });
    const options = {
      onProgress: vi.fn<(done: number, total?: number) => void>(),
      onStateChange: vi.fn<(state: TransferState) => void>(),
    };
    const source = await pick(t);
    const run = t.files.upload("/w", source, options);
    await settle();
    const id = idOf(t, "transfer_upload");
    t.emit({ id: "other", state: "running", done: 99, total: 100 });
    t.emit({ id, state: "queued", done: 0, total: null });
    t.emit({ id, state: "waiting", done: 5, total: 100 });
    t.emit({ id, state: "running", done: 0, total: 100 });
    t.emit({ id, state: "running", done: 40, total: null });
    t.emit({ id, state: "bogus", done: 50, total: 100 });
    t.emit("not an object");
    expect(options.onStateChange.mock.calls).toEqual([["queued"], ["waiting"], ["running"]]);
    expect(options.onProgress.mock.calls).toEqual([
      [0, 100],
      [40, undefined],
    ]);
    finish?.();
    await run;
    t.emit({ id, state: "running", done: 1, total: 2 });
    expect(options.onProgress).toHaveBeenCalledTimes(2);
    await t.files.upload("/w", source);
    expect(t.listened()).toBe(1);
  });

  it("an abort calls transfer_cancel once, and the cancelled error is an AbortError", async () => {
    let fail: ((error: unknown) => void) | undefined;
    const t = setup({
      ...picked,
      transfer_upload: () => new Promise<void>((_resolve, reject) => (fail = reject)),
      transfer_cancel: () => ({ cancelled: true }),
    });
    const controller = new AbortController();
    const run = t.files.upload("/w", await pick(t), { signal: controller.signal });
    await settle();
    controller.abort();
    controller.abort();
    expect(t.commands("transfer_cancel")).toEqual([["transfer_cancel", { id: idOf(t, "transfer_upload") }]]);
    fail?.({ code: "cancelled", message: "The transfer was cancelled." });
    await expect(run).rejects.toMatchObject({ name: "AbortError", message: "The transfer was cancelled." });
    expect(t.commands("transfer_cancel")).toHaveLength(1);
  });

  it("an abort before the transfer starts calls no command", async () => {
    const t = setup(picked);
    const controller = new AbortController();
    controller.abort();
    await expect(t.files.upload("/w", await pick(t), { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    await expect(t.files.saveToDisk("/w/f", { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(t.commands("transfer_upload")).toHaveLength(0);
    expect(t.commands("save_begin")).toHaveLength(0);
  });

  it("an abort during the save dialog discards the save and starts no transfer", async () => {
    const controller = new AbortController();
    const t = setup({ save_begin: () => (controller.abort(), { handle: "s9" }) });
    await expect(t.files.saveToDisk("/w/f", { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(t.invoke).toHaveBeenCalledWith("save_discard", { handle: "s9" });
    expect(t.commands("transfer_save")).toHaveLength(0);
  });

  it("any other error rejects with its message; the signal's listener is removed", async () => {
    const t = setup({
      ...picked,
      transfer_upload: () => Promise.reject({ code: "daemon_refused", message: "not_found" }),
    });
    const controller = new AbortController();
    await expect(t.files.upload("/w", await pick(t), { signal: controller.signal })).rejects.toThrow("not_found");
    controller.abort();
    expect(t.commands("transfer_cancel")).toHaveLength(0);
  });

  it("a string error rejects with it", async () => {
    const t = setup({ save_begin: () => ({ handle: "s" }), transfer_save: () => Promise.reject("boom") });
    await expect(t.files.saveToDisk("/w/f")).rejects.toThrow("boom");
  });

  it("a failed listener is logged and fails the transfer", async () => {
    const ipc: Ipc & IpcEvents = {
      invoke: vi.fn<Ipc["invoke"]>(async () => ({ handle: "s" })),
      listen: () => Promise.reject(new Error("no events")),
    };
    const log = vi.fn<(message: string, error: unknown) => void>();
    const files = createEngineFiles({} as WorkbenchHost["files"], ipc, log);
    await expect(files.saveToDisk("/w/f")).rejects.toThrow("no events");
    expect(log).toHaveBeenCalledWith("listening for transfer_progress failed", expect.any(Error));
  });

  it("other members of the base files stay", () => {
    const t = setup();
    expect(typeof t.files.openForView).toBe("function");
  });

  it("counts engine transfers", async () => {
    const t = setup({ ...picked, transfer_upload: () => new Promise<void>(() => undefined) });
    const seen: number[] = [];
    const counted = countTransfers(t.files, (n) => seen.push(n));
    void counted.upload("/w", await pick(t));
    expect(seen).toEqual([1]);
  });
});
