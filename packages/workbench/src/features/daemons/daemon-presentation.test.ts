import { describe, expect, it } from "vitest";
import { type LocalDaemonState, type RemoteDaemonState } from "../../host/types.js";
import {
  DAEMON_ERROR_CODES,
  INSTALL_CLI_COMMAND,
  UPDATE_CLI_COMMAND,
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
  { state: "cli_missing" },
  { state: "cli_missing", path: "/opt/bin/pi-studio" },
  { state: "cli_outdated", version: "0.0.100" },
  { state: "stopped" },
  { state: "starting" },
  { state: "stopping" },
  { state: "running", host: "127.0.0.1", port: 6767 },
  { state: "failed", reason: "not_healthy" },
  { state: "failed", reason: "timeout" },
  { state: "failed", reason: "bad_output" },
  { state: "updating" },
  { state: "failed", reason: "update_failed", output: "npm ERR!" },
  { state: "failed", reason: "spawn_failed" },
];

function kinds(state: LocalDaemonState): string[] {
  return localStateView(state).actions.map((a) => a.kind);
}

function actions(state: RemoteDaemonState): string[] {
  return remoteStateView(state).actions.map((a) => `${a.kind}:${a.call}`);
}

describe("remoteStateView", () => {
  it("offers Start for a stopped or failed daemon, and Retry for a probe", () => {
    expect(actions({ state: "stopped" })).toEqual(["start:start", "update:update"]);
    expect(actions({ state: "failed", reason: "timeout" })).toEqual([
      "start:start",
      "retry:refresh",
    ]);
    expect(actions({ state: "failed", reason: "no_shell" })).toEqual([
      "start:start",
      "retry:refresh",
    ]);
  });

  it("offers Retry (a new probe) for a missing or outdated CLI and an unchecked host", () => {
    expect(actions({ state: "not_installed" })).toEqual(["retry:refresh"]);
    expect(actions({ state: "cli_outdated", version: "0.0.100" })).toEqual([
      "update:update",
      "retry:refresh",
    ]);
    expect(actions({ state: "unknown" })).toEqual(["retry:refresh"]);
  });

  it("offers nothing while checking, starting or running", () => {
    expect(actions({ state: "checking" })).toEqual([]);
    expect(actions({ state: "starting" })).toEqual([]);
    expect(actions({ state: "running" })).toEqual([]);
  });

  it("offers Update for a stopped or outdated host and after a failed update", () => {
    expect(actions({ state: "stopped" })).toEqual(["start:start", "update:update"]);
    expect(actions({ state: "cli_outdated", version: "0.0.100" })).toEqual([
      "update:update",
      "retry:refresh",
    ]);
    expect(actions({ state: "failed", reason: "update_failed" })).toEqual([
      "update:update",
      "retry:refresh",
    ]);
  });

  it("shows a busy row without actions while updating", () => {
    expect(actions({ state: "updating" })).toEqual([]);
    expect(remoteStateView({ state: "updating" })).toMatchObject({
      label: "Updating…",
      tone: "busy",
    });
  });

  it("words each state and flags failures as errors", () => {
    expect(remoteStateView({ state: "not_installed" })).toMatchObject({
      label: "pi-studio is not installed on this host",
      tone: "error",
    });
    expect(remoteStateView({ state: "cli_outdated", version: "0.0.100" }).label).toContain(
      "0.0.100",
    );
    expect(remoteStateView({ state: "running" }).tone).toBe("ok");
    expect(remoteStateView({ state: "stopped" }).tone).toBe("neutral");
    expect(remoteStateView({ state: "starting" }).tone).toBe("busy");
    expect(remoteStateView({ state: "failed", reason: "exec_failed" }).tone).toBe("error");
  });
});

describe("remoteNeedsScreen", () => {
  it("is true exactly for stopped, not_installed, cli_outdated and failed (S8)", () => {
    expect(remoteNeedsScreen("stopped")).toBe(true);
    expect(remoteNeedsScreen("not_installed")).toBe(true);
    expect(remoteNeedsScreen("cli_outdated")).toBe(true);
    expect(remoteNeedsScreen("failed")).toBe(true);
    for (const state of ["unknown", "checking", "running", "starting", null] as const) {
      expect(remoteNeedsScreen(state)).toBe(false);
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
    expect(localStateView({ state: "cli_missing" }).label).toBe("The pi-studio CLI was not found");
    expect(localStateView({ state: "cli_missing", path: "/x/pi-studio" }).label).toContain(
      "/x/pi-studio",
    );
    expect(localStateView({ state: "cli_outdated", version: "0.0.100" }).label).toContain(
      "0.0.100",
    );
  });

  it("offers Start when stopped, Stop and Restart when running, Retry when something failed", () => {
    expect(kinds({ state: "stopped" })).toEqual(["start", "update"]);
    expect(kinds({ state: "running", host: "h", port: 1 })).toEqual(["stop", "restart"]);
    expect(kinds({ state: "failed", reason: "timeout" })).toEqual(["retry"]);
    expect(kinds({ state: "cli_missing" })).toEqual(["retry"]);
    expect(kinds({ state: "cli_outdated", version: "0.0.1" })).toEqual(["update", "retry"]);
  });

  it("offers nothing while checking, starting, stopping, or without local support", () => {
    for (const state of ["checking", "starting", "stopping", "unsupported"] as const) {
      expect(kinds({ state })).toEqual([]);
    }
  });

  it("points Retry at a probe for a missing CLI and at a start for a failed daemon", () => {
    expect(localStateView({ state: "cli_missing" }).actions[0]?.call).toBe("refresh");
    expect(localStateView({ state: "cli_outdated", version: "0.0.1" }).actions[1]?.call).toBe(
      "refresh",
    );
    expect(localStateView({ state: "failed", reason: "bad_output" }).actions[0]?.call).toBe(
      "start",
    );
  });

  it("offers Update for an outdated CLI and a stopped daemon, and after a failed update", () => {
    expect(kinds({ state: "cli_outdated", version: "0.0.1" })).toEqual(["update", "retry"]);
    expect(kinds({ state: "stopped" })).toEqual(["start", "update"]);
    expect(kinds({ state: "failed", reason: "update_failed", output: "x" })).toEqual([
      "update",
      "retry",
    ]);
    expect(localStateView({ state: "cli_outdated", version: "0.0.1" }).actions[0]?.call).toBe(
      "update",
    );
  });

  it("shows a busy row without actions while updating, and words a failed update", () => {
    expect(localStateView({ state: "updating" })).toEqual({
      label: "Updating…",
      tone: "busy",
      actions: [],
    });
    expect(localStateView({ state: "failed", reason: "update_failed" })).toMatchObject({
      label: "The update failed",
      tone: "error",
    });
  });

  it("flags failures as errors and a stopped daemon as neutral", () => {
    expect(localStateView({ state: "stopped" }).tone).toBe("neutral");
    expect(localStateView({ state: "running", host: "h", port: 1 }).tone).toBe("ok");
    expect(localStateView({ state: "failed", reason: "timeout" }).tone).toBe("error");
    expect(localStateView({ state: "cli_missing" }).tone).toBe("error");
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
        "cli_missing",
        "cli_outdated",
        "busy",
        "no_current",
        "local_stopped",
        "not_healthy",
        "timeout",
        "bad_output",
        "spawn_failed",
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

  it("gives the install command for a missing CLI and the update command for an old one", () => {
    const missing = daemonErrorView("cli_missing");
    expect(missing.command).toBe(INSTALL_CLI_COMMAND);
    expect(INSTALL_CLI_COMMAND).toBe("npm i -g @av-pi-studio/cli");
    expect(missing.detail).toContain("Node");
    expect(daemonErrorView("cli_outdated").command).toBe(UPDATE_CLI_COMMAND);
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
    expect(daemonFailureOf(Object.assign(new Error("cli_missing"), { code: "cli_missing" }))).toBe(
      "cli_missing",
    );
  });

  it("maps anything else to unexpected", () => {
    expect(daemonFailureOf(new Error("boom"))).toBe("unexpected");
    expect(daemonFailureOf(Object.assign(new Error("x"), { code: "toString" }))).toBe("unexpected");
    expect(daemonFailureOf("cli_missing")).toBe("unexpected");
    expect(daemonFailureOf(null)).toBe("unexpected");
  });

  it("recognises codes with isDaemonErrorCode", () => {
    expect(isDaemonErrorCode("busy")).toBe(true);
    expect(isDaemonErrorCode("unexpected")).toBe(false);
    expect(isDaemonErrorCode(undefined)).toBe(false);
  });
});
