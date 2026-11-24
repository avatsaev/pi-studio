import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installHost, resetHostForTests } from "../../host/install.js";
import { useConnectionStore } from "../../lib/connection/connection-store.js";
import { createTestDaemons, type TestDaemons } from "../../test/test-daemons.js";
import { createTestHost } from "../../test/test-host.js";
import {
  lifecycleReactions,
  watchDaemonLifecycle,
  type LifecycleEffects,
  type LifecycleFacts,
  type LifecycleReaction,
} from "./daemon-lifecycle.js";
import { runLocalActionAsking } from "./daemons-screen-actions.js";

const LOCAL_UP: LifecycleFacts = {
  currentId: "local",
  currentKind: "local",
  local: "running",
  remote: null,
  status: "open",
  errorReason: null,
  restartExpected: false,
};
const RELAY_CONNECTING: LifecycleFacts = {
  currentId: "r",
  currentKind: "relay",
  local: "running",
  remote: null,
  status: "connecting",
  errorReason: null,
  restartExpected: false,
};
const DIRECT_UP: LifecycleFacts = {
  currentId: "d",
  currentKind: "direct",
  local: "running",
  remote: null,
  status: "open",
  errorReason: null,
  restartExpected: false,
};

function react(prev: LifecycleFacts, patch: Partial<LifecycleFacts>): LifecycleReaction[] {
  return lifecycleReactions(prev, { ...prev, ...patch });
}

describe("lifecycleReactions", () => {
  it("leaves when the local daemon starts stopping while it is the current entry", () => {
    expect(react(LOCAL_UP, { local: "stopping" })).toEqual([{ kind: "leave" }]);
  });

  it("connects when a started local daemon comes up and the window is connected to nothing", () => {
    const stopped: LifecycleFacts = { ...LOCAL_UP, local: "starting", status: "idle" };
    expect(react(stopped, { local: "running" })).toEqual([{ kind: "connect" }]);
  });

  it("connects when an Update ends in a running local daemon and the window is connected to nothing", () => {
    const updating: LifecycleFacts = { ...LOCAL_UP, local: "updating", status: "idle" };
    expect(react(updating, { local: "running" })).toEqual([{ kind: "connect" }]);
    expect(react(updating, { local: "failed" })).toEqual([]);
  });

  it("connects when a download or an install ends in a running local daemon and the window is connected to nothing", () => {
    for (const local of ["downloading", "installing"] as const) {
      const installing: LifecycleFacts = { ...LOCAL_UP, local, status: "idle" };
      expect(react(installing, { local: "running" }), local).toEqual([{ kind: "connect" }]);
      expect(react(installing, { local: "failed" }), local).toEqual([]);
    }
  });

  it("does not connect for a restart, a daemon started elsewhere, or another entry kind", () => {
    expect(react({ ...LOCAL_UP, local: "starting" }, { local: "running" })).toEqual([]);
    expect(react({ ...LOCAL_UP, local: "stopped", status: "idle" }, { local: "running" })).toEqual(
      [],
    );
    expect(
      react({ ...DIRECT_UP, local: "starting", status: "idle" }, { local: "running" }),
    ).toEqual([]);
  });

  it("does nothing for a restart: the connection is kept", () => {
    expect(react(LOCAL_UP, { local: "starting" })).toEqual([]);
    expect(react({ ...LOCAL_UP, local: "starting" }, { local: "running" })).toEqual([]);
  });

  it("ignores stopping while the current entry is a direct one", () => {
    expect(react(DIRECT_UP, { local: "stopping" })).toEqual([]);
  });

  it("leaves once when stopping is already known and nothing else changes", () => {
    expect(react({ ...LOCAL_UP, local: "stopping" }, { local: "stopping" })).toEqual([]);
  });

  it("leaves when the current entry is removed, not when another one is", () => {
    expect(react(DIRECT_UP, { currentId: null, currentKind: null })).toEqual([{ kind: "leave" }]);
    expect(react(DIRECT_UP, { status: "open" })).toEqual([]);
  });

  it("marks the relay entry that failed with wrong_key", () => {
    expect(react(RELAY_CONNECTING, { status: "closed", errorReason: "wrong_key" })).toEqual([
      { kind: "markLinkInvalid", id: "r" },
    ]);
  });

  it("marks nothing for daemon_offline, or for a failure on a non-relay entry", () => {
    expect(react(RELAY_CONNECTING, { status: "closed", errorReason: "daemon_offline" })).toEqual(
      [],
    );
    expect(react({ ...DIRECT_UP, status: "connecting" }, { errorReason: "wrong_key" })).toEqual([]);
  });

  it("clears the marker when the entry connects", () => {
    expect(react(RELAY_CONNECTING, { status: "open" })).toEqual([
      { kind: "clearLinkInvalid", id: "r" },
    ]);
  });

  it("refreshes the local daemon when its connection drops", () => {
    expect(react(LOCAL_UP, { status: "closed" })).toEqual([{ kind: "refreshLocal" }]);
  });

  it("does not refresh for a manual disconnect, a retry loop or a remote entry", () => {
    expect(react(LOCAL_UP, { status: "closing" })).toEqual([]);
    expect(react({ ...LOCAL_UP, status: "closing" }, { status: "closed" })).toEqual([]);
    expect(react({ ...LOCAL_UP, status: "connecting" }, { status: "closed" })).toEqual([]);
    expect(react(DIRECT_UP, { status: "closed" })).toEqual([]);
  });

  it("does not refresh when the daemon announced its restart: it comes back by itself", () => {
    const restarting: LifecycleFacts = { ...LOCAL_UP, restartExpected: true };
    expect(react(restarting, { status: "closed" })).toEqual([]);
  });
});

interface Recorded {
  leaves: number;
  opened: number;
  marked: string[];
  cleared: string[];
  refreshes: number;
  connects: number;
}

function recordingEffects(): { effects: LifecycleEffects; log: Recorded } {
  const log: Recorded = {
    leaves: 0,
    opened: 0,
    marked: [],
    cleared: [],
    refreshes: 0,
    connects: 0,
  };
  return {
    log,
    effects: {
      leave: () => {
        log.leaves++;
        // The real manual disconnect: back to idle, no reconnection.
        useConnectionStore.getState().disconnect();
      },
      markLinkInvalid: (id) => log.marked.push(id),
      clearLinkInvalid: (id) => log.cleared.push(id),
      refreshLocal: () => log.refreshes++,
      connect: () => log.connects++,
      openScreen: () => log.opened++,
    },
  };
}

function setConnection(
  patch: Partial<Pick<LifecycleFacts, "status" | "errorReason">> & { error?: string | null },
): void {
  useConnectionStore.setState(patch);
}

let stop: (() => void) | null = null;

function mount(daemons: TestDaemons): { log: Recorded } {
  installHost(createTestHost({ daemons }));
  const { effects, log } = recordingEffects();
  stop = watchDaemonLifecycle(daemons, effects);
  return { log };
}

beforeEach(() => {
  resetHostForTests();
  useConnectionStore.getState().disconnect();
  setConnection({ status: "idle", error: null, errorReason: null });
});

afterEach(() => {
  stop?.();
  stop = null;
  useConnectionStore.getState().disconnect();
});

describe("watchDaemonLifecycle", () => {
  it("disconnects once and opens the screen after a confirmed Stop; no reconnect", async () => {
    const daemons = createTestDaemons({ local: { state: "running", host: "127.0.0.1", port: 1 } });
    const { log } = mount(daemons);
    setConnection({ status: "open" });
    const confirms: string[] = [];
    const dialogs = {
      confirm: async (message: string) => (confirms.push(message), true),
      alert: async () => {},
    };

    expect(await runLocalActionAsking(daemons, dialogs, "stop", true)).toBeNull();
    await daemons.settled();

    expect(confirms).toHaveLength(1);
    expect(log.leaves).toBe(1);
    expect(log.opened).toBe(1);
    expect(useConnectionStore.getState().status).toBe("idle");
    expect(useConnectionStore.getState().reconnection).toBeNull();
    expect(log.refreshes).toBe(0);
  });

  it("does nothing when the confirm is answered no", async () => {
    const daemons = createTestDaemons({ local: { state: "running", host: "127.0.0.1", port: 1 } });
    const { log } = mount(daemons);
    setConnection({ status: "open" });
    const dialogs = { confirm: async () => false, alert: async () => {} };

    expect(await runLocalActionAsking(daemons, dialogs, "stop", true)).toBeNull();

    expect(daemons.snapshot().local.state).toBe("running");
    expect(log.leaves).toBe(0);
    expect(log.opened).toBe(0);
  });

  it("reacts to a stop nobody confirmed here (native menu, control socket)", () => {
    const daemons = createTestDaemons({ local: { state: "running", host: "127.0.0.1", port: 1 } });
    const { log } = mount(daemons);
    setConnection({ status: "open" });

    daemons.setLocalState({ state: "stopping" });

    expect(log.leaves).toBe(1);
    expect(log.opened).toBe(1);
  });

  it("keeps the connection through a restart", () => {
    const daemons = createTestDaemons({ local: { state: "running", host: "127.0.0.1", port: 1 } });
    const { log } = mount(daemons);
    setConnection({ status: "open" });

    daemons.setLocalState({ state: "starting" });
    daemons.setLocalState({ state: "running", host: "127.0.0.1", port: 1 });

    expect(log.leaves).toBe(0);
    expect(log.opened).toBe(0);
  });

  it("changes nothing for stopping while the current entry is a direct one", () => {
    const daemons = createTestDaemons({
      entries: [{ id: "d", kind: "direct", name: "Box", address: "box:6767" }],
      currentId: "d",
      local: { state: "running", host: "127.0.0.1", port: 1 },
    });
    const { log } = mount(daemons);
    setConnection({ status: "open" });

    daemons.setLocalState({ state: "stopping" });

    expect(log.leaves).toBe(0);
    expect(log.opened).toBe(0);
  });

  it("disconnects and opens the screen when the current entry is removed, not another", async () => {
    const daemons = createTestDaemons({
      entries: [
        { id: "d", kind: "direct", name: "Box", address: "box:6767" },
        { id: "e", kind: "direct", name: "Other", address: "other:6767" },
      ],
      currentId: "d",
    });
    const { log } = mount(daemons);
    setConnection({ status: "open" });

    await daemons.remove("e");
    expect(log.leaves).toBe(0);
    expect(log.opened).toBe(0);

    await daemons.remove("d");
    expect(log.leaves).toBe(1);
    expect(log.opened).toBe(1);
  });

  it("marks only the relay entry being connected on wrong_key, and nothing on daemon_offline", () => {
    const daemons = createTestDaemons({
      entries: [{ id: "r", kind: "relay", name: "Relay", pairingLink: "https://x/#offer=a" }],
      currentId: "r",
    });
    const { log } = mount(daemons);
    setConnection({ status: "connecting" });

    setConnection({ status: "closed", error: "offline", errorReason: "daemon_offline" });
    expect(log.marked).toEqual([]);

    setConnection({ status: "connecting", error: null, errorReason: null });
    setConnection({ status: "closed", error: "no", errorReason: "wrong_key" });
    expect(log.marked).toEqual(["r"]);
  });

  it("clears the marker when the relay entry connects", () => {
    const daemons = createTestDaemons({
      entries: [{ id: "r", kind: "relay", name: "Relay", pairingLink: "https://x/#offer=a" }],
      currentId: "r",
    });
    const { log } = mount(daemons);
    setConnection({ status: "connecting" });

    setConnection({ status: "open" });

    expect(log.cleared).toEqual(["r"]);
  });

  it("refreshes the local daemon once per drop and never starts it", () => {
    const daemons = createTestDaemons({ local: { state: "running", host: "127.0.0.1", port: 1 } });
    let starts = 0;
    daemons.local.start = async () => void starts++;
    const { log } = mount(daemons);
    setConnection({ status: "open" });

    setConnection({ status: "closed" });
    setConnection({ status: "connecting" });
    setConnection({ status: "closed" });
    expect(log.refreshes).toBe(1);

    setConnection({ status: "open" });
    setConnection({ status: "closed" });
    expect(log.refreshes).toBe(2);
    expect(starts).toBe(0);
  });

  it("opens the screen on a manage request, and stops listening when unmounted", () => {
    const daemons = createTestDaemons();
    const { log } = mount(daemons);

    daemons.requestManage();
    expect(log.opened).toBe(1);

    stop?.();
    stop = null;
    daemons.requestManage();
    expect(log.opened).toBe(1);
    expect(daemons.listenerCount()).toBe(0);
  });
});

describe("opening the screen for an SSH entry (S8)", () => {
  const SSH: LifecycleFacts = {
    currentId: "s",
    currentKind: "ssh",
    local: "running",
    remote: "checking",
    status: "idle",
    errorReason: null,
    restartExpected: false,
  };
  const OPEN = [{ kind: "openScreen" }];

  it("opens when the state becomes stopped, not_installed, outdated, unsupported or failed", () => {
    for (const remote of [
      "stopped",
      "not_installed",
      "outdated",
      "unsupported",
      "failed",
    ] as const) {
      expect(react(SSH, { remote })).toEqual(OPEN);
    }
  });

  it("does not open for any other state, nor when the state did not change", () => {
    for (const remote of ["unknown", "checking", "starting", "installing", "running"] as const) {
      expect(react({ ...SSH, remote: "stopped" }, { remote })).toEqual([]);
    }
    expect(react({ ...SSH, remote: "stopped" }, { remote: "stopped" })).toEqual([]);
  });

  it("opens again when a failed start ends in another state needing the user", () => {
    expect(react({ ...SSH, remote: "starting" }, { remote: "failed" })).toEqual(OPEN);
  });

  it("does not open for an entry that is not ssh", () => {
    expect(react(DIRECT_UP, { remote: "stopped" })).toEqual([]);
  });

  it("opens on mount and on a state change, through the watcher", () => {
    const daemons = createTestDaemons({
      entries: [{ id: "s", kind: "ssh", name: "Box", host: "box" }],
      currentId: "s",
      remote: { state: "stopped" },
    });
    const { log } = mount(daemons);
    expect(log.opened).toBe(1);
    daemons.setRemoteState({ state: "starting" });
    expect(log.opened).toBe(1);
    daemons.setRemoteState({ state: "failed", reason: "timeout" });
    expect(log.opened).toBe(2);
  });
});
