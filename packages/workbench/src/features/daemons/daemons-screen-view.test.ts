import { describe, expect, it } from "vitest";
import {
  type DaemonEntryView,
  type LocalDaemonState,
  type RemoteDaemonState,
} from "../../host/types.js";
import {
  MIN_REMOTE_CLI_VERSION,
  REMOTE_INSTALL_COMMAND,
  UPDATE_CLI_COMMAND,
} from "./daemon-presentation.js";
import {
  bannerView,
  buildDaemonsScreenView,
  FILE_SECRET_STORE_NOTE,
  LINK_INVALID_LABEL,
  settingsFailureText,
} from "./daemons-screen-view.js";
import { type DaemonsSnapshot } from "./use-daemons.js";

const LOCAL: DaemonEntryView = {
  id: "local",
  kind: "local",
  name: "This machine",
  hasPassword: false,
};
const DIRECT_B: DaemonEntryView = {
  id: "b",
  kind: "direct",
  name: "Build box",
  address: "ws://10.0.0.2:6767",
  hasPassword: true,
};
const RELAY_C: DaemonEntryView = { id: "c", kind: "relay", name: "Office", hasPassword: false };

function snapshot(
  local: LocalDaemonState,
  currentId: string | null,
  entries: DaemonEntryView[] = [LOCAL, DIRECT_B, RELAY_C],
): DaemonsSnapshot {
  return {
    currentId,
    entries,
    local,
    remote: null,
    settings: { autoStartLocalDaemon: true },
  };
}

const SSH_D: DaemonEntryView = {
  id: "d",
  kind: "ssh",
  name: "Dev box",
  hasPassword: false,
  ssh: {
    host: "dev.example",
    user: "ana",
    port: 2222,
    daemonPort: 6767,
    hasSshPassword: false,
    hasPassphrase: false,
  },
};

function sshSnapshot(
  remote: RemoteDaemonState | null,
  currentId: string | null = "d",
): DaemonsSnapshot {
  return { ...snapshot({ state: "stopped" }, currentId, [LOCAL, SSH_D]), remote };
}

describe("the SSH row", () => {
  const rowOf = (remote: RemoteDaemonState | null, currentId: string | null = "d") =>
    buildDaemonsScreenView(sshSnapshot(remote, currentId), null).rows[1];

  it("is labelled SSH and shows user@host:port", () => {
    expect(rowOf({ state: "running" })).toMatchObject({
      kindLabel: "SSH",
      address: "ana@dev.example:2222",
    });
  });

  it("shows the state and Start for the current entry when the daemon is stopped", () => {
    const row = rowOf({ state: "stopped" });
    expect(row?.remote).toMatchObject({ label: "Stopped", tone: "neutral", notice: null });
    expect(row?.remote?.actions.map((a) => a.call)).toEqual(["start", "update"]);
    expect(row?.local).toBeNull();
  });

  it("offers Start and Retry after a failure", () => {
    const row = rowOf({ state: "failed", reason: "not_healthy" });
    expect(row?.remote?.actions.map((a) => a.call)).toEqual(["start", "refresh"]);
  });

  it("says pi-studio is not installed, with the command to copy and Retry", () => {
    const remote = rowOf({ state: "not_installed" })?.remote;
    expect(remote?.label).toBe("pi-studio is not installed on this host");
    expect(remote?.notice?.command).toBe("npm install -g @av-pi-studio/cli");
    expect(remote?.actions.map((a) => a.call)).toEqual(["refresh"]);
  });

  it("offers Update beside the command for an outdated CLI and shows a busy row while updating", () => {
    const outdated = rowOf({ state: "cli_outdated", version: "0.0.100" })?.remote;
    expect(outdated?.actions.map((a) => a.call)).toEqual(["update", "refresh"]);
    expect(rowOf({ state: "updating" })?.remote).toMatchObject({
      label: "Updating…",
      tone: "busy",
      actions: [],
      notice: null,
    });
  });

  it("shows the last lines of a failed update on the host", () => {
    const remote = rowOf({ state: "failed", reason: "update_failed", output: "EACCES" })?.remote;
    expect(remote?.label).toBe("The update failed");
    expect(remote?.notice).toEqual({
      text: "Run the update yourself, then retry.",
      command: REMOTE_INSTALL_COMMAND,
      output: "EACCES",
    });
    expect(remote?.actions.map((a) => a.call)).toEqual(["update", "refresh"]);
  });

  it("names both versions for an outdated CLI", () => {
    const remote = rowOf({ state: "cli_outdated", version: "0.0.100" })?.remote;
    expect(remote?.label).toContain("0.0.100");
    expect(remote?.notice?.text).toContain("0.0.100");
    expect(remote?.notice?.text).toContain(MIN_REMOTE_CLI_VERSION);
    expect(remote?.notice?.command).toBe(REMOTE_INSTALL_COMMAND);
  });

  it("has no state when it is not the current entry", () => {
    expect(rowOf(null, "local")?.remote).toBeNull();
  });
});

describe("buildDaemonsScreenView rows", () => {
  const view = buildDaemonsScreenView(snapshot({ state: "stopped" }, "b"), null);
  const [local, direct, relay] = view.rows;

  it("has one row per entry, in registry order, named and typed", () => {
    expect(view.rows.map((r) => [r.id, r.name, r.kindLabel])).toEqual([
      ["local", "This machine", "This machine"],
      ["b", "Build box", "Address"],
      ["c", "Office", "Relay"],
    ]);
  });

  it("marks the current entry only", () => {
    expect(view.rows.map((r) => r.current)).toEqual([false, true, false]);
  });

  it("gives the local entry Start and no Remove", () => {
    expect(local?.actions).toEqual(["open", "edit"]);
    expect(local?.local?.actions.map((a) => a.kind)).toEqual(["start", "update"]);
  });

  it("hides Open on the current entry", () => {
    expect(direct?.actions).toEqual(["edit", "remove"]);
  });

  it("offers Open, Edit and Remove on another entry", () => {
    expect(relay?.actions).toEqual(["open", "edit", "remove"]);
  });

  it("shows an address for a direct entry only, and local state for the local entry only", () => {
    expect(view.rows.map((r) => r.address)).toEqual([null, "ws://10.0.0.2:6767", null]);
    expect(view.rows.map((r) => r.local !== null)).toEqual([true, false, false]);
  });

  it("hides Open on the current local entry", () => {
    const current = buildDaemonsScreenView(snapshot({ state: "stopped" }, "local"), null);
    expect(current.rows[0]?.actions).toEqual(["edit"]);
  });

  it("has no current row when nothing is selected", () => {
    const none = buildDaemonsScreenView(snapshot({ state: "stopped" }, null), null);
    expect(none.rows.some((r) => r.current)).toBe(false);
    expect(none.rows.every((r) => r.actions.includes("open"))).toBe(true);
  });

  it("lists only the local entry when it is the only one", () => {
    const only = buildDaemonsScreenView(snapshot({ state: "stopped" }, "local", [LOCAL]), null);
    expect(only.rows).toHaveLength(1);
  });
});

function localRow(state: LocalDaemonState) {
  return buildDaemonsScreenView(snapshot(state, "b"), null).rows[0]!.local!;
}

describe("the local row", () => {
  it("takes its label, tone and actions from the local state", () => {
    const running = localRow({ state: "running", host: "127.0.0.1", port: 6767 });
    expect(running.label).toBe("Running on 127.0.0.1:6767");
    expect(running.tone).toBe("ok");
    expect(running.actions.map((a) => a.kind)).toEqual(["stop", "restart"]);
    expect(running.notice).toBeNull();
  });

  it("shows the found version and offers Update and Retry when the daemon is outdated", () => {
    const row = localRow({ state: "outdated", version: "0.0.100" });
    expect(row.notice?.text).toContain("0.0.100");
    expect(row.notice?.command).toBeUndefined();
    expect(row.actions.map((a) => a.kind)).toEqual(["update", "retry"]);
  });

  it("shows a busy row without actions while the daemon is downloaded and installed", () => {
    expect(localRow({ state: "downloading", received: 1, total: 4 })).toMatchObject({
      label: "Downloading the daemon… 25%",
      tone: "busy",
      actions: [],
      notice: null,
    });
    expect(localRow({ state: "installing" })).toMatchObject({
      label: "Installing the daemon…",
      tone: "busy",
      actions: [],
      notice: null,
    });
  });

  it("explains an unsupported system and offers nothing", () => {
    const row = localRow({ state: "unsupported" });
    expect(row.actions).toEqual([]);
    expect(row.notice?.text).toMatch(/macOS, Linux or WSL/);
    expect(row.notice?.command).toBeUndefined();
  });

  it("offers Retry when the daemon failed to start", () => {
    const row = localRow({ state: "failed", reason: "timeout" });
    expect(row.actions.map((a) => [a.kind, a.call])).toEqual([["retry", "start"]]);
  });

  it("shows a busy row without actions while updating", () => {
    const row = localRow({ state: "updating" });
    expect(row).toMatchObject({ label: "Updating…", tone: "busy", actions: [], notice: null });
  });

  it("shows the last lines of a failed install, and Update", () => {
    const row = localRow({
      state: "failed",
      reason: "install_failed",
      output: "\nunpack: refused\n",
    });
    expect(row.label).toBe("The daemon could not be installed");
    expect(row.notice).toEqual({
      text: "Update tries the install again.",
      output: "unpack: refused",
    });
    expect(row.actions.map((a) => a.call)).toEqual(["update", "refresh"]);
  });

  it("shows a failed download or checksum as a plain notice, and Update", () => {
    for (const reason of ["download_failed", "checksum_mismatch"] as const) {
      const row = localRow({ state: "failed", reason });
      expect(row.notice, reason).toEqual({ text: "Update tries the install again." });
      expect(
        row.actions.map((a) => a.call),
        reason,
      ).toEqual(["update", "refresh"]);
    }
  });
});

describe("the banner", () => {
  it("is absent without an error", () => {
    expect(buildDaemonsScreenView(snapshot({ state: "stopped" }, "local"), null).banner).toBeNull();
  });

  it("shows local_stopped as a plain state, not an error", () => {
    const banner = bannerView("local_stopped", { state: "stopped" });
    expect(banner?.tone).toBe("info");
    expect(banner?.message).toBe("The local daemon is stopped.");
  });

  it("shows no_current as a plain state too", () => {
    expect(bannerView("no_current", { state: "stopped" })?.tone).toBe("info");
  });

  it("carries the version for outdated, and a remote host's old CLI keeps the update command", () => {
    const banner = bannerView("outdated", { state: "outdated", version: "0.0.100" });
    expect(banner?.tone).toBe("error");
    expect(banner?.command).toBeUndefined();
    expect(banner?.detail).toContain("0.0.100");
    expect(bannerView("cli_outdated", { state: "stopped" })?.command).toBe(UPDATE_CLI_COMMAND);
  });

  it("leaves the detail alone when the local state no longer says which version", () => {
    expect(bannerView("outdated", { state: "stopped" })?.detail).toBe("Update it, then retry.");
  });

  it("words an action failure with the message of the code", () => {
    expect(bannerView("busy", { state: "starting" })).toMatchObject({
      message: "Another action on the local daemon is still running.",
      tone: "error",
    });
    expect(bannerView("not_found", { state: "stopped" })?.message).toBe(
      "This daemon no longer exists.",
    );
  });

  it("is built into the view from the store's error", () => {
    const view = buildDaemonsScreenView(snapshot({ state: "stopped" }, "local"), "spawn_failed");
    expect(view.banner?.message).toBe("The pi-studio CLI could not be run.");
  });
});

describe("settingsFailureText", () => {
  it("words a known code", () => {
    expect(settingsFailureText(Object.assign(new Error("busy"), { code: "busy" }))).toBe(
      "Another action on the local daemon is still running.",
    );
  });

  it("shows the host's own reason otherwise", () => {
    expect(settingsFailureText(new Error("The path is not absolute."))).toBe(
      "The path is not absolute.",
    );
  });

  it("falls back to a generic sentence", () => {
    expect(settingsFailureText(new Error(" "))).toBe("This setting could not be saved.");
    expect(settingsFailureText("nope")).toBe("This setting could not be saved.");
  });
});

describe("buildDaemonsScreenView pairing link marker", () => {
  const marked = new Set(["c"]);

  it("marks a relay row and offers Replace link first after Open", () => {
    const view = buildDaemonsScreenView(snapshot({ state: "stopped" }, "b"), null, marked);
    const relay = view.rows.find((row) => row.id === "c");

    expect(relay?.linkInvalid).toBe(true);
    expect(relay?.actions).toEqual(["open", "replaceLink", "edit", "remove"]);
    expect(LINK_INVALID_LABEL).toBe("Pairing link no longer valid");
  });

  it("marks nothing without a marker, or on a non-relay id", () => {
    const plain = buildDaemonsScreenView(snapshot({ state: "stopped" }, "b"), null);
    const wrong = buildDaemonsScreenView(snapshot({ state: "stopped" }, "b"), null, new Set(["b"]));

    expect(plain.rows.every((row) => !row.linkInvalid)).toBe(true);
    expect(wrong.rows.every((row) => !row.linkInvalid)).toBe(true);
    expect(plain.rows.find((row) => row.id === "c")?.actions).toEqual(["open", "edit", "remove"]);
  });
});

describe("the secret store line", () => {
  const stopped: LocalDaemonState = { state: "stopped" };

  it("says secrets are in a file when the host keeps them there", () => {
    const view = buildDaemonsScreenView({ ...snapshot(stopped, "b"), secretStore: "file" }, null);
    expect(view.secretStoreNote).toBe(FILE_SECRET_STORE_NOTE);
    expect(FILE_SECRET_STORE_NOTE).toMatch(/file only this user can read/);
    expect(FILE_SECRET_STORE_NOTE).toMatch(/no keychain is available/);
  });

  it("says nothing for the keychain", () => {
    const view = buildDaemonsScreenView(
      { ...snapshot(stopped, "b"), secretStore: "keychain" },
      null,
    );
    expect(view.secretStoreNote).toBeNull();
  });

  it("says nothing when the host does not report it", () => {
    expect(buildDaemonsScreenView(snapshot(stopped, "b"), null).secretStoreNote).toBeNull();
  });
});
