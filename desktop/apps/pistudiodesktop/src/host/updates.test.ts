import { describe, expect, it, vi } from "vitest";

import { type Ipc, type IpcEvents } from "./ipc.js";
import { createDesktopUpdates, parseUpdateState, UPDATE_EVENT } from "./updates.js";

describe("parseUpdateState", () => {
  it.each([
    [{ state: "idle" }],
    [{ state: "checking" }],
    [{ state: "up_to_date", checkedAt: 1700000000000 }],
    [{ state: "available", version: "1.2.0", releaseUrl: "https://x/r" }],
    [{ state: "downloading", version: "1.2.0", received: 5 }],
    [{ state: "downloading", version: "1.2.0", received: 5, total: 10 }],
    [{ state: "restart_needed", version: "1.2.0" }],
    [{ state: "cannot_install", version: "1.2.0", releaseUrl: "https://x/r", reason: "no_pkexec" }],
    [{ state: "failed", code: "offline" }],
    [{ state: "failed", code: "download", version: "1.2.0", releaseUrl: "https://x/r" }],
  ])("accepts %j", (state) => {
    expect(parseUpdateState(state)).toEqual(state);
  });

  it.each([
    [null],
    ["available"],
    [{}],
    [{ state: "nope" }],
    [{ state: "up_to_date" }],
    [{ state: "available", version: "1" }],
    [{ state: "downloading", version: "1", received: -1 }],
    [{ state: "downloading", version: "1", received: 1, total: "x" }],
    [{ state: "cannot_install", version: "1", releaseUrl: "u", reason: "other" }],
    [{ state: "failed", code: "other" }],
    [{ state: "failed", code: "offline", version: 3 }],
  ])("reads %j as idle", (value) => {
    expect(parseUpdateState(value)).toEqual({ state: "idle" });
  });

  it("drops unknown fields", () => {
    expect(parseUpdateState({ state: "checking", extra: 1 })).toEqual({ state: "checking" });
  });
});

function harness(invoke: Ipc["invoke"] = async () => ({ accepted: true })) {
  let handler: ((payload: unknown) => void) | undefined;
  const invokeFn = vi.fn<Ipc["invoke"]>(invoke);
  const ipc: Ipc & IpcEvents = {
    invoke: invokeFn,
    listen: async (event, h) => {
      expect(event).toBe(UPDATE_EVENT);
      handler = h;
      return () => undefined;
    },
  };
  const updates = createDesktopUpdates({ state: "checking" }, ipc, vi.fn<(message: string, error: unknown) => void>());
  return { updates, invoke: invokeFn, emit: (payload: unknown) => handler?.(payload) };
}

describe("createDesktopUpdates", () => {
  it("starts from the boot state and follows the event", () => {
    const { updates, emit } = harness();
    expect(updates.current()).toEqual({ state: "checking" });
    const listener = vi.fn<() => void>();
    updates.subscribe(listener);
    emit({ state: "restart_needed", version: "2.0.0" });
    expect(updates.current()).toEqual({ state: "restart_needed", version: "2.0.0" });
    expect(listener).toHaveBeenCalledTimes(1);
    emit("garbage");
    expect(updates.current()).toEqual({ state: "idle" });
  });

  it("stops calling a removed listener", () => {
    const { updates, emit } = harness();
    const listener = vi.fn<() => void>();
    const off = updates.subscribe(listener);
    off();
    emit({ state: "checking" });
    expect(listener).not.toHaveBeenCalled();
  });

  it("runs the three actions as registry commands", async () => {
    const { updates, invoke } = harness();
    await updates.check();
    await updates.install();
    await updates.restart();
    expect(invoke.mock.calls).toEqual([
      ["engine_command", { id: "update.check" }],
      ["engine_command", { id: "update.install" }],
      ["engine_command", { id: "update.restart" }],
    ]);
  });

  it("rejects with the refusal's reason", async () => {
    const { updates } = harness(async () => {
      throw "`update.install` is unavailable: there is no update to install";
    });
    await expect(updates.install()).rejects.toThrow("there is no update to install");
  });
});
