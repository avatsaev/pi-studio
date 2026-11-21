import { describe, expect, it, vi } from "vitest";
import { type HostConnection } from "@av-pi-studio/workbench";

import { createDesktopConnection } from "./connection.js";
import { type IpcEvents } from "./ipc.js";

function setup(resolveListen = true) {
  const app = new Set<(payload: unknown) => void>();
  const browser = new Set<() => void>();
  let finish: () => void = () => undefined;
  const events: IpcEvents = {
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
  const createTransport = () => undefined;
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
  const connection = createDesktopConnection(base, events, log);
  return { app, browser, connection, createTransport, timers, log, finish: () => finish() };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("createDesktopConnection", () => {
  it("passes the transport and timers through", () => {
    const { connection, createTransport, timers } = setup();
    expect(connection).toMatchObject({ createTransport, timers });
    expect(connection.timers).toBe(timers);
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
