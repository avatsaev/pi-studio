import { describe, expect, it } from "vitest";
import type { DaemonUpdateStatus } from "@av-pi-studio/protocol";
import {
  daemonSettingsView,
  installKindText,
  lastCheckedText,
  type DaemonSettingsView,
} from "./daemon-settings-view.js";

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

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

function view(
  state: DaemonUpdateStatus["state"],
  extra: Partial<DaemonUpdateStatus> = {},
  pendingAutoCheck: boolean | null = null,
): DaemonSettingsView {
  return daemonSettingsView({ status: status(state, extra), pendingAutoCheck, now: NOW });
}

describe("lastCheckedText", () => {
  it("says Never without a check", () => {
    expect(lastCheckedText(undefined, NOW)).toBe("Never");
  });

  it("is coarse: just now, minutes, hours, days", () => {
    expect(lastCheckedText(NOW - 20_000, NOW)).toBe("Just now");
    expect(lastCheckedText(NOW - MINUTE, NOW)).toBe("1 minute ago");
    expect(lastCheckedText(NOW - 59 * MINUTE, NOW)).toBe("59 minutes ago");
    expect(lastCheckedText(NOW - HOUR, NOW)).toBe("1 hour ago");
    expect(lastCheckedText(NOW - 23 * HOUR, NOW)).toBe("23 hours ago");
    expect(lastCheckedText(NOW - 3 * DAY, NOW)).toBe("3 days ago");
  });

  it("treats a check stamped after our clock as just now", () => {
    expect(lastCheckedText(NOW + 5 * MINUTE, NOW)).toBe("Just now");
  });
});

describe("installKindText", () => {
  it("names each install kind and passes an unknown one through", () => {
    expect(installKindText("npm-global")).toBe("npm (global install)");
    expect(installKindText("docker")).toBe("Docker");
    expect(installKindText("source")).toBe("Repository checkout");
    expect(installKindText("unknown")).toBe("Unknown");
    expect(installKindText("snap")).toBe("snap");
  });
});

describe("daemonSettingsView rows", () => {
  it("idle: version, install kind, never checked, up to date, no action", () => {
    const v = view({ kind: "idle" });
    expect(v).toEqual({
      version: "0.0.129",
      installKind: "npm (global install)",
      lastChecked: "Never",
      autoCheck: true,
      checkDisabled: false,
      update: { text: "Up to date", tone: "success" },
    });
  });

  it("shows the last check's age", () => {
    expect(view({ kind: "idle" }, { checkedAt: NOW - 5 * MINUTE }).lastChecked).toBe(
      "5 minutes ago",
    );
  });

  it("checking: says so and disables Check now", () => {
    const v = view({ kind: "checking" });
    expect(v.update).toEqual({ text: "Checking for updates…", tone: "muted" });
    expect(v.checkDisabled).toBe(true);
  });

  it("available: names the version and offers the update", () => {
    const v = view({ kind: "available", version: "0.0.130" });
    expect(v.update).toEqual({
      text: "Daemon 0.0.130 is available.",
      tone: "attention",
      action: "Update…",
    });
    expect(v.checkDisabled).toBe(false);
  });

  it.each(["installing", "updating_extensions", "restarting"] as const)(
    "%s: shows the running update and disables Check now",
    (kind) => {
      const v = view({ kind, version: "0.0.130" });
      expect(v.update).toEqual({
        text: "Updating to 0.0.130…",
        tone: "muted",
        action: "Show progress",
      });
      expect(v.checkDisabled).toBe(true);
    },
  );

  it("failed: the failure in words, the version it stays on, a Details action", () => {
    const v = view({ kind: "failed", version: "0.0.130", code: "permission" });
    expect(v.update).toEqual({
      text: "The install was not permitted; the daemon stays on 0.0.129.",
      tone: "danger",
      action: "Details",
    });
    expect(v.checkDisabled).toBe(false);
  });

  it("cannot_update with a version: the reason in words and a way to the command", () => {
    const v = view({
      kind: "cannot_update",
      reason: "docker",
      version: "0.0.130",
      command: "docker compose pull && docker compose up -d",
    });
    expect(v.installKind).toBe("npm (global install)");
    expect(v.update.text).toBe(
      "Daemon 0.0.130 is available. This daemon runs in Docker; update its image instead.",
    );
    expect(v.update.tone).toBe("muted");
    expect(v.update.action).toBe("How to update");
  });

  it("cannot_update without a newer version: nothing to install, so no reason", () => {
    const v = view(
      { kind: "cannot_update", reason: "docker", command: "docker compose pull" },
      { installKind: "docker" },
    );
    expect(v.installKind).toBe("Docker");
    expect(v.update).toEqual({ text: "Up to date", tone: "success" });
  });
});

describe("daemonSettingsView check error", () => {
  it("is absent when the last check did not fail", () => {
    expect("checkError" in view({ kind: "idle" })).toBe(false);
  });

  it("puts the last check's failure in words", () => {
    expect(view({ kind: "idle" }, { checkError: "offline" }).checkError).toBe(
      "Could not reach the npm registry from the daemon's host.",
    );
    expect(view({ kind: "idle" }, { checkError: "bad_answer" }).checkError).toBe(
      "The npm registry gave an answer the daemon could not read.",
    );
  });
});

describe("daemonSettingsView switch", () => {
  it("reads the daemon's value", () => {
    expect(view({ kind: "idle" }, { autoCheck: false }).autoCheck).toBe(false);
    expect(view({ kind: "idle" }, { autoCheck: true }).autoCheck).toBe(true);
  });

  it("shows the optimistic value while a request is out, either way", () => {
    expect(view({ kind: "idle" }, { autoCheck: true }, false).autoCheck).toBe(false);
    expect(view({ kind: "idle" }, { autoCheck: false }, true).autoCheck).toBe(true);
  });
});
