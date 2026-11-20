import { beforeEach, describe, expect, it } from "vitest";
import { installHost, resetHostForTests } from "../../host/install.js";
import { type DaemonSettings, type HostDaemons } from "../../host/types.js";
import { DaemonError, createTestDaemons } from "../../test/test-daemons.js";
import { createTestHost } from "../../test/test-host.js";
import { DaemonsScreen } from "./DaemonsScreen.js";
import {
  openEntry,
  removeConfirmMessage,
  removeEntry,
  runLocalAction,
  runLocalActionAsking,
  saveAutoStart,
  STOP_CONFIRM_MESSAGE,
  stopNeedsConfirm,
  saveCliPath,
} from "./daemons-screen-actions.js";

function registry() {
  return createTestDaemons({
    entries: [
      { id: "b", kind: "direct", name: "Build box", address: "ws://10.0.0.2:6767" },
      { id: "c", kind: "relay", name: "Office", pairingLink: "pi-studio://pair?x=1" },
    ],
    currentId: "b",
  });
}

function ids(daemons: HostDaemons): string[] {
  return daemons.snapshot().entries.map((e) => e.id);
}

describe("removeEntry", () => {
  it("asks, naming the entry, and removes nothing on no", async () => {
    const daemons = registry();
    const host = createTestHost({ confirms: [false], daemons });

    const outcome = await removeEntry(daemons, host.dialogs, { id: "b", name: "Build box" });

    expect(outcome).toBeNull();
    expect(host.calls).toEqual([
      { member: "dialogs.confirm", args: [removeConfirmMessage("Build box")] },
    ]);
    expect(removeConfirmMessage("Build box")).toContain('"Build box"');
    expect(ids(daemons)).toEqual(["local", "b", "c"]);
  });

  it("removes the entry on yes", async () => {
    const daemons = registry();
    const host = createTestHost({ confirms: [true], daemons });

    expect(await removeEntry(daemons, host.dialogs, { id: "b", name: "Build box" })).toBeNull();

    expect(ids(daemons)).toEqual(["local", "c"]);
  });

  it("reports the code when the host refuses", async () => {
    const daemons = registry();
    const host = createTestHost({ confirms: [true], daemons });

    expect(await removeEntry(daemons, host.dialogs, { id: "local", name: "This machine" })).toBe(
      "local_not_removable",
    );
    expect(await removeEntry(daemons, host.dialogs, { id: "gone", name: "Gone" })).toBe(
      "not_found",
    );
    expect(ids(daemons)).toEqual(["local", "b", "c"]);
  });
});

describe("runLocalAction", () => {
  it("starts the daemon and lets the state change report the outcome", async () => {
    const daemons = registry();

    expect(await runLocalAction(daemons, "start")).toBeNull();
    expect(daemons.snapshot().local.state).toBe("starting");
    await daemons.settled();
    expect(daemons.snapshot().local.state).toBe("running");
  });

  it("reports busy while another action runs", async () => {
    const daemons = registry();
    await runLocalAction(daemons, "start");

    expect(await runLocalAction(daemons, "restart")).toBe("busy");
    await daemons.settled();
  });

  it("reports what a missing CLI rejects with, for start and for refresh alike", async () => {
    const daemons = createTestDaemons({ local: { state: "cli_missing" } });

    expect(await runLocalAction(daemons, "start")).toBe("cli_missing");
    const unsupported = createTestDaemons({ local: { state: "unsupported" } });
    expect(await runLocalAction(unsupported, "refresh")).toBe("unsupported");
  });

  it("reports unexpected for a rejection that carries no known code", async () => {
    const daemons = registry();
    const broken: HostDaemons = {
      ...daemons,
      local: { ...daemons.local, stop: () => Promise.reject(new Error("socket closed")) },
    };

    expect(await runLocalAction(broken, "stop")).toBe("unexpected");
  });
});

describe("openEntry", () => {
  it("switches to the entry", () => {
    const daemons = registry();

    void openEntry(daemons, "c");

    expect(daemons.switches).toEqual(["c"]);
  });

  it("reports an entry that no longer exists", async () => {
    const daemons = registry();
    const missing: HostDaemons = {
      ...daemons,
      switchTo: () => Promise.reject(new DaemonError("not_found")),
    };

    expect(await openEntry(missing, "zzz")).toBe("not_found");
  });
});

function recording() {
  const daemons = registry();
  const patches: Array<Partial<DaemonSettings>> = [];
  const wrapped: HostDaemons = {
    ...daemons,
    setSettings: (patch) => {
      patches.push(patch);
      return daemons.setSettings(patch);
    },
  };
  return { daemons, wrapped, patches };
}

describe("settings", () => {
  it("saves the CLI path trimmed, with one setSettings call", async () => {
    const { daemons, wrapped, patches } = recording();

    expect(await saveCliPath(wrapped, "  /opt/bin/pi-studio ")).toBeNull();

    expect(patches).toEqual([{ cliPath: "/opt/bin/pi-studio" }]);
    expect(daemons.snapshot().settings.cliPath).toBe("/opt/bin/pi-studio");
  });

  it("saves an empty field as null", async () => {
    const { wrapped, patches } = recording();

    await saveCliPath(wrapped, "   ");

    expect(patches).toEqual([{ cliPath: null }]);
  });

  it("saves the auto-start switch", async () => {
    const { daemons, wrapped, patches } = recording();

    expect(await saveAutoStart(wrapped, false)).toBeNull();

    expect(patches).toEqual([{ autoStartLocalDaemon: false }]);
    expect(daemons.snapshot().settings.autoStartLocalDaemon).toBe(false);
  });

  it("returns the host's reason for a refused value and changes nothing", async () => {
    const daemons = registry();
    const refusing: HostDaemons = {
      ...daemons,
      setSettings: () => Promise.reject(new Error("The path must be absolute.")),
    };

    expect(await saveCliPath(refusing, "relative/pi-studio")).toBe("The path must be absolute.");
    expect(daemons.snapshot().settings.cliPath).toBeNull();
  });
});

describe("DaemonsScreen mount", () => {
  beforeEach(() => resetHostForTests());

  it("renders nothing when the host has no registry", () => {
    installHost(createTestHost());

    expect(DaemonsScreen()).toBeNull();
  });

  it("renders the screen when the host has a registry", () => {
    installHost(createTestHost({ daemons: registry() }));

    expect(DaemonsScreen()).not.toBeNull();
  });
});

describe("stopNeedsConfirm", () => {
  it("asks only for Stop on the current entry while connected", () => {
    expect(stopNeedsConfirm("stop", true, "open")).toBe(true);
    expect(stopNeedsConfirm("stop", false, "open")).toBe(false);
    expect(stopNeedsConfirm("stop", true, "closed")).toBe(false);
    expect(stopNeedsConfirm("restart", true, "open")).toBe(false);
  });
});

function dialogs(answer: boolean, asked: string[]) {
  return {
    confirm: async (message: string) => (asked.push(message), answer),
    alert: async () => {},
  };
}

describe("runLocalActionAsking", () => {
  it("stops after a yes", async () => {
    const daemons = createTestDaemons({ local: { state: "running", host: "h", port: 1 } });
    const asked: string[] = [];

    expect(await runLocalActionAsking(daemons, dialogs(true, asked), "stop", true)).toBeNull();

    expect(asked).toEqual([STOP_CONFIRM_MESSAGE]);
    expect(["stopping", "stopped"]).toContain(daemons.snapshot().local.state);
  });

  it("does nothing after a no", async () => {
    const daemons = createTestDaemons({ local: { state: "running", host: "h", port: 1 } });

    expect(await runLocalActionAsking(daemons, dialogs(false, []), "stop", true)).toBeNull();

    expect(daemons.snapshot().local.state).toBe("running");
  });

  it("does not ask when not told to", async () => {
    const daemons = createTestDaemons({ local: { state: "running", host: "h", port: 1 } });
    const asked: string[] = [];

    await runLocalActionAsking(daemons, dialogs(false, asked), "stop", false);

    expect(asked).toEqual([]);
  });
});
