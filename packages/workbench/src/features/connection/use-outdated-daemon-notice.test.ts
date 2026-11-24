import { type ConnectionState } from "@av-pi-studio/client";
import { type ServerInfoPayload } from "@av-pi-studio/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useConnectionStore } from "../../lib/connection/connection-store.js";
import { useDaemonsStore } from "../daemons/daemons-store.js";
import {
  type EstablishedTracker,
  noticeOnEstablish,
  noticeToastOptions,
  watchOutdatedDaemon,
} from "./use-outdated-daemon-notice.js";

function info(version?: string): ServerInfoPayload {
  return {
    status: "server_info",
    serverId: "srv",
    ...(version === undefined ? {} : { version }),
    capabilities: {},
    features: {},
  };
}

/** Moves the fake connection the way `connect()` and a reconnect do. */
function setConnection(status: ConnectionState, serverInfo: ServerInfoPayload | null): void {
  useConnectionStore.setState({ status, serverInfo });
}

describe("noticeOnEstablish", () => {
  it("waits for server_info: `open` alone carries no version", () => {
    const tracker: EstablishedTracker = { established: false };
    expect(noticeOnEstablish(tracker, "0.0.119", "open", null)).toBeNull();
    expect(noticeOnEstablish(tracker, "0.0.119", "open", info("0.0.1"))).toContain("0.0.1");
  });

  it("asks only on the rise, not while the connection holds", () => {
    const tracker: EstablishedTracker = { established: false };
    expect(noticeOnEstablish(tracker, "0.0.119", "open", info("0.0.1"))).not.toBeNull();
    expect(noticeOnEstablish(tracker, "0.0.119", "open", info("0.0.1"))).toBeNull();
  });

  it("asks again after the connection dropped", () => {
    const tracker: EstablishedTracker = { established: false };
    noticeOnEstablish(tracker, "0.0.119", "open", info("0.0.1"));
    noticeOnEstablish(tracker, "0.0.119", "closed", info("0.0.1"));
    expect(noticeOnEstablish(tracker, "0.0.119", "open", info("0.0.1"))).not.toBeNull();
  });
});

describe("watchOutdatedDaemon", () => {
  const shown: string[] = [];
  let stop: (() => void) | null = null;

  function watch(
    minVersion: string | undefined,
    tracker: EstablishedTracker = { established: false },
  ) {
    stop = watchOutdatedDaemon(tracker, minVersion, (notice) => shown.push(notice));
  }

  beforeEach(() => {
    shown.length = 0;
    setConnection("idle", null);
  });

  afterEach(() => {
    stop?.();
    stop = null;
    setConnection("idle", null);
  });

  it("shows one notice for one connection", () => {
    watch("0.0.119");
    setConnection("connecting", null);
    setConnection("open", null);
    setConnection("open", info("0.0.118"));
    // Unrelated store changes while connected.
    useConnectionStore.setState({ error: null });
    useConnectionStore.setState({ error: "x" });
    useConnectionStore.setState({ error: null });
    expect(shown).toHaveLength(1);
    expect(shown[0]).toContain("This daemon is 0.0.118; this app expects 0.0.119 or newer.");
  });

  it("shows one more after a reconnect to a daemon that is still old", () => {
    watch("0.0.119");
    setConnection("open", info("0.0.118"));
    setConnection("closed", info("0.0.118"));
    setConnection("connecting", info("0.0.118"));
    setConnection("open", info("0.0.118"));
    expect(shown).toHaveLength(2);
  });

  it("shows one for a new connect after a disconnect", () => {
    watch("0.0.119");
    setConnection("open", info("0.0.118"));
    setConnection("idle", null);
    setConnection("open", info("0.0.9"));
    expect(shown).toHaveLength(2);
  });

  it("shows none for a daemon that meets the minimum", () => {
    watch("0.0.119");
    setConnection("open", info("0.0.119"));
    expect(shown).toEqual([]);
  });

  it("says the daemon did not report a version", () => {
    watch("0.0.119");
    setConnection("open", info());
    expect(shown).toHaveLength(1);
    expect(shown[0]).toContain("did not report a version");
  });

  it("covers a connection that is already established when watching starts, once", () => {
    setConnection("open", info("0.0.1"));
    const tracker: EstablishedTracker = { established: false };
    watch("0.0.119", tracker);
    stop?.();
    // A development remount reuses the tracker: the same connection is not counted twice.
    watch("0.0.119", tracker);
    expect(shown).toHaveLength(1);
  });

  it("adds nothing without a minimum", () => {
    watch(undefined);
    setConnection("open", info("0.0.1"));
    setConnection("closed", info("0.0.1"));
    setConnection("open", info());
    expect(shown).toEqual([]);
  });

  it("stops watching when unsubscribed", () => {
    watch("0.0.119");
    stop?.();
    stop = null;
    setConnection("open", info("0.0.1"));
    expect(shown).toEqual([]);
  });
});

describe("noticeToastOptions", () => {
  it("offers an action that opens the Daemons screen when the host has a registry", () => {
    useDaemonsStore.getState().closeScreen();
    const { action } = noticeToastOptions(true);
    expect(action?.label).toBe("Open Daemons");
    action?.onSelect();
    expect(useDaemonsStore.getState().open).toBe(true);
    useDaemonsStore.getState().closeScreen();
  });

  it("has no action without a registry (the browser)", () => {
    expect(noticeToastOptions(false).action).toBeUndefined();
  });
});
