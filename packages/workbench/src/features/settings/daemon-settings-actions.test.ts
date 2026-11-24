import { describe, expect, it } from "vitest";
import type { DaemonUpdateStatus } from "@av-pi-studio/protocol";
import { daemonSettingsView } from "./daemon-settings-view.js";
import {
  changeAutoCheck,
  checkDaemonNow,
  type DaemonSettingsClient,
} from "./daemon-settings-actions.js";

function status(extra: Partial<DaemonUpdateStatus> = {}): DaemonUpdateStatus {
  return {
    currentVersion: "0.0.129",
    installKind: "npm-global",
    autoCheck: true,
    state: { kind: "idle" },
    ...extra,
  };
}

function fakeClient(options: {
  check?: DaemonUpdateStatus | Error;
  setAutoCheck?: (enabled: boolean) => DaemonUpdateStatus | Error;
}) {
  const calls: string[] = [];
  const client: DaemonSettingsClient = {
    checkDaemonUpdate: async () => {
      calls.push("check");
      const answer = options.check ?? status();
      if (answer instanceof Error) throw answer;
      return answer;
    },
    setDaemonUpdateAutoCheck: async (enabled) => {
      calls.push(`autoCheck:${enabled}`);
      const answer = options.setAutoCheck?.(enabled) ?? status({ autoCheck: enabled });
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return { client, calls };
}

describe("checkDaemonNow", () => {
  it("applies the answer and reports no error", async () => {
    const answer = status({ checkedAt: 5, state: { kind: "available", version: "0.0.130" } });
    const { client, calls } = fakeClient({ check: answer });
    const seen: DaemonUpdateStatus[] = [];
    expect(await checkDaemonNow(client, (s) => seen.push(s))).toBeNull();
    expect(calls).toEqual(["check"]);
    expect(seen).toEqual([answer]);
  });

  it("a failed check is the answer's checkError, shown by the view — not an error here", async () => {
    const answer = status({ checkedAt: 5, checkError: "offline" });
    const { client } = fakeClient({ check: answer });
    const seen: DaemonUpdateStatus[] = [];
    expect(await checkDaemonNow(client, (s) => seen.push(s))).toBeNull();
    expect(seen).toEqual([answer]);
    expect(daemonSettingsView({ status: answer, pendingAutoCheck: null, now: 5 }).checkError).toBe(
      "Could not reach the npm registry from the daemon's host.",
    );
  });

  it("a request that fails resolves its message and applies nothing", async () => {
    const { client } = fakeClient({ check: new Error("socket closed") });
    const seen: DaemonUpdateStatus[] = [];
    expect(await checkDaemonNow(client, (s) => seen.push(s))).toBe("socket closed");
    expect(seen).toEqual([]);
  });
});

describe("changeAutoCheck", () => {
  it("shows the new value, applies the daemon's answer, then ends the optimistic state", async () => {
    const { client, calls } = fakeClient({});
    const events: string[] = [];
    const error = await changeAutoCheck(client, false, {
      applyStatus: (s) => events.push(`apply:${s.autoCheck}`),
      setPending: (value) => events.push(`pending:${value}`),
    });
    expect(error).toBeNull();
    expect(calls).toEqual(["autoCheck:false"]);
    // The answer is applied before the optimistic value is dropped: no flash of the old value.
    expect(events).toEqual(["pending:false", "apply:false", "pending:null"]);
  });

  it("reverts on an error: the optimistic value is dropped, nothing is applied, the error is worded", async () => {
    const { client } = fakeClient({ setAutoCheck: () => new Error("rpc timeout") });
    const stored = status({ autoCheck: true });
    let pending: boolean | null = null;
    const shown: boolean[] = [];
    const error = await changeAutoCheck(client, false, {
      applyStatus: () => {
        throw new Error("must not apply");
      },
      setPending: (value) => {
        pending = value;
        shown.push(
          daemonSettingsView({ status: stored, pendingAutoCheck: pending, now: 0 }).autoCheck,
        );
      },
    });
    expect(error).toBe("Could not change the automatic check: rpc timeout");
    // Optimistic off, then back to the daemon's own value.
    expect(shown).toEqual([false, true]);
    expect(pending).toBeNull();
  });

  it("works the other way round too (off → on, then reverts)", async () => {
    const { client } = fakeClient({ setAutoCheck: () => new Error("no") });
    const stored = status({ autoCheck: false });
    const shown: boolean[] = [];
    await changeAutoCheck(client, true, {
      applyStatus: () => {},
      setPending: (value) =>
        shown.push(
          daemonSettingsView({ status: stored, pendingAutoCheck: value, now: 0 }).autoCheck,
        ),
    });
    expect(shown).toEqual([true, false]);
  });
});
