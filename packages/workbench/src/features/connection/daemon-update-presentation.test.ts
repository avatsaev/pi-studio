import { describe, expect, it } from "vitest";
import type { DaemonUpdateState, DaemonUpdateStatus } from "@av-pi-studio/protocol";
import {
  daemonUpdateView,
  failureCodeText,
  unavailableReasonText,
} from "./daemon-update-presentation.js";

function statusOf(state: DaemonUpdateState): DaemonUpdateStatus {
  return { currentVersion: "0.0.129", installKind: "npm-global", autoCheck: true, state };
}

describe("daemonUpdateView", () => {
  it("shows nothing while idle or checking", () => {
    expect(daemonUpdateView(statusOf({ kind: "idle" }))).toBeNull();
    expect(daemonUpdateView(statusOf({ kind: "checking" }))).toBeNull();
  });

  it("offers an available version in orange", () => {
    const view = daemonUpdateView(statusOf({ kind: "available", version: "0.0.130" }));

    expect(view).toMatchObject({ text: "Daemon 0.0.130", tone: "attention", icon: "download" });
    expect(view?.tooltip).toContain("0.0.129");
    expect(view?.tooltip).toContain("0.0.130");
  });

  it.each([
    [{ kind: "installing", version: "0.0.130" }, "Installing"],
    [{ kind: "updating_extensions", version: "0.0.130" }, "extensions"],
    [{ kind: "restarting", version: "0.0.130" }, "Restarting"],
  ] as const)("shows %j as grey progress", (state, tooltipPart) => {
    const view = daemonUpdateView(statusOf(state));

    expect(view).toMatchObject({ text: "Daemon updating", tone: "muted", icon: "progress" });
    expect(view?.tooltip).toContain(tooltipPart);
  });

  it("shows a failure in red with its cause in words", () => {
    const view = daemonUpdateView(
      statusOf({ kind: "failed", version: "0.0.130", code: "permission", message: "EACCES" }),
    );

    expect(view).toMatchObject({ text: "Daemon update failed", tone: "danger", icon: "alert" });
    expect(view?.tooltip).toContain("not permitted");
    expect(view?.tooltip).toContain("0.0.129");
  });

  it("shows a daemon that cannot update itself, grey, once a newer version is known", () => {
    const view = daemonUpdateView(
      statusOf({
        kind: "cannot_update",
        reason: "docker",
        version: "0.0.130",
        command: "docker compose pull && docker compose up -d",
      }),
    );

    expect(view).toMatchObject({
      text: "Daemon 0.0.130 available",
      tone: "muted",
      icon: "download",
    });
    expect(view?.tooltip).toContain("Docker");
  });

  it("shows nothing for cannot_update without a newer version", () => {
    expect(
      daemonUpdateView(
        statusOf({ kind: "cannot_update", reason: "source", command: "git pull && npm run build" }),
      ),
    ).toBeNull();
  });
});

describe("reason and failure texts", () => {
  it("words every documented reason and code", () => {
    for (const reason of [
      "docker",
      "source",
      "unknown_install",
      "npm_missing",
      "not_writable",
      "unsupported_platform",
      "unmanaged_binary",
    ]) {
      expect(unavailableReasonText(reason)).not.toContain(reason);
    }
    for (const code of ["install", "timeout", "permission", "network"]) {
      expect(failureCodeText(code)).not.toBe("The update failed");
    }
  });

  it("falls back for a reason or code a newer daemon adds", () => {
    expect(unavailableReasonText("snap")).toContain("snap");
    expect(failureCodeText("disk_full")).toBe("The update failed");
  });
});
