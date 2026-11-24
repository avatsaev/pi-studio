import { type Transport } from "@av-pi-studio/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installHost, resetHostForTests } from "../../host/install.js";
import { useConnectionStore } from "../../lib/connection/connection-store.js";
import { useUiStore } from "../../stores/ui-store.js";
import { createTestDaemons } from "../../test/test-daemons.js";
import { createTestHost } from "../../test/test-host.js";
import { resetDaemonsStoreForTests, useDaemonsStore } from "./daemons-store.js";

function refusingTransport(): Transport & { dialed: string[] } {
  const dialed: string[] = [];
  return {
    dialed,
    isOpen: false,
    onMessage: null,
    onClose: null,
    onError: null,
    connect: async (url) => {
      dialed.push(url);
      throw new Error("refused by test transport");
    },
    sendText: () => {},
    sendBinary: () => {},
    close: () => {},
  };
}

beforeEach(() => {
  resetHostForTests();
  resetDaemonsStoreForTests();
  useConnectionStore.getState().disconnect();
  useConnectionStore.setState({ error: null, errorReason: null });
  useUiStore.setState({ host: "ws://127.0.0.1:6767", password: "" });
});

afterEach(() => {
  useConnectionStore.getState().disconnect();
});

describe("marking a relay link invalid", () => {
  it("adds and removes ids, replacing the set so subscribers see the change", () => {
    const { markLinkInvalid, clearLinkInvalid } = useDaemonsStore.getState();
    const before = useDaemonsStore.getState().invalidLinks;

    markLinkInvalid("r1");
    const marked = useDaemonsStore.getState().invalidLinks;
    expect(marked.has("r1")).toBe(true);
    expect(marked).not.toBe(before);

    markLinkInvalid("r1");
    expect(useDaemonsStore.getState().invalidLinks).toBe(marked);

    clearLinkInvalid("r1");
    expect(useDaemonsStore.getState().invalidLinks.has("r1")).toBe(false);
  });
});

describe("connecting to the current entry", () => {
  it("dials the entry's address with its password and leaves the bar's fields alone", async () => {
    const transport = refusingTransport();
    const daemons = createTestDaemons({
      entries: [{ id: "d1", kind: "direct", name: "Box", address: "box:6767", password: "pw" }],
      currentId: "d1",
    });
    const host = createTestHost({ daemons, createTransport: () => transport });
    installHost(host);

    await useDaemonsStore.getState().connectCurrent();
    await Promise.resolve();

    expect(host.calls.find((c) => c.member === "connection.createTransport")?.args).toEqual([
      { mode: "direct", url: "ws://box:6767" },
      { password: "pw" },
    ]);
    expect(useUiStore.getState().password).toBe("");
    expect(useUiStore.getState().host).toBe("ws://127.0.0.1:6767");
    expect(useDaemonsStore.getState().error).toBeNull();
    expect(useDaemonsStore.getState().open).toBe(false);
  });

  it("starts the local daemon and dials where it runs", async () => {
    const transport = refusingTransport();
    const daemons = createTestDaemons({ localPassword: "secret" });
    installHost(createTestHost({ daemons, createTransport: () => transport }));

    await useDaemonsStore.getState().connectCurrent();
    await Promise.resolve();

    expect(transport.dialed).toEqual(["ws://127.0.0.1:7777"]);
  });

  it("dials nothing, keeps the code and asks for the screen when the registry refuses", async () => {
    const transport = refusingTransport();
    const daemons = createTestDaemons({ local: { state: "outdated", version: "0.0.1" } });
    const host = createTestHost({ daemons, createTransport: () => transport });
    installHost(host);

    await useDaemonsStore.getState().connectCurrent();

    expect(host.calls.some((c) => c.member === "connection.createTransport")).toBe(false);
    expect(transport.dialed).toEqual([]);
    expect(useDaemonsStore.getState().error).toBe("outdated");
    expect(useDaemonsStore.getState().open).toBe(true);
    expect(useConnectionStore.getState().status).toBe("idle");
  });

  it("holds local_stopped when auto-start is off", async () => {
    const daemons = createTestDaemons({ settings: { autoStartLocalDaemon: false } });
    installHost(createTestHost({ daemons }));

    await useDaemonsStore.getState().connectCurrent();

    expect(useDaemonsStore.getState().error).toBe("local_stopped");
    expect(useDaemonsStore.getState().open).toBe(true);
  });

  it("clears a held error once the registry resolves again (Retry)", async () => {
    const daemons = createTestDaemons({ local: { state: "outdated", version: "0.0.1" } });
    installHost(createTestHost({ daemons, createTransport: () => refusingTransport() }));

    await useDaemonsStore.getState().connectCurrent();
    expect(useDaemonsStore.getState().error).toBe("outdated");

    daemons.setLocalState({ state: "running", host: "127.0.0.1", port: 7777 });
    await useDaemonsStore.getState().connectCurrent();

    expect(useDaemonsStore.getState().error).toBeNull();
  });

  it("does nothing without a registry", async () => {
    const host = createTestHost();
    installHost(host);

    await useDaemonsStore.getState().connectCurrent();

    expect(useDaemonsStore.getState().error).toBeNull();
    expect(host.calls.some((c) => c.member === "connection.createTransport")).toBe(false);
  });
});
