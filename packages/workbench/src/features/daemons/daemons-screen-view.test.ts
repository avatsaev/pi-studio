import { describe, expect, it } from "vitest";
import {
  type DaemonEntryView,
  type LocalDaemonState,
  type RemoteDaemonState,
} from "../../host/types.js";
import {
  bannerView,
  buildDaemonsScreenView,
  FILE_SECRET_STORE_NOTE,
  LINK_INVALID_LABEL,
  OUTPUT_MAX_CHARS,
  OUTPUT_MAX_LINES,
  settingsFailureText,
  truncateOutput,
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

  it("offers Retry that starts again after a failed start", () => {
    const row = rowOf({ state: "failed", reason: "not_healthy" });
    expect(row?.remote?.actions.map((a) => `${a.kind}:${a.call}`)).toEqual(["retry:start"]);
    expect(row?.remote?.notice).toBeNull();
  });

  it("offers Install, and no npm instruction, when nothing is installed", () => {
    const remote = rowOf({ state: "not_installed" })?.remote;
    expect(remote?.label).toBe("pi-studio is not installed on this host");
    expect(remote?.actions.map((a) => `${a.kind}:${a.call}`)).toEqual(["install:install"]);
    expect(remote?.notice?.text).toMatch(/^Install copies the pi-studio daemon/);
    expect(remote?.notice).not.toHaveProperty("command");
    expect(JSON.stringify(remote)).not.toMatch(/npm|Node\.js/);
  });

  it("offers Update and Retry for an outdated daemon and names the version it found", () => {
    const remote = rowOf({ state: "outdated", version: "0.0.100" })?.remote;
    expect(remote?.actions.map((a) => a.call)).toEqual(["update", "refresh"]);
    expect(remote?.label).toContain("0.0.100");
    expect(remote?.notice?.text).toContain("Found version 0.0.100");
  });

  it("shows the stage and the percentage while installing, with no buttons and no notice", () => {
    expect(
      rowOf({ state: "installing", stage: "sending", done: 1, total: 4 })?.remote,
    ).toMatchObject({
      label: "Sending the daemon to the host · 25 %",
      tone: "busy",
      actions: [],
      notice: null,
    });
  });

  it("says the system is not supported, with no button and no notice", () => {
    expect(rowOf({ state: "unsupported", system: "Linux x86_64 (musl)" })?.remote).toMatchObject({
      label: "This system is not supported (Linux x86_64 (musl))",
      tone: "error",
      actions: [],
      notice: null,
    });
  });

  it("shows the reason and the last lines the host printed for a failed install, and Retry installs again", () => {
    const remote = rowOf({
      state: "failed",
      reason: "install_failed",
      output: "tar: not found",
    })?.remote;
    expect(remote?.label).toBe("Installing the daemon on the host failed");
    expect(remote?.notice).toEqual({
      text: "Retry installs the daemon again.",
      output: "tar: not found",
    });
    expect(remote?.actions.map((a) => `${a.kind}:${a.call}`)).toEqual(["retry:install"]);
  });

  it("explains each failed step of an install", () => {
    const text = (reason: "download_failed" | "checksum_mismatch" | "send_failed") =>
      rowOf({ state: "failed", reason })?.remote?.notice;
    expect(text("download_failed")).toEqual({ text: "Check the internet connection, then retry." });
    expect(text("checksum_mismatch")).toEqual({
      text: "The file was not unpacked. Retry downloads it again.",
    });
    expect(
      rowOf({ state: "failed", reason: "send_failed", output: "No space left" })?.remote,
    ).toMatchObject({
      label: "Sending the daemon to the host failed",
      notice: { text: "Retry sends the daemon to the host again.", output: "No space left" },
    });
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
    expect(local?.local?.actions.map((a) => a.kind)).toEqual(["start"]);
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
    expect(row.notice).not.toHaveProperty("command");
    expect(row.actions.map((a) => a.kind)).toEqual(["update", "retry"]);
  });

  it("shows a busy row without actions while the daemon is downloaded and installed", () => {
    expect(localRow({ state: "downloading", received: 1, total: 4 })).toMatchObject({
      label: "Downloading the daemon · 25 %",
      tone: "busy",
      actions: [],
      notice: null,
    });
    expect(localRow({ state: "installing" })).toMatchObject({
      label: "Installing the daemon",
      tone: "busy",
      actions: [],
      notice: null,
    });
  });

  it("explains an unsupported system and offers nothing", () => {
    const row = localRow({ state: "unsupported" });
    expect(row.actions).toEqual([]);
    expect(row.notice?.text).toMatch(/macOS, Linux or WSL/);
    expect(row.notice).not.toHaveProperty("command");
  });

  it("offers Retry when the daemon failed to start", () => {
    const row = localRow({ state: "failed", reason: "timeout" });
    expect(row.actions.map((a) => [a.kind, a.call])).toEqual([["retry", "start"]]);
  });

  it("shows a busy row without actions while updating", () => {
    const row = localRow({ state: "updating" });
    expect(row).toMatchObject({ label: "Updating…", tone: "busy", actions: [], notice: null });
  });

  it("shows what a failed install printed, and offers Retry only", () => {
    const row = localRow({
      state: "failed",
      reason: "install_failed",
      output: "\nunpack: refused\n",
    });
    expect(row.label).toBe("Installing the daemon failed");
    expect(row.tone).toBe("error");
    expect(row.notice).toEqual({
      text: "Retry installs the daemon again.",
      output: "unpack: refused",
    });
    expect(row.actions.map((a) => [a.kind, a.call])).toEqual([["retry", "start"]]);
  });

  it("shows a failed install without output as a plain notice", () => {
    const row = localRow({ state: "failed", reason: "install_failed" });
    expect(row.notice).toEqual({ text: "Retry installs the daemon again." });
  });

  it("shows a failed download and a checksum mismatch in plain words, and offers Retry", () => {
    const download = localRow({ state: "failed", reason: "download_failed" });
    expect(download.label).toBe("The download failed");
    expect(download.notice).toEqual({ text: "Check the internet connection, then retry." });
    const checksum = localRow({ state: "failed", reason: "checksum_mismatch" });
    expect(checksum.label).toBe("The file did not match its checksum and was deleted");
    expect(checksum.notice).toEqual({
      text: "The file was not unpacked. Retry downloads it again.",
    });
    for (const row of [download, checksum]) {
      expect(row.actions.map((a) => [a.kind, a.call])).toEqual([["retry", "start"]]);
    }
  });

  it("shows no notice for a failed start", () => {
    expect(localRow({ state: "failed", reason: "spawn_failed" }).notice).toBeNull();
  });
});

describe("truncateOutput", () => {
  it("keeps short output as it is, without blank lines or trailing spaces", () => {
    expect(truncateOutput("a  \n\n b\n")).toBe("a\n b");
  });

  it("is undefined for nothing or only blank lines", () => {
    expect(truncateOutput(undefined)).toBeUndefined();
    expect(truncateOutput(" \n\n")).toBeUndefined();
  });

  it("keeps the last lines", () => {
    const lines = Array.from({ length: OUTPUT_MAX_LINES + 3 }, (_, i) => `line ${i}`);
    const kept = truncateOutput(lines.join("\n"))?.split("\n");
    expect(kept).toEqual(lines.slice(-OUTPUT_MAX_LINES));
  });

  it("keeps the end of a very long text, marked with an ellipsis", () => {
    const text = `${"x".repeat(OUTPUT_MAX_CHARS)}END`;
    const kept = truncateOutput(text);
    expect(kept?.startsWith("…")).toBe(true);
    expect(kept?.endsWith("END")).toBe(true);
    expect(kept?.length).toBe(OUTPUT_MAX_CHARS + 1);
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

  it("carries the version for outdated and offers no command to run", () => {
    const banner = bannerView("outdated", { state: "outdated", version: "0.0.100" });
    expect(banner?.tone).toBe("error");
    expect(banner).not.toHaveProperty("command");
    expect(banner?.detail).toContain("0.0.100");
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
    expect(view.banner?.message).toBe("The daemon could not be run.");
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
