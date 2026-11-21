import { describe, expect, it } from "vitest";
import { type LocalDaemonState } from "../../host/types.js";
import {
  DAEMON_ERROR_CODES,
  INSTALL_CLI_COMMAND,
  UPDATE_CLI_COMMAND,
  daemonErrorView,
  daemonFailureOf,
  isDaemonErrorCode,
  localStateView,
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
  { state: "failed", reason: "spawn_failed" },
];

function kinds(state: LocalDaemonState): string[] {
  return localStateView(state).actions.map((a) => a.kind);
}

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
    expect(kinds({ state: "stopped" })).toEqual(["start"]);
    expect(kinds({ state: "running", host: "h", port: 1 })).toEqual(["stop", "restart"]);
    expect(kinds({ state: "failed", reason: "timeout" })).toEqual(["retry"]);
    expect(kinds({ state: "cli_missing" })).toEqual(["retry"]);
    expect(kinds({ state: "cli_outdated", version: "0.0.1" })).toEqual(["retry"]);
  });

  it("offers nothing while checking, starting, stopping, or without local support", () => {
    for (const state of ["checking", "starting", "stopping", "unsupported"] as const) {
      expect(kinds({ state })).toEqual([]);
    }
  });

  it("points Retry at a probe for a missing CLI and at a start for a failed daemon", () => {
    expect(localStateView({ state: "cli_missing" }).actions[0]?.call).toBe("refresh");
    expect(localStateView({ state: "cli_outdated", version: "0.0.1" }).actions[0]?.call).toBe(
      "refresh",
    );
    expect(localStateView({ state: "failed", reason: "bad_output" }).actions[0]?.call).toBe(
      "start",
    );
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
