import { describe, expect, it } from "vitest";
import type { DaemonUpdateStatus } from "@av-pi-studio/protocol";
import {
  MANUAL_UPDATE_COMMAND,
  countLiveTerminals,
  countRunningAgents,
  countRunningListedAgents,
  daemonUpdateDialogView,
  impactText,
  type DaemonUpdateDialogInput,
  type DaemonUpdateResult,
} from "./daemon-update-dialog-view.js";

function status(state: DaemonUpdateStatus["state"]): DaemonUpdateStatus {
  return { currentVersion: "0.0.129", installKind: "npm-global", autoCheck: true, state };
}

function input(overrides: Partial<DaemonUpdateDialogInput> = {}): DaemonUpdateDialogInput {
  return {
    status: status({ kind: "available", version: "0.0.130" }),
    impact: { agents: 0, terminals: 0 },
    pageVersion: "0.0.129",
    hostKind: "browser",
    result: null,
    wasUpdating: false,
    ...overrides,
  };
}

const UPDATED: DaemonUpdateResult = { from: "0.0.129", to: "0.0.130", outcome: "updated", at: 1 };

describe("counts", () => {
  it("counts agents mid-turn or starting, and terminals that are not closed", () => {
    expect(countRunningAgents(["idle", "running", "initializing", "error", "closed"])).toBe(2);
    expect(countLiveTerminals([{ closed: false }, {}, { closed: true }])).toBe(2);
  });

  it("counts the daemon's own agent list, including an agent this client's store never saw", () => {
    expect(
      countRunningListedAgents([
        { status: "running" },
        { status: "initializing" },
        { status: "idle" },
        {},
        { status: "closed" },
      ]),
    ).toBe(2);
    expect(countRunningListedAgents([])).toBe(0);
  });

  it("words 0/0, N/M, singular and not-yet-counted terminals", () => {
    expect(impactText({ agents: 0, terminals: 0 })).toBe(
      "No agents are running and no terminals are open.",
    );
    expect(impactText({ agents: 3, terminals: 2 })).toBe(
      "3 agents running, 2 terminals open will stop.",
    );
    expect(impactText({ agents: 1, terminals: 1 })).toBe(
      "1 agent running, 1 terminal open will stop.",
    );
    expect(impactText({ agents: 0, terminals: 4 })).toBe(
      "0 agents running, 4 terminals open will stop.",
    );
    expect(impactText({ agents: 0, terminals: null })).toBe("Counting open terminals…");
    expect(impactText({ agents: 2, terminals: null })).toBe(
      "2 agents running will stop. Counting open terminals…",
    );
  });
});

describe("daemonUpdateDialogView", () => {
  it("confirms with the versions and 0/0 counts", () => {
    expect(daemonUpdateDialogView(input())).toEqual({
      kind: "confirm",
      title: "Update the daemon",
      versions: "0.0.129 → 0.0.130",
      impact: "No agents are running and no terminals are open.",
    });
  });

  it("confirms with N agents and M terminals", () => {
    const view = daemonUpdateDialogView(input({ impact: { agents: 2, terminals: 3 } }));
    expect(view).toMatchObject({
      kind: "confirm",
      impact: "2 agents running, 3 terminals open will stop.",
    });
  });

  it("shows installing as the first stage", () => {
    const view = daemonUpdateDialogView(
      input({ status: status({ kind: "installing", version: "0.0.130" }) }),
    );
    expect(view).toEqual({
      kind: "progress",
      title: "Update the daemon",
      stages: [
        { label: "Installing 0.0.130", state: "active" },
        { label: "Updating the Pi extensions", state: "pending" },
        { label: "Restarting the daemon", state: "pending" },
      ],
    });
  });

  it("shows updating_extensions as the second stage", () => {
    const view = daemonUpdateDialogView(
      input({ status: status({ kind: "updating_extensions", version: "0.0.130" }) }),
    );
    expect(view).toMatchObject({
      kind: "progress",
      stages: [
        { state: "done" },
        { label: "Updating the Pi extensions", state: "active" },
        { state: "pending" },
      ],
    });
  });

  it("shows restarting as the third stage while connected", () => {
    const view = daemonUpdateDialogView(
      input({ status: status({ kind: "restarting", version: "0.0.130" }) }),
    );
    expect(view).toMatchObject({
      kind: "restarting",
      stages: [{ state: "done" }, { state: "done" }, { state: "active" }],
    });
  });

  it("stays on restarting while the status is gone after a running update", () => {
    const view = daemonUpdateDialogView(input({ status: null, wasUpdating: true }));
    expect(view).toMatchObject({
      kind: "restarting",
      stages: [{ state: "done" }, { state: "done" }, { state: "active" }],
    });
  });

  it("says the status is unavailable when it is gone and nothing was running", () => {
    expect(daemonUpdateDialogView(input({ status: null }))).toMatchObject({ kind: "none" });
  });

  it("shows 'Updated to X' once the result is in", () => {
    const view = daemonUpdateDialogView(
      input({ status: status({ kind: "idle" }), result: UPDATED, pageVersion: "0.0.130" }),
    );
    expect(view).toEqual({
      kind: "result",
      title: "Update the daemon",
      text: "Updated to 0.0.130",
      tone: "success",
      reload: false,
    });
  });

  it("shows a rolled back result with the daemon's previous version and message", () => {
    const view = daemonUpdateDialogView(
      input({
        result: { ...UPDATED, outcome: "rolled_back", message: "did not answer" },
      }),
    );
    expect(view).toMatchObject({
      kind: "result",
      text: "The update failed; the daemon is back on 0.0.129",
      tone: "warning",
      message: "did not answer",
      reload: false,
    });
  });

  it("shows a failed result", () => {
    const view = daemonUpdateDialogView(
      input({ result: { ...UPDATED, outcome: "failed", message: "boom" } }),
    );
    expect(view).toMatchObject({
      kind: "result",
      text: "The update to 0.0.130 failed",
      tone: "danger",
      message: "boom",
    });
  });

  it("shows a failed install with the message, the command and a retry", () => {
    const view = daemonUpdateDialogView(
      input({
        status: status({
          kind: "failed",
          version: "0.0.130",
          code: "permission",
          message: "EACCES",
        }),
      }),
    );
    expect(view).toEqual({
      kind: "failed",
      title: "Update the daemon",
      text: "The install was not permitted; the daemon stays on 0.0.129.",
      message: "EACCES",
      command: MANUAL_UPDATE_COMMAND,
    });
  });

  it("omits the message of a failure that has none", () => {
    const view = daemonUpdateDialogView(
      input({ status: status({ kind: "failed", version: "0.0.130", code: "install" }) }),
    );
    expect(view).not.toHaveProperty("message");
  });

  it.each([
    ["docker", "Docker"],
    ["source", "repository checkout"],
    ["unknown_install", "not installed with npm install -g"],
    ["npm_missing", "npm was not found"],
    ["not_writable", "not writable"],
    ["unsupported_platform", "not supported"],
  ])("explains cannot_update(%s) and carries the command", (reason, fragment) => {
    const view = daemonUpdateDialogView(
      input({
        status: status({
          kind: "cannot_update",
          reason,
          version: "0.0.130",
          command: "run this",
        }),
      }),
    );
    expect(view).toMatchObject({ kind: "cannot_update", command: "run this", version: "0.0.130" });
    expect(view.kind === "cannot_update" && view.text).toContain(fragment);
  });

  it("shows nothing to do for idle", () => {
    expect(daemonUpdateDialogView(input({ status: status({ kind: "idle" }) }))).toEqual({
      kind: "none",
      title: "Update the daemon",
      text: "The daemon is up to date (0.0.129).",
    });
  });

  describe("reload note", () => {
    it("is on in a browser whose page version differs from the daemon's", () => {
      const view = daemonUpdateDialogView(input({ result: UPDATED, pageVersion: "0.0.129" }));
      expect(view).toMatchObject({ kind: "result", reload: true });
      expect(view.kind === "result" && view.reloadNote).toContain("0.0.129");
    });

    it("is off when the versions match", () => {
      const view = daemonUpdateDialogView(input({ result: UPDATED, pageVersion: "0.0.130" }));
      expect(view).toMatchObject({ kind: "result", reload: false });
      expect(view).not.toHaveProperty("reloadNote");
    });

    it("is off in the desktop app", () => {
      const view = daemonUpdateDialogView(input({ result: UPDATED, hostKind: "desktop" }));
      expect(view).toMatchObject({ kind: "result", reload: false });
    });

    it("is off when the page does not know its version", () => {
      const view = daemonUpdateDialogView(input({ result: UPDATED, pageVersion: "" }));
      expect(view).toMatchObject({ kind: "result", reload: false });
    });

    it("is off for a rolled back update (the daemon did not change)", () => {
      const view = daemonUpdateDialogView(
        input({ result: { ...UPDATED, outcome: "rolled_back" } }),
      );
      expect(view).toMatchObject({ kind: "result", reload: false });
    });
  });
});
