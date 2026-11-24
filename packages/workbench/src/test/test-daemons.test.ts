import { describe, expect, it, vi } from "vitest";
import { DaemonError, createTestDaemons } from "./test-daemons.js";

const direct = { kind: "direct", name: "Work", address: "ws://work:1" } as const;

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return error instanceof DaemonError ? error.code : "other";
  }
  return undefined;
}

describe("in-memory registry", () => {
  it("refuses a name that differs only in case", async () => {
    const d = createTestDaemons({ entries: [direct] });
    expect(await codeOf(d.add({ kind: "direct", name: "work", address: "ws://x" }))).toBe(
      "name_taken",
    );
  });

  it("refuses to remove local and bad names", async () => {
    const d = createTestDaemons();
    expect(await codeOf(d.remove("local"))).toBe("local_not_removable");
    expect(await codeOf(d.remove("nope"))).toBe("not_found");
    expect(await codeOf(d.add({ kind: "relay", name: "  ", pairingLink: "x" }))).toBe(
      "invalid_name",
    );
  });

  it("notifies once per change and never exposes secrets", async () => {
    const d = createTestDaemons();
    const listener = vi.fn();
    d.subscribe(listener);
    const added = await d.add({ ...direct, password: "pw" });
    await d.add({ kind: "relay", name: "R", pairingLink: "pair://secret" });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(added.hasPassword).toBe(true);
    expect(JSON.stringify(d.snapshot())).not.toMatch(/pw|secret/);
    await d.update(added.id, { password: null });
    expect(d.snapshot().entries.find((e) => e.id === added.id)?.hasPassword).toBe(false);
    expect(await codeOf(d.update(added.id, { pairingLink: "x" }))).toBe("wrong_kind");
  });
});

describe("resolveCurrent", () => {
  it("rejects without a current entry", async () => {
    expect(await codeOf(createTestDaemons({ currentId: null }).resolveCurrent())).toBe(
      "no_current",
    );
  });

  it("resolves direct and relay entries", async () => {
    const d = createTestDaemons({
      entries: [
        { ...direct, id: "d", password: "pw" },
        { kind: "relay", name: "R", pairingLink: "pair://x", id: "r" },
      ],
      currentId: "d",
    });
    expect(await d.resolveCurrent()).toEqual({ url: "ws://work:1", password: "pw", connect: true });
    void d.switchTo("r");
    expect(await d.resolveCurrent()).toEqual({ url: "pair://x", connect: true });
    expect(d.switches).toEqual(["r"]);
  });

  it("follows the local rules", async () => {
    const running = createTestDaemons({ local: { state: "running", host: "h", port: 1 } });
    expect(await running.resolveCurrent()).toEqual({ url: "ws://h:1", connect: true });

    const outdated = createTestDaemons({ local: { state: "outdated", version: "0.0.1" } });
    expect(await codeOf(outdated.resolveCurrent())).toBe("outdated");

    const off = createTestDaemons({ settings: { autoStartLocalDaemon: false } });
    expect(await codeOf(off.resolveCurrent())).toBe("local_stopped");

    const auto = createTestDaemons();
    expect(await auto.resolveCurrent()).toEqual({ url: "ws://127.0.0.1:7777", connect: true });

    const failing = createTestDaemons({ startOutcome: { state: "failed", reason: "timeout" } });
    expect(await codeOf(failing.resolveCurrent())).toBe("timeout");
  });

  it("refuses a second action while one runs", async () => {
    const d = createTestDaemons();
    await d.local.start();
    expect(d.snapshot().local.state).toBe("starting");
    expect(await codeOf(d.local.stop())).toBe("busy");
    await d.settled();
    expect(d.snapshot().local.state).toBe("running");
  });
});
