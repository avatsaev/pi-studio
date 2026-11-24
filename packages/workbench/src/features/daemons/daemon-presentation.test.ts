import { describe, expect, it } from "vitest";
import { type LocalDaemonState, type RemoteDaemonState } from "../../host/types.js";
import {
  DAEMON_ERROR_CODES,
  daemonErrorView,
  daemonFailureOf,
  isDaemonErrorCode,
  localStateView,
  remoteNeedsScreen,
  remoteStateView,
} from "./daemon-presentation.js";

const ALL_LOCAL_STATES: LocalDaemonState[] = [
  { state: "checking" },
  { state: "unsupported" },
  { state: "outdated", version: "0.0.100" },
  { state: "downloading", received: 0, total: 0 },
  { state: "downloading", received: 1024, total: 2048 },
  { state: "installing" },
  { state: "stopped" },
  { state: "starting" },
  { state: "stopping" },
  { state: "running", host: "127.0.0.1", port: 6767 },
  { state: "failed", reason: "not_healthy" },
  { state: "failed", reason: "timeout" },
  { state: "failed", reason: "bad_output" },
  { state: "updating" },
  { state: "failed", reason: "install_failed", output: "unpack failed" },
  { state: "failed", reason: "download_failed" },
  { state: "failed", reason: "checksum_mismatch" },
  { state: "failed", reason: "spawn_failed" },
];

function kinds(state: LocalDaemonState): string[] {
  return localStateView(state).actions.map((a) => a.kind);
}

function downloadingLabel(received: number, total: number): string {
  return localStateView({ state: "downloading", received, total }).label;
}

function actions(state: RemoteDaemonState): string[] {
  return remoteStateView(state).actions.map((a) => `${a.kind}:${a.call}`);
}

function installingLabel(stage: "downloading" | "sending", done: number, total: number): string {
  return remoteStateView({ state: "installing", stage, done, total }).label;
}

describe("remoteStateView", () => {
  it("offers Start and Update for a stopped daemon", () => {
    expect(actions({ state: "stopped" })).toEqual(["start:start", "update:update"]);
  });

  it("offers Install for a host with nothing installed, with no shell command", () => {
    expect(actions({ state: "not_installed" })).toEqual(["install:install"]);
    expect(remoteStateView({ state: "not_installed" })).toMatchObject({
      label: "pi-studio is not installed on this host",
      tone: "error",
    });
  });

  it("offers Update and a new probe for an outdated daemon", () => {
    expect(actions({ state: "outdated", version: "0.0.100" })).toEqual([
      "update:update",
      "retry:refresh",
    ]);
    expect(remoteStateView({ state: "outdated", version: "0.0.100" }).label).toContain("0.0.100");
  });

  it("offers a probe for an unchecked host", () => {
    expect(actions({ state: "unknown" })).toEqual(["retry:refresh"]);
  });

  it("says the system is not supported and offers no button", () => {
    const view = remoteStateView({ state: "unsupported", system: "Linux x86_64 (musl)" });
    expect(view.label).toBe("This system is not supported (Linux x86_64 (musl))");
    expect(view.tone).toBe("error");
    expect(view.actions).toEqual([]);
  });

  it("offers nothing while checking, starting or running", () => {
    expect(actions({ state: "checking" })).toEqual([]);
    expect(actions({ state: "starting" })).toEqual([]);
    expect(actions({ state: "running" })).toEqual([]);
  });

  it("shows the stage, with a percentage while bytes move, and no buttons while installing", () => {
    expect(remoteStateView({ state: "installing", stage: "downloading" })).toMatchObject({
      label: "Downloading the daemon",
      tone: "busy",
      actions: [],
    });
    expect(installingLabel("downloading", 512, 2048)).toBe("Downloading the daemon · 25 %");
    expect(installingLabel("sending", 1024, 2048)).toBe("Sending the daemon to the host · 50 %");
    expect(installingLabel("sending", 5, 0)).toBe("Sending the daemon to the host");
    expect(installingLabel("sending", 9, 4)).toBe("Sending the daemon to the host · 100 %");
    expect(remoteStateView({ state: "installing", stage: "unpacking" }).label).toBe(
      "Unpacking the daemon on the host",
    );
    expect(remoteStateView({ state: "installing", stage: "starting" }).label).toBe(
      "Starting the daemon",
    );
  });

  it("offers Retry that installs again after a failed install, and Retry that starts after a failed start", () => {
    for (const reason of [
      "download_failed",
      "checksum_mismatch",
      "send_failed",
      "install_failed",
    ] as const) {
      expect(actions({ state: "failed", reason }), reason).toEqual(["retry:install"]);
    }
    for (const reason of [
      "not_healthy",
      "timeout",
      "bad_output",
      "exec_failed",
      "no_shell",
    ] as const) {
      expect(actions({ state: "failed", reason }), reason).toEqual(["retry:start"]);
    }
  });

  it("words every failure and flags it as an error", () => {
    for (const reason of [
      "not_healthy",
      "timeout",
      "bad_output",
      "exec_failed",
      "no_shell",
      "download_failed",
      "checksum_mismatch",
      "send_failed",
      "install_failed",
    ] as const) {
      const view = remoteStateView({ state: "failed", reason });
      expect(view.label.length, reason).toBeGreaterThan(0);
      expect(view.tone, reason).toBe("error");
    }
    expect(remoteStateView({ state: "running" }).tone).toBe("ok");
    expect(remoteStateView({ state: "stopped" }).tone).toBe("neutral");
    expect(remoteStateView({ state: "starting" }).tone).toBe("busy");
  });

  it("words a checksum failure without saying where it was found: the app's own download fails it too", () => {
    expect(remoteStateView({ state: "failed", reason: "checksum_mismatch" }).label).toBe(
      "The file did not match its checksum and was deleted",
    );
  });
});

describe("remoteNeedsScreen", () => {
  it("is true exactly for stopped, not_installed, outdated, unsupported and failed (S8)", () => {
    for (const state of [
      "stopped",
      "not_installed",
      "outdated",
      "unsupported",
      "failed",
    ] as const) {
      expect(remoteNeedsScreen(state), state).toBe(true);
    }
    for (const state of [
      "unknown",
      "checking",
      "running",
      "starting",
      "installing",
      null,
    ] as const) {
      expect(remoteNeedsScreen(state), String(state)).toBe(false);
    }
  });
});

describe("localStateView", () => {
  it("labels every local state", () => {
    for (const state of ALL_LOCAL_STATES) {
      expect(localStateView(state).label.length, JSON.stringify(state)).toBeGreaterThan(0);
    }
  });

  it("reads the way the screen words it", () => {
    expect(localStateView({ state: "running", host: "127.0.0.1", port: 6767 }).label).toBe(
      "Running on 127.0.0.1:6767",
    );
    expect(localStateView({ state: "running", host: "::1", port: 6767 }).label).toBe(
      "Running on [::1]:6767",
    );
    expect(localStateView({ state: "stopped" }).label).toBe("Stopped");
    expect(localStateView({ state: "starting" }).label).toBe("Starting…");
    expect(localStateView({ state: "outdated", version: "0.0.100" }).label).toContain("0.0.100");
    expect(localStateView({ state: "downloading", received: 1024, total: 2048 }).label).toBe(
      "Downloading the daemon · 50 %",
    );
    expect(localStateView({ state: "downloading", received: 0, total: 0 }).label).toBe(
      "Downloading the daemon",
    );
    expect(localStateView({ state: "installing" }).label).toBe("Installing the daemon");
  });

  it("offers Start only when stopped, Stop and Restart when running, Retry when something failed", () => {
    expect(kinds({ state: "stopped" })).toEqual(["start"]);
    expect(kinds({ state: "running", host: "h", port: 1 })).toEqual(["stop", "restart"]);
    expect(kinds({ state: "failed", reason: "timeout" })).toEqual(["retry"]);
    expect(kinds({ state: "outdated", version: "0.0.1" })).toEqual(["update", "retry"]);
  });

  it("offers nothing while checking, downloading, installing, starting, stopping, or without local support", () => {
    for (const state of [
      "checking",
      "installing",
      "starting",
      "stopping",
      "unsupported",
    ] as const) {
      expect(kinds({ state })).toEqual([]);
    }
    expect(kinds({ state: "downloading", received: 1, total: 2 })).toEqual([]);
  });

  it("points Retry at a probe for an outdated daemon and at a start for every failure", () => {
    expect(localStateView({ state: "outdated", version: "0.0.1" }).actions[1]?.call).toBe(
      "refresh",
    );
    for (const reason of [
      "not_healthy",
      "timeout",
      "bad_output",
      "spawn_failed",
      "download_failed",
      "checksum_mismatch",
      "install_failed",
    ] as const) {
      expect(localStateView({ state: "failed", reason }).actions, reason).toEqual([
        { kind: "retry", label: "Retry", call: "start" },
      ]);
    }
  });

  it("offers Update for an outdated daemon only, Start alone for a stopped one, and only Retry after a failed download or install", () => {
    expect(kinds({ state: "outdated", version: "0.0.1" })).toEqual(["update", "retry"]);
    expect(kinds({ state: "stopped" })).toEqual(["start"]);
    for (const reason of ["download_failed", "checksum_mismatch", "install_failed"] as const) {
      expect(kinds({ state: "failed", reason, output: "x" }), reason).toEqual(["retry"]);
    }
    expect(localStateView({ state: "outdated", version: "0.0.1" }).actions[0]?.call).toBe("update");
  });

  it("shows a busy row without actions while updating", () => {
    expect(localStateView({ state: "updating" })).toEqual({
      label: "Updating…",
      tone: "busy",
      actions: [],
    });
  });

  it("words a failed download, checksum and install in plain words", () => {
    expect(localStateView({ state: "failed", reason: "download_failed" })).toMatchObject({
      label: "The download failed",
      tone: "error",
    });
    expect(localStateView({ state: "failed", reason: "checksum_mismatch" }).label).toBe(
      "The file did not match its checksum and was deleted",
    );
    expect(
      localStateView({ state: "failed", reason: "install_failed", output: "unpack: refused" })
        .label,
    ).toBe("Installing the daemon failed");
    expect(localStateView({ state: "failed", reason: "spawn_failed" }).label).toBe(
      "The daemon could not be run",
    );
  });

  it("says Downloading the daemon with a whole percentage, capped at 100, and none for an unknown size", () => {
    expect(downloadingLabel(0, 100)).toBe("Downloading the daemon · 0 %");
    expect(downloadingLabel(42_999, 100_000)).toBe("Downloading the daemon · 42 %");
    expect(downloadingLabel(100, 100)).toBe("Downloading the daemon · 100 %");
    expect(downloadingLabel(150, 100)).toBe("Downloading the daemon · 100 %");
    expect(downloadingLabel(5, 0)).toBe("Downloading the daemon");
  });

  it("flags failures as errors and a stopped daemon as neutral", () => {
    expect(localStateView({ state: "stopped" }).tone).toBe("neutral");
    expect(localStateView({ state: "running", host: "h", port: 1 }).tone).toBe("ok");
    expect(localStateView({ state: "failed", reason: "timeout" }).tone).toBe("error");
    expect(localStateView({ state: "outdated", version: "0.0.1" }).tone).toBe("error");
    expect(localStateView({ state: "downloading", received: 1, total: 2 }).tone).toBe("busy");
    expect(localStateView({ state: "installing" }).tone).toBe("busy");
  });
});

describe("daemonErrorView", () => {
  it("has a message for every error code", () => {
    expect(DAEMON_ERROR_CODES.length).toBeGreaterThan(0);
    for (const code of DAEMON_ERROR_CODES) {
      expect(daemonErrorView(code).message.length, code).toBeGreaterThan(0);
    }
    expect(daemonErrorView("unexpected").message.length).toBeGreaterThan(0);
  });

  it("names every code the contract lists", () => {
    expect([...DAEMON_ERROR_CODES].toSorted()).toEqual(
      [
        "invalid_name",
        "name_taken",
        "invalid_address",
        "invalid_link",
        "too_many",
        "not_found",
        "wrong_kind",
        "local_not_removable",
        "unsupported",
        "outdated",
        "install_not_offered",
        "busy",
        "no_current",
        "local_stopped",
        "not_healthy",
        "timeout",
        "bad_output",
        "spawn_failed",
        "download_failed",
        "checksum_mismatch",
        "install_failed",
        "secret_missing",
        "secret_unavailable",
        "secret_store_failed",
        "invalid_host",
        "invalid_user",
        "invalid_port",
        "invalid_path",
        "invalid_jump",
        "not_installed",
        "ssh_config",
      ].toSorted(),
    );
  });

  it("offers no shell command for an old or missing daemon: the host's own Install and Update do it", () => {
    expect(daemonErrorView("not_installed")).not.toHaveProperty("command");
    expect(daemonErrorView("outdated")).not.toHaveProperty("command");
    expect(daemonErrorView("install_not_offered").message).toMatch(/cannot be installed/);
  });

  it("explains that a local daemon needs macOS, Linux or WSL", () => {
    const view = daemonErrorView("unsupported");
    expect(`${view.message} ${view.detail}`).toMatch(/macOS, Linux or WSL/);
  });

  it("shows a stopped local daemon as a plain state, every other code as an error", () => {
    expect(daemonErrorView("local_stopped").isError).toBe(false);
    for (const code of DAEMON_ERROR_CODES.filter(
      (c) => c !== "local_stopped" && c !== "no_current",
    )) {
      expect(daemonErrorView(code).isError, code).toBe(true);
    }
  });
});

describe("daemonFailureOf", () => {
  it("reads the code of a DaemonError-shaped rejection", () => {
    expect(daemonFailureOf(Object.assign(new Error("outdated"), { code: "outdated" }))).toBe(
      "outdated",
    );
  });

  it("maps anything else to unexpected", () => {
    expect(daemonFailureOf(new Error("boom"))).toBe("unexpected");
    expect(daemonFailureOf(Object.assign(new Error("x"), { code: "toString" }))).toBe("unexpected");
    expect(daemonFailureOf("outdated")).toBe("unexpected");
    expect(daemonFailureOf(null)).toBe("unexpected");
  });

  it("recognises codes with isDaemonErrorCode", () => {
    expect(isDaemonErrorCode("busy")).toBe(true);
    expect(isDaemonErrorCode("unexpected")).toBe(false);
    expect(isDaemonErrorCode(undefined)).toBe(false);
  });
});
