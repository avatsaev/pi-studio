import { describe, expect, it } from "vitest";
import type { DaemonUpdateStatus } from "@av-pi-studio/protocol";
import { startDaemonUpdate, type DaemonUpdateClient } from "./daemon-update-actions.js";

function status(
  state: DaemonUpdateStatus["state"],
  extra: Partial<DaemonUpdateStatus> = {},
): DaemonUpdateStatus {
  return {
    currentVersion: "0.0.129",
    installKind: "npm-global",
    autoCheck: true,
    state,
    ...extra,
  };
}

const AVAILABLE = status({ kind: "available", version: "0.0.130" });
const RUNNING = status({ kind: "installing", version: "0.0.130" });

function fakeClient(options: {
  apply?: { ok: boolean; error?: string } | Error;
  check?: DaemonUpdateStatus;
  current?: DaemonUpdateStatus;
}) {
  const calls: string[] = [];
  const client: DaemonUpdateClient = {
    getDaemonUpdateStatus: async () => {
      calls.push("status");
      return options.current ?? AVAILABLE;
    },
    checkDaemonUpdate: async () => {
      calls.push("check");
      return options.check ?? AVAILABLE;
    },
    applyDaemonUpdate: async () => {
      calls.push("apply");
      const apply = options.apply ?? { ok: true };
      if (apply instanceof Error) throw apply;
      return apply;
    },
  };
  return { client, calls };
}

describe("startDaemonUpdate", () => {
  it("applies without a check and reports no error", async () => {
    const { client, calls } = fakeClient({});
    const seen: DaemonUpdateStatus[] = [];
    expect(await startDaemonUpdate(client, (s) => seen.push(s), { check: false })).toBeNull();
    expect(calls).toEqual(["apply"]);
    expect(seen).toEqual([]);
  });

  it("shows the running update, not an error, when the daemon says in_progress", async () => {
    const { client, calls } = fakeClient({
      apply: { ok: false, error: "in_progress" },
      current: RUNNING,
    });
    const seen: DaemonUpdateStatus[] = [];
    expect(await startDaemonUpdate(client, (s) => seen.push(s), { check: false })).toBeNull();
    expect(calls).toEqual(["apply", "status"]);
    expect(seen).toEqual([RUNNING]);
  });

  it("words the other refusals and refreshes the status", async () => {
    const { client, calls } = fakeClient({ apply: { ok: false, error: "not_available" } });
    const seen: DaemonUpdateStatus[] = [];
    expect(await startDaemonUpdate(client, (s) => seen.push(s), { check: false })).toBe(
      "No newer version is available.",
    );
    expect(calls).toEqual(["apply", "status"]);
    expect(seen).toHaveLength(1);
  });

  it("reports a transport failure as its message", async () => {
    const { client } = fakeClient({ apply: new Error("socket closed") });
    expect(await startDaemonUpdate(client, () => {}, { check: false })).toBe("socket closed");
  });

  it("retries with a check first, then applies", async () => {
    const { client, calls } = fakeClient({});
    const seen: DaemonUpdateStatus[] = [];
    expect(await startDaemonUpdate(client, (s) => seen.push(s), { check: true })).toBeNull();
    expect(calls).toEqual(["check", "apply"]);
    expect(seen).toEqual([AVAILABLE]);
  });

  it("does not apply when the check leaves nothing to install", async () => {
    const idle = status({ kind: "idle" });
    const { client, calls } = fakeClient({ check: idle });
    expect(await startDaemonUpdate(client, () => {}, { check: true })).toBeNull();
    expect(calls).toEqual(["check"]);
  });

  it("reports a failed check", async () => {
    const offline = status({ kind: "idle" }, { checkError: "offline" });
    const { client, calls } = fakeClient({ check: offline });
    expect(await startDaemonUpdate(client, () => {}, { check: true })).toContain("npm registry");
    expect(calls).toEqual(["check"]);
  });
});
