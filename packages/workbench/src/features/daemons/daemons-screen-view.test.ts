import { describe, expect, it } from "vitest";
import { type DaemonEntryView, type LocalDaemonState } from "../../host/types.js";
import { INSTALL_CLI_COMMAND, UPDATE_CLI_COMMAND } from "./daemon-presentation.js";
import {
  bannerView,
  buildDaemonsScreenView,
  cliPathChanged,
  cliPathFromField,
  cliPathToField,
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
  return { currentId, entries, local, settings: { autoStartLocalDaemon: true, cliPath: null } };
}

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

  it("names a configured path that is not an executable file, and offers Retry", () => {
    const row = localRow({ state: "cli_missing", path: "/opt/bin/pi-studio" });
    expect(row.label).toContain("/opt/bin/pi-studio");
    expect(row.actions.map((a) => a.kind)).toEqual(["retry"]);
    expect(row.notice?.command).toBe(INSTALL_CLI_COMMAND);
  });

  it("shows the install command when the CLI is missing", () => {
    const row = localRow({ state: "cli_missing" });
    expect(row.notice?.command).toBe(INSTALL_CLI_COMMAND);
    expect(row.actions.map((a) => a.kind)).toEqual(["retry"]);
  });

  it("shows the update command and the found version when the CLI is outdated", () => {
    const row = localRow({ state: "cli_outdated", version: "0.0.100" });
    expect(row.notice?.command).toBe(UPDATE_CLI_COMMAND);
    expect(row.notice?.text).toContain("0.0.100");
    expect(row.actions.map((a) => a.kind)).toEqual(["retry"]);
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

  it("carries the update command and the version for cli_outdated", () => {
    const banner = bannerView("cli_outdated", { state: "cli_outdated", version: "0.0.100" });
    expect(banner?.tone).toBe("error");
    expect(banner?.command).toBe(UPDATE_CLI_COMMAND);
    expect(banner?.detail).toContain("0.0.100");
  });

  it("leaves the detail alone when the local state no longer says which version", () => {
    expect(bannerView("cli_outdated", { state: "stopped" })?.detail).toBe("Update it, then retry.");
  });

  it("carries the install command for cli_missing", () => {
    const banner = bannerView("cli_missing", { state: "cli_missing" });
    expect(banner?.command).toBe(INSTALL_CLI_COMMAND);
    expect(banner?.tone).toBe("error");
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

describe("the CLI path field", () => {
  it("trims the value and maps empty to null", () => {
    expect(cliPathFromField("  /usr/local/bin/pi-studio \n")).toBe("/usr/local/bin/pi-studio");
    expect(cliPathFromField("")).toBeNull();
    expect(cliPathFromField("   ")).toBeNull();
  });

  it("shows an empty field for no configured path", () => {
    expect(cliPathToField({ cliPath: null })).toBe("");
    expect(cliPathToField({ cliPath: "/x/pi-studio" })).toBe("/x/pi-studio");
  });

  it("offers Save only when the field would change the setting", () => {
    expect(cliPathChanged("", { cliPath: null })).toBe(false);
    expect(cliPathChanged("  ", { cliPath: null })).toBe(false);
    expect(cliPathChanged("/x", { cliPath: null })).toBe(true);
    expect(cliPathChanged(" /x ", { cliPath: "/x" })).toBe(false);
    expect(cliPathChanged("", { cliPath: "/x" })).toBe(true);
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
