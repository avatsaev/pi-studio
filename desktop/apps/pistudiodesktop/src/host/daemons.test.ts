import { describe, expect, it, vi } from "vitest";

import { HostDaemonError, SECRET_NOT_REMOVED_TEXT, createDesktopDaemons } from "./daemons.js";
import { type DaemonsView } from "./daemons-view.js";
import { type Ipc, type IpcEvents } from "./ipc.js";
import { createDesktopStorage } from "./storage.js";

const BOOT: DaemonsView = {
  currentId: "local",
  entries: [
    { id: "local", kind: "local", name: "This machine", hasPassword: false },
    { id: "d1", kind: "direct", name: "Box", address: "box:6767", hasPassword: true },
  ],
  local: { state: "checking" },
  remote: null,
  settings: { autoStartLocalDaemon: true },
};
const NEXT: DaemonsView = { ...BOOT, currentId: "d1", local: { state: "running", host: "127.0.0.1", port: 6767 } };
const ENTRY = { id: "d2", kind: "relay", name: "Office", hasPassword: false };

type Handler = (command: string, args?: Record<string, unknown>) => unknown;

/** A fake app: `invoke` answers from `handler` (the registry as it stands unless it says otherwise). */
function harness(handler: Handler = () => undefined, view: DaemonsView = BOOT) {
  const listeners = new Map<string, (payload: unknown) => void>();
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const { settings, ...list } = view;
  const ipc: Ipc & IpcEvents = {
    invoke: async (command, args) => {
      const record = args as Record<string, unknown> | undefined;
      calls.push({ command, args: record });
      if (command === "engine_command" && record?.id === "daemon.list") return list;
      if (command === "engine_command" && record?.id === "settings.get") return settings;
      return handler(command, record);
    },
    listen: async (event, listener) => {
      listeners.set(event, listener);
      return () => listeners.delete(event);
    },
  };
  const log = vi.fn<(message: string, error: unknown) => void>();
  let settled: () => Promise<void> = async () => undefined;
  const tell = vi.fn<(text: string) => void>();
  const daemons = createDesktopDaemons(view, ipc, () => settled(), log, tell);
  return {
    daemons,
    calls,
    log,
    tell,
    emit: (event: string, payload?: unknown) => listeners.get(event)?.(payload),
    setSettled: (next: () => Promise<void>) => (settled = next),
    engineCalls: () => calls.filter((c) => c.command === "engine_command" && !String(c.args?.id).match(/^(daemon\.list|settings\.get)$/)),
  };
}

/** Lets every promise the fakes settle run: they all resolve in microtasks. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 50; turn++) await Promise.resolve();
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

describe("snapshot and subscribe", () => {
  it("holds the boot view, replaces it on each daemons_changed, and tells each subscriber once", async () => {
    const h = harness();
    await flush();
    expect(h.daemons.snapshot()).toEqual(BOOT);
    const a = vi.fn<() => void>(() => expect(h.daemons.snapshot()).toEqual(NEXT));
    const b = vi.fn<() => void>();
    h.daemons.subscribe(a);
    const offB = h.daemons.subscribe(b);
    offB();
    h.emit("daemons_changed", NEXT);
    expect(h.daemons.snapshot()).toEqual(NEXT);
    expect(a).toHaveBeenCalledOnce();
    expect(b).not.toHaveBeenCalled();
  });

  it("ignores an event of an unexpected shape, and survives a listener that throws", async () => {
    const h = harness();
    await flush();
    const later = vi.fn<() => void>();
    h.daemons.subscribe(() => {
      throw new Error("boom");
    });
    h.daemons.subscribe(later);
    h.emit("daemons_changed", { currentId: 3 });
    expect(h.daemons.snapshot()).toEqual(BOOT);
    expect(later).not.toHaveBeenCalled();
    h.emit("daemons_changed", NEXT);
    expect(later).toHaveBeenCalledOnce();
    expect(h.log).toHaveBeenCalledTimes(2);
  });

  it("reads the registry once the listener is in place, and tells subscribers only of a difference", async () => {
    const same = harness();
    const onSame = vi.fn<() => void>();
    same.daemons.subscribe(onSame);
    await flush();
    expect(onSame).not.toHaveBeenCalled();

    const moved = harness(() => undefined, NEXT);
    // The page holds the old view; the app has moved on.
    const stale = createDesktopDaemons(
      BOOT,
      {
        invoke: async (_command, args) =>
          (args as Record<string, unknown>).id === "settings.get" ? NEXT.settings : { currentId: "d1", entries: NEXT.entries, local: NEXT.local },
        listen: async () => () => undefined,
      },
      async () => undefined,
      moved.log,
      () => undefined,
    );
    const onStale = vi.fn<() => void>();
    stale.subscribe(onStale);
    await flush();
    expect(stale.snapshot()).toEqual(NEXT);
    expect(onStale).toHaveBeenCalledOnce();
  });

  it("does not let that read overwrite an event heard while it ran", async () => {
    let answer: (() => void) | undefined;
    const listeners = new Map<string, (payload: unknown) => void>();
    const daemons = createDesktopDaemons(
      BOOT,
      {
        invoke: async (_command, args) => {
          await new Promise<void>((resolve) => (answer = resolve));
          return (args as Record<string, unknown>).id === "settings.get" ? BOOT.settings : { currentId: "local", entries: BOOT.entries, local: BOOT.local };
        },
        listen: async (event, listener) => {
          listeners.set(event, listener);
          return () => undefined;
        },
      },
      async () => undefined,
      () => undefined,
      () => undefined,
    );
    await flush();
    listeners.get("daemons_changed")?.(NEXT);
    answer?.();
    await flush();
    expect(daemons.snapshot()).toEqual(NEXT);
  });

  it("keeps the boot's secret store when the read after the listener answers without one", async () => {
    const booted: DaemonsView = { ...BOOT, secretStore: "file" };
    const daemons = createDesktopDaemons(
      booted,
      {
        invoke: async (_command, args) =>
          (args as Record<string, unknown>).id === "settings.get"
            ? NEXT.settings
            : { currentId: "d1", entries: NEXT.entries, local: NEXT.local },
        listen: async () => () => undefined,
      },
      async () => undefined,
      () => undefined,
      () => undefined,
    );
    await flush();
    expect(daemons.snapshot()).toEqual({ ...NEXT, secretStore: "file" });
  });
});

describe("registry commands", () => {
  it("add sends the entry through engine_command and returns the view", async () => {
    const h = harness(() => ENTRY);
    const entry = await h.daemons.add({ kind: "relay", name: "Office", pairingLink: "pi://x" });
    expect(entry).toEqual(ENTRY);
    expect(h.engineCalls()).toEqual([
      { command: "engine_command", args: { id: "daemon.add", params: { kind: "relay", name: "Office", pairingLink: "pi://x" } } },
    ]);
  });

  it("update and remove name the entry", async () => {
    const h = harness((_command, args) => (args?.id === "daemon.update" ? ENTRY : { removed: true }));
    expect(await h.daemons.update("d2", { name: "Home", password: null })).toEqual(ENTRY);
    await h.daemons.remove("d2");
    expect(h.engineCalls().map((c) => c.args)).toEqual([
      { id: "daemon.update", params: { id: "d2", name: "Home", password: null } },
      { id: "daemon.remove", params: { id: "d2" } },
    ]);
  });

  it("an error text that is a code becomes a DaemonError; anything else stays plain", async () => {
    const named = await rejection(harness(() => Promise.reject("name_taken")).daemons.add({ kind: "direct", name: "Box", address: "a:1" }));
    expect(named).toBeInstanceOf(HostDaemonError);
    expect(named).toMatchObject({ code: "name_taken", message: "name_taken" });

    const asError = await rejection(harness(() => Promise.reject(new Error("local_not_removable"))).daemons.remove("local"));
    expect(asError).toMatchObject({ code: "local_not_removable" });

    const transport = await rejection(harness(() => Promise.reject(new Error("socket closed"))).daemons.remove("d1"));
    expect(transport).not.toBeInstanceOf(HostDaemonError);
    expect(transport).toMatchObject({ message: "socket closed" });

    const other = await rejection(harness(() => Promise.reject("invalid_password")).daemons.remove("d1"));
    expect(other).not.toBeInstanceOf(HostDaemonError);
    expect(other).toBeInstanceOf(Error);
  });

  it("knows the three codes of the secret store", async () => {
    for (const code of ["secret_missing", "secret_unavailable", "secret_store_failed"]) {
      const error = await rejection(harness(() => Promise.reject(code)).daemons.update("d1", { password: "x" }));
      expect(error).toBeInstanceOf(HostDaemonError);
      expect(error).toMatchObject({ code });
    }
  });

  it("tells the person when a removed entry's secret stayed in the store", async () => {
    const stayed = harness(() => ({ removed: true, notices: [{ kind: "secret_not_removed", entry: "d1" }] }));
    await stayed.daemons.remove("d1");
    expect(stayed.tell).toHaveBeenCalledExactlyOnceWith(SECRET_NOT_REMOVED_TEXT);
    expect(SECRET_NOT_REMOVED_TEXT).toMatch(/removed, but .*could not be deleted from the secret store/);
    expect(JSON.stringify(stayed.tell.mock.calls)).not.toContain("d1");

    const clean = harness(() => ({ removed: true }));
    await clean.daemons.remove("d1");
    const odd = harness(() => ({ removed: true, notices: ["x", null, { kind: "other" }, { kind: "secret_not_removed" }] }));
    await odd.daemons.remove("d1");
    expect(clean.tell).not.toHaveBeenCalled();
    expect(odd.tell).toHaveBeenCalledTimes(1);
    const plain = harness(() => undefined);
    await plain.daemons.remove("d1");
    expect(plain.tell).not.toHaveBeenCalled();
  });

  it("an answer that is not an entry rejects", async () => {
    await expect(harness(() => ({ id: 1 })).daemons.add({ kind: "relay", name: "x", pairingLink: "y" })).rejects.toThrow(/unexpected entry/);
  });

  it("setSettings writes the given key", async () => {
    const h = harness();
    await h.daemons.setSettings({ autoStartLocalDaemon: false });
    expect(h.engineCalls().map((c) => c.args)).toEqual([
      { id: "settings.set", params: { key: "autoStartLocalDaemon", value: false } },
    ]);
  });

  it("setSettings rejects with the first failure", async () => {
    const h = harness(() => Promise.reject("not sure"));
    await expect(h.daemons.setSettings({ autoStartLocalDaemon: true })).rejects.toThrow("not sure");
  });
});

describe("local daemon", () => {
  it("each action resolves once accepted", async () => {
    const h = harness(() => ({ accepted: true }));
    await h.daemons.local.start();
    await h.daemons.local.stop();
    await h.daemons.local.restart();
    await h.daemons.local.refresh();
    expect(h.engineCalls().map((c) => c.args)).toEqual([
      { id: "daemon.local.start" },
      { id: "daemon.local.stop" },
      { id: "daemon.local.restart" },
      { id: "daemon.local.refresh" },
    ]);
  });

  it("a refused action rejects with its code", async () => {
    const busy = await rejection(harness(() => Promise.reject("busy")).daemons.local.start());
    expect(busy).toMatchObject({ code: "busy" });
    const unsupported = await rejection(harness(() => Promise.reject("unsupported")).daemons.local.refresh());
    expect(unsupported).toMatchObject({ code: "unsupported" });
  });
});

describe("resolveCurrent", () => {
  it("returns the intent unchanged", async () => {
    const intent = { url: "ws://127.0.0.1:6767", connect: true };
    const h = harness(() => intent);
    expect(await h.daemons.resolveCurrent()).toBe(intent);
    expect(h.calls.filter((c) => c.command === "daemon_resolve_current")).toEqual([{ command: "daemon_resolve_current", args: undefined }]);
  });

  it("rejects with local_stopped as a DaemonError", async () => {
    const error = await rejection(harness(() => Promise.reject("local_stopped")).daemons.resolveCurrent());
    expect(error).toBeInstanceOf(HostDaemonError);
    expect(error).toMatchObject({ code: "local_stopped" });
  });

  it("rejects a plain error for a transport failure and for an answer that is no intent", async () => {
    const transport = await rejection(harness(() => Promise.reject("ipc down")).daemons.resolveCurrent());
    expect(transport).not.toBeInstanceOf(HostDaemonError);
    await expect(harness(() => ({ url: "x" })).daemons.resolveCurrent()).rejects.toThrow(/unexpected connect intent/);
  });

  it("logs nothing of the intent", async () => {
    const h = harness(() => ({ url: "pi://secret-link", connect: true }));
    await h.daemons.resolveCurrent();
    expect(JSON.stringify(h.log.mock.calls)).not.toContain("secret");
  });
});

describe("switchTo", () => {
  it("does not call daemon_switch until a pending storage_set was answered", async () => {
    let answerStorage: (() => void) | undefined;
    const storage = createDesktopStorage({}, () => new Promise<void>((resolve) => (answerStorage = resolve)), () => undefined);
    const h = harness(() => null);
    h.setSettled(() => storage.settled());
    storage.set("pi-studio-pane-layout", "{}");
    void h.daemons.switchTo("d1");
    await flush();
    expect(h.calls.some((c) => c.command === "daemon_switch")).toBe(false);
    answerStorage?.();
    await flush();
    expect(h.calls.filter((c) => c.command === "daemon_switch")).toEqual([{ command: "daemon_switch", args: { id: "d1" } }]);
  });

  it("resolves on cancelled", async () => {
    await expect(harness(() => "cancelled").daemons.switchTo("d1")).resolves.toBeUndefined();
  });

  it("rejects with not_found as a DaemonError", async () => {
    const error = await rejection(harness(() => Promise.reject("not_found")).daemons.switchTo("zz"));
    expect(error).toBeInstanceOf(HostDaemonError);
    expect(error).toMatchObject({ code: "not_found" });
  });

  it("stays pending on success: the page is reloaded", async () => {
    const h = harness(() => null);
    const onSettled = vi.fn<() => void>();
    void h.daemons.switchTo("d1").then(onSettled, onSettled);
    await flush();
    await flush();
    expect(h.calls.filter((c) => c.command === "daemon_switch")).toHaveLength(1);
    expect(onSettled).not.toHaveBeenCalled();
  });
});

describe("onManageRequest", () => {
  it("fires on daemons_manage until unsubscribed", async () => {
    const h = harness();
    const first = vi.fn<() => void>();
    const second = vi.fn<() => void>();
    const off = h.daemons.onManageRequest(first);
    h.daemons.onManageRequest(second);
    await flush();
    h.emit("daemons_manage");
    off();
    h.emit("daemons_manage");
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledTimes(2);
  });
});

describe("remote daemon and ssh hosts", () => {
  it("remote start and refresh go through engine_command", async () => {
    const h = harness(() => ({ accepted: true }));
    await h.daemons.remote.start();
    await h.daemons.remote.refresh();
    expect(h.engineCalls().map((c) => c.args)).toEqual([{ id: "daemon.remote.start" }, { id: "daemon.remote.refresh" }]);
  });

  it("update goes through engine_command, for the local entry and the current ssh entry", async () => {
    const h = harness(() => ({ accepted: true }));
    await h.daemons.local.update();
    await h.daemons.remote.update();
    expect(h.engineCalls().map((c) => c.args)).toEqual([{ id: "daemon.local.update" }, { id: "daemon.remote.update" }]);
  });

  it("a refused remote action rejects with its code", async () => {
    const busy = await rejection(harness(() => Promise.reject("busy")).daemons.remote.start());
    expect(busy).toMatchObject({ code: "busy" });
  });

  it("sshHosts asks ssh_config_hosts and returns the hosts", async () => {
    const hosts = [{ alias: "box", host: "box.example" }];
    const h = harness(() => ({ hosts }));
    expect(await h.daemons.sshHosts()).toEqual(hosts);
    expect(h.calls.filter((c) => c.command === "ssh_config_hosts")).toHaveLength(1);
  });

  it("sshHosts rejects an unexpected shape", async () => {
    await expect(harness(() => ({ nope: 1 })).daemons.sshHosts()).rejects.toThrow("unexpected shape");
  });
});

describe("command-line tool", () => {
  it("state and install go through engine_command and answer the parsed state", async () => {
    const h = harness((_command, args) =>
      args?.id === "cli_tool.install" ? { state: "not_on_path" } : { state: "shadowed", path: "/usr/local/bin/pi-studio" },
    );
    expect(await h.daemons.cliTool.state()).toEqual({ state: "shadowed", path: "/usr/local/bin/pi-studio" });
    expect(await h.daemons.cliTool.install()).toEqual({ state: "not_on_path" });
    expect(h.engineCalls().map((c) => c.args)).toEqual([{ id: "cli_tool.state" }, { id: "cli_tool.install" }]);
  });

  it("an install the app refused rejects with its words, as a plain error", async () => {
    const words = "A file that Pi Studio did not make is at ~/.local/bin/pi-studio. Pi Studio never replaces it.";
    const error = await rejection(harness(() => Promise.reject(words)).daemons.cliTool.install());
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toHaveProperty("code");
    expect((error as Error).message).toBe(words);
  });

  it("an answer that is not a state rejects", async () => {
    await expect(harness(() => ({ state: "nope" })).daemons.cliTool.state()).rejects.toThrow("unexpected shape");
    await expect(harness(() => ({ state: "shadowed" })).daemons.cliTool.install()).rejects.toThrow("unexpected shape");
    await expect(harness(() => null).daemons.cliTool.state()).rejects.toThrow("unexpected shape");
  });
});
