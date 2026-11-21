import { describe, expect, it } from "vitest";
import { type DaemonEntryView, type LocalDaemonState } from "../../host/types.js";
import { type DaemonsSnapshot } from "../daemons/use-daemons.js";
import {
  MANAGE_DAEMONS_LABEL,
  NO_DAEMON_LABEL,
  daemonChoice,
  daemonSwitcherView,
  switchFailureMessage,
} from "./daemon-switcher-presentation.js";

const LOCAL: DaemonEntryView = {
  id: "local",
  kind: "local",
  name: "This computer",
  hasPassword: false,
};
const A: DaemonEntryView = {
  id: "a",
  kind: "direct",
  name: "Alpha",
  address: "a.example:6767",
  hasPassword: true,
};
const B: DaemonEntryView = {
  id: "b",
  kind: "direct",
  name: "Bravo",
  address: "b.example:6767",
  hasPassword: false,
};
const R: DaemonEntryView = { id: "r", kind: "relay", name: "Relay one", hasPassword: false };

function snapshot(currentId: string | null, local: LocalDaemonState): DaemonsSnapshot {
  return {
    currentId,
    entries: [LOCAL, A, B, R],
    local,
    settings: { autoStartLocalDaemon: true, cliPath: null },
  };
}

const RUNNING: LocalDaemonState = { state: "running", host: "127.0.0.1", port: 6767 };

describe("daemonSwitcherView", () => {
  it("shows a direct entry's name and the connected status", () => {
    const view = daemonSwitcherView({
      snapshot: snapshot("b", RUNNING),
      status: "open",
      error: null,
    });

    expect(view.kind).toBe("connected");
    expect(view.name).toBe("Bravo");
    expect(view.statusLabel).toBe("connected");
    expect(view.title).toBe("Bravo · connected");
    expect(view.action).toMatchObject({ label: "Disconnect", intent: "disconnect" });
  });

  it("shows the local state's label while the local daemon is starting", () => {
    const view = daemonSwitcherView({
      snapshot: snapshot("local", { state: "starting" }),
      status: "idle",
      error: null,
    });

    expect(view.name).toBe("This computer");
    expect(view.statusLabel).toBe("Starting…");
    expect(view.kind).toBe("connecting");
    expect(view.action).toBeNull();
  });

  it("shows the connection status of the local entry once its daemon runs", () => {
    const view = daemonSwitcherView({
      snapshot: snapshot("local", RUNNING),
      status: "connecting",
      error: null,
    });

    expect(view.statusLabel).toBe("connecting…");
    expect(view.kind).toBe("connecting");
  });

  it("does not use the local state for a remote entry", () => {
    const view = daemonSwitcherView({
      snapshot: snapshot("a", { state: "cli_missing" }),
      status: "idle",
      error: null,
    });

    expect(view.statusLabel).toBe("disconnected");
    expect(view.kind).toBe("disconnected");
  });

  it("draws a failed local daemon as an error with Retry", () => {
    const view = daemonSwitcherView({
      snapshot: snapshot("local", { state: "failed", reason: "timeout" }),
      status: "idle",
      error: null,
    });

    expect(view.kind).toBe("error");
    expect(view.statusLabel).toBe("Did not start in time");
    expect(view.action).toMatchObject({ label: "Retry", intent: "retry", disabled: false });
  });

  it("offers no Retry for a stopped local daemon or a missing CLI", () => {
    for (const local of [{ state: "stopped" }, { state: "unsupported" }] as const) {
      const view = daemonSwitcherView({
        snapshot: snapshot("local", local),
        status: "idle",
        error: null,
      });
      expect(view.action).toBeNull();
    }
  });

  it("turns a failed connection into Retry with the short reason and the full error in the tooltip", () => {
    const view = daemonSwitcherView({
      snapshot: snapshot("a", RUNNING),
      status: "closed",
      error: "connection refused",
    });

    expect(view.kind).toBe("error");
    expect(view.statusLabel).toBe("connection refused");
    expect(view.title).toBe("Alpha · connection refused");
    expect(view.action).toMatchObject({ label: "Retry", intent: "retry" });
  });

  it("has no action while disconnected without an error", () => {
    const view = daemonSwitcherView({
      snapshot: snapshot("a", RUNNING),
      status: "closed",
      error: null,
    });

    expect(view.kind).toBe("disconnected");
    expect(view.action).toBeNull();
  });

  it("disables the action while connecting and while closing", () => {
    const connecting = daemonSwitcherView({
      snapshot: snapshot("a", RUNNING),
      status: "connecting",
      error: null,
    });
    const closing = daemonSwitcherView({
      snapshot: snapshot("a", RUNNING),
      status: "closing",
      error: null,
    });

    expect(connecting.action).toMatchObject({ label: "Connecting…", disabled: true });
    expect(closing.action).toMatchObject({ label: "Disconnect", disabled: true });
  });

  it("reads 'No daemon selected' without a current entry", () => {
    const view = daemonSwitcherView({
      snapshot: snapshot(null, RUNNING),
      status: "idle",
      error: null,
    });

    expect(view.name).toBe(NO_DAEMON_LABEL);
    expect(view.statusLabel).toBeNull();
    expect(view.title).toBe(NO_DAEMON_LABEL);
    expect(view.items.some((item) => item.current)).toBe(false);
  });

  it("treats a current id that names no entry as no current entry", () => {
    const view = daemonSwitcherView({
      snapshot: snapshot("gone", RUNNING),
      status: "idle",
      error: null,
    });

    expect(view.name).toBe(NO_DAEMON_LABEL);
  });

  it("lists every entry in registry order with only the current one marked", () => {
    const view = daemonSwitcherView({
      snapshot: snapshot("b", RUNNING),
      status: "open",
      error: null,
    });

    expect(view.items.map((item) => item.id)).toEqual(["local", "a", "b", "r"]);
    expect(view.items.filter((item) => item.current).map((item) => item.id)).toEqual(["b"]);
    expect(view.items.map((item) => item.kindLabel)).toEqual([
      "Local",
      "Direct",
      "Direct",
      "Relay",
    ]);
  });

  it("keeps a 64-character name whole; the DOM ellipsises it", () => {
    const name = "n".repeat(64);
    const long: DaemonsSnapshot = {
      ...snapshot("a", RUNNING),
      entries: [{ ...A, name }],
    };

    const view = daemonSwitcherView({ snapshot: long, status: "open", error: null });

    expect(view.name).toBe(name);
    expect(view.title).toBe(`${name} · connected`);
  });

  it("names the manage row 'Manage daemons…'", () => {
    expect(MANAGE_DAEMONS_LABEL).toBe("Manage daemons…");
  });
});

describe("daemonSwitcherView pairing link marker", () => {
  const marked = new Set(["r"]);

  it("marks the item and says why the current relay entry is not connected", () => {
    const view = daemonSwitcherView({
      snapshot: snapshot("r", RUNNING),
      status: "closed",
      error: "The pairing link does not match this daemon.",
      invalidLinks: marked,
    });

    expect(view.items.find((item) => item.id === "r")?.linkInvalid).toBe(true);
    expect(view.items.filter((item) => item.linkInvalid)).toHaveLength(1);
    expect(view.statusLabel).toBe("Pairing link no longer valid");
    expect(view.kind).toBe("error");
    expect(view.action).toMatchObject({ intent: "retry" });
  });

  it("shows the plain status while connecting or connected", () => {
    const view = daemonSwitcherView({
      snapshot: snapshot("r", RUNNING),
      status: "open",
      error: null,
      invalidLinks: marked,
    });

    expect(view.statusLabel).toBe("connected");
  });

  it("marks nothing when no link is marked", () => {
    const view = daemonSwitcherView({
      snapshot: snapshot("r", RUNNING),
      status: "idle",
      error: null,
    });

    expect(view.items.some((item) => item.linkInvalid)).toBe(false);
  });
});

describe("daemonChoice", () => {
  it("does nothing for the current entry while connected", () => {
    expect(daemonChoice({ currentId: "a", id: "a", status: "open" })).toEqual({ kind: "nothing" });
  });

  it("reconnects the current entry while not connected", () => {
    for (const status of ["idle", "closed", "connecting", "closing"] as const) {
      expect(daemonChoice({ currentId: "a", id: "a", status })).toEqual({ kind: "reconnect" });
    }
  });

  it("switches to another entry, connected or not", () => {
    expect(daemonChoice({ currentId: "a", id: "b", status: "open" })).toEqual({
      kind: "switch",
      id: "b",
    });
    expect(daemonChoice({ currentId: "a", id: "b", status: "closed" })).toEqual({
      kind: "switch",
      id: "b",
    });
  });

  it("switches when there is no current entry", () => {
    expect(daemonChoice({ currentId: null, id: "a", status: "idle" })).toEqual({
      kind: "switch",
      id: "a",
    });
  });
});

describe("switchFailureMessage", () => {
  it("words a rejected switch from its code", () => {
    expect(switchFailureMessage(Object.assign(new Error("not_found"), { code: "not_found" }))).toBe(
      "This daemon no longer exists.",
    );
  });

  it("falls back to a generic sentence for anything else", () => {
    expect(switchFailureMessage(new Error("boom"))).toBe("The daemon could not be opened.");
  });
});
