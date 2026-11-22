import { describe, expect, it, vi } from "vitest";
import { type ConnectTarget, type DaemonEntryView, type HostConnection, type HostDaemons } from "@av-pi-studio/workbench";
import { type Transport } from "@av-pi-studio/client";

import { createDesktopConnection } from "./connection.js";
import { type Ipc, type IpcEvents } from "./ipc.js";
import { LOCAL_CONNECTION_MESSAGE } from "./proxied-transport.js";

const NO_ENTRIES: DaemonEntryView[] = [];

function setup(resolveListen = true, entries: DaemonEntryView[] = NO_ENTRIES, currentId: string | null = null) {
  const app = new Set<(payload: unknown) => void>();
  const browser = new Set<() => void>();
  let finish: () => void = () => undefined;
  const invoke = vi.fn<Ipc["invoke"]>(async () => ({ localUrl: "ws://127.0.0.1:1/TOKEN" }));
  const ipc: Ipc & IpcEvents = {
    invoke,
    listen: (_event, handler) =>
      new Promise((resolve) => {
        const register = (): void => {
          app.add(handler);
          resolve(() => app.delete(handler));
        };
        if (resolveListen) register();
        else finish = register;
      }),
  };
  const browserTransport = {} as Transport;
  const createTransport = vi.fn<HostConnection["createTransport"]>(() => browserTransport);
  const timers = {};
  const base = {
    createTransport,
    timers,
    onResume: (l: () => void) => {
      browser.add(l);
      return () => browser.delete(l);
    },
  } as unknown as HostConnection;
  const log = vi.fn<(m: string, e: unknown) => void>();
  const daemons: Pick<HostDaemons, "snapshot"> = {
    snapshot: (() => ({ currentId, entries })) as unknown as HostDaemons["snapshot"],
  };
  const connection = createDesktopConnection(base, ipc, daemons, log);
  return { app, browser, connection, createTransport, browserTransport, invoke, timers, log, finish: () => finish() };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("createDesktopConnection", () => {
  it("passes the timers through", () => {
    const { connection, timers } = setup();
    expect(connection.timers).toBe(timers);
  });

  describe("createTransport", () => {
    const DIRECT: ConnectTarget = { mode: "direct", url: "wss://daemon.example" };
    const RELAY: ConnectTarget = { mode: "relay", url: "wss://relay.example/r?host=wss://daemon.example", daemonPublicKey: new Uint8Array(32) };
    const entry = (id: string, kind: DaemonEntryView["kind"]): DaemonEntryView => ({
      id,
      kind,
      name: id,
      hasPassword: kind === "direct",
    });
    const entries = [entry("l", "local"), entry("d", "direct"), entry("r", "relay")];

    it("gives a direct and a local current entry the proxied transport", async () => {
      for (const id of ["d", "l"]) {
        const { connection, createTransport, browserTransport, invoke } = setup(true, entries, id);
        const transport = connection.createTransport(DIRECT, {});
        expect(transport).toBeDefined();
        expect(transport).not.toBe(browserTransport);
        expect(createTransport).not.toHaveBeenCalled();
        await transport?.connect(DIRECT.url).catch(() => undefined);
        expect(invoke).toHaveBeenCalledWith("transport_open", { url: DIRECT.url });
      }
    });

    it("gives a relay current entry the proxied transport, whatever the target", async () => {
      for (const target of [RELAY, DIRECT]) {
        const { connection, createTransport, browserTransport, invoke } = setup(true, entries, "r");
        const transport = connection.createTransport(target, { password: "pw" });
        expect(transport).not.toBe(browserTransport);
        expect(createTransport).not.toHaveBeenCalled();
        await transport?.connect(target.url).catch(() => undefined);
        expect(invoke).toHaveBeenCalledWith("transport_open", { url: target.url });
      }
    });

    it("leaves a window with no current entry to the browser host", () => {
      for (const currentId of [null, "gone"]) {
        const { connection, createTransport, browserTransport } = setup(true, entries, currentId);
        expect(connection.createTransport(DIRECT, {})).toBe(browserTransport);
        expect(createTransport).toHaveBeenCalledOnce();
      }
    });

    it("sends no password to any command for a proxied entry", async () => {
      const { connection, createTransport, invoke } = setup(true, entries, "d");
      const transport = connection.createTransport(DIRECT, { password: "SECRET-PW" });
      const error = await transport?.connect(DIRECT.url).catch((e: Error) => e);
      expect(createTransport).not.toHaveBeenCalled();
      expect(invoke).toHaveBeenCalled();
      expect(JSON.stringify(invoke.mock.calls)).not.toContain("SECRET-PW");
      // The socket to the fake loopback address does not open: the message names no address.
      expect((error as Error).message).toBe(LOCAL_CONNECTION_MESSAGE);
    });
  });

  it("hears the app and the browser, and neither after unsubscribing", async () => {
    const { app, browser, connection } = setup();
    const listener = vi.fn<() => void>();
    const stop = connection.onResume(listener);
    await tick();
    app.forEach((h) => h({ odd: true }));
    app.forEach((h) => h(undefined));
    browser.forEach((l) => l());
    expect(listener).toHaveBeenCalledTimes(3);
    stop();
    expect(app.size).toBe(0);
    expect(browser.size).toBe(0);
  });

  it("leaves nothing registered when unsubscribed before the registration resolved", async () => {
    const { app, connection, finish } = setup(false);
    const stop = connection.onResume(vi.fn<() => void>());
    stop();
    finish();
    await tick();
    expect(app.size).toBe(0);
  });

  it("keeps calling the others when a listener throws", async () => {
    const { app, connection, log } = setup();
    const bad = vi.fn<() => void>(() => {
      throw new Error("x");
    });
    const good = vi.fn<() => void>();
    connection.onResume(bad);
    connection.onResume(good);
    await tick();
    app.forEach((h) => h(null));
    expect(good).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalled();
  });
});
