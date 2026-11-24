import { type Mock, beforeEach, describe, expect, it, vi } from "vitest";
import type { PiStudioClient } from "@av-pi-studio/client";
import type { DaemonUpdateStatus } from "@av-pi-studio/protocol";
import { useConnectionStore } from "../../lib/connection/connection-store.js";
import { resetDaemonUpdateState } from "../../test/reset-stores.js";
import {
  RESTART_EXCUSE_MS,
  isRestartExpected,
  useDaemonUpdateStore,
} from "./daemon-update-store.js";
import { daemonUpdateView } from "./daemon-update-presentation.js";
import { bindDaemonUpdate } from "./use-daemon-update.js";

function status(version: string): DaemonUpdateStatus {
  return {
    currentVersion: "0.0.129",
    installKind: "npm-global",
    autoCheck: true,
    state: { kind: "available", version },
  };
}

type StatusHandler = (next: DaemonUpdateStatus) => void;

interface FakeClient {
  client: PiStudioClient;
  getDaemonUpdateStatus: Mock<() => Promise<DaemonUpdateStatus>>;
  onDaemonUpdateStatus: Mock<(handler: StatusHandler) => () => void>;
  /** Delivers a broadcast to the subscribed handler. */
  broadcast: StatusHandler;
  unsubscribed(): number;
}

function makeFakeClient(opts: {
  capable?: boolean;
  get?: () => Promise<DaemonUpdateStatus>;
}): FakeClient {
  let handler: StatusHandler | null = null;
  let unsubscribes = 0;
  const getDaemonUpdateStatus = vi.fn(opts.get ?? (async () => status("0.0.130")));
  const onDaemonUpdateStatus = vi.fn((h: StatusHandler) => {
    handler = h;
    return () => {
      unsubscribes += 1;
    };
  });
  const client = {
    hasDaemonUpdateCapability: () => opts.capable ?? true,
    getDaemonUpdateStatus,
    onDaemonUpdateStatus,
  } as unknown as PiStudioClient;
  return {
    client,
    getDaemonUpdateStatus,
    onDaemonUpdateStatus,
    broadcast: (next) => handler?.(next),
    unsubscribed: () => unsubscribes,
  };
}

/** Lets the promise callbacks of an already settled request run (no timers involved). */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await Promise.resolve();
}

beforeEach(() => {
  resetDaemonUpdateState();
  useConnectionStore.setState({ client: null });
});

describe("daemon update binding", () => {
  it("fetches the status once the connection is open and draws the pill from it", async () => {
    const fake = makeFakeClient({});
    useConnectionStore.setState({ client: fake.client });

    bindDaemonUpdate("open", fake.client);
    await flush();

    expect(fake.getDaemonUpdateStatus).toHaveBeenCalledTimes(1);
    const current = useDaemonUpdateStore.getState().status;
    expect(current?.state).toEqual({ kind: "available", version: "0.0.130" });
    expect(current && daemonUpdateView(current)?.text).toBe("Daemon 0.0.130");
  });

  it("follows the broadcast", async () => {
    const fake = makeFakeClient({});
    useConnectionStore.setState({ client: fake.client });
    bindDaemonUpdate("open", fake.client);
    await flush();

    fake.broadcast({ ...status("0.0.130"), state: { kind: "installing", version: "0.0.130" } });

    expect(useDaemonUpdateStore.getState().status?.state.kind).toBe("installing");
  });

  it("sends nothing and shows nothing to a daemon without the capability", async () => {
    const fake = makeFakeClient({ capable: false });
    useConnectionStore.setState({ client: fake.client });

    bindDaemonUpdate("open", fake.client);
    await flush();

    expect(fake.getDaemonUpdateStatus).not.toHaveBeenCalled();
    expect(fake.onDaemonUpdateStatus).not.toHaveBeenCalled();
    expect(useDaemonUpdateStore.getState().status).toBeNull();
  });

  it.each(["idle", "connecting", "closing", "closed"] as const)(
    "clears the status while the connection is %s",
    async (state) => {
      const fake = makeFakeClient({});
      useConnectionStore.setState({ client: fake.client });
      bindDaemonUpdate("open", fake.client);
      await flush();
      expect(useDaemonUpdateStore.getState().status).not.toBeNull();
      fake.getDaemonUpdateStatus.mockClear();

      bindDaemonUpdate(state, fake.client);

      expect(useDaemonUpdateStore.getState().status).toBeNull();
      expect(fake.getDaemonUpdateStatus).not.toHaveBeenCalled();
    },
  );

  it("asks again on the next transition to connected", async () => {
    const fake = makeFakeClient({});
    useConnectionStore.setState({ client: fake.client });
    bindDaemonUpdate("open", fake.client);
    await flush();
    bindDaemonUpdate("connecting", fake.client);

    bindDaemonUpdate("open", fake.client);
    await flush();

    expect(fake.getDaemonUpdateStatus).toHaveBeenCalledTimes(2);
    expect(useDaemonUpdateStore.getState().status).not.toBeNull();
  });

  it("hands back the unsubscribe of the broadcast", () => {
    const fake = makeFakeClient({});
    useConnectionStore.setState({ client: fake.client });

    const unbind = bindDaemonUpdate("open", fake.client);
    unbind?.();

    expect(fake.unsubscribed()).toBe(1);
  });

  it("drops a fetched status that a broadcast overtook", async () => {
    const pending = Promise.withResolvers<DaemonUpdateStatus>();
    const fake = makeFakeClient({ get: () => pending.promise });
    useConnectionStore.setState({ client: fake.client });
    bindDaemonUpdate("open", fake.client);

    fake.broadcast({ ...status("0.0.131"), state: { kind: "restarting", version: "0.0.131" } });
    pending.resolve(status("0.0.130"));
    await flush();

    expect(useDaemonUpdateStore.getState().status?.state).toEqual({
      kind: "restarting",
      version: "0.0.131",
    });
  });

  it("drops a fetched status once the connection ended", async () => {
    const pending = Promise.withResolvers<DaemonUpdateStatus>();
    const fake = makeFakeClient({ get: () => pending.promise });
    useConnectionStore.setState({ client: fake.client });
    bindDaemonUpdate("open", fake.client);

    bindDaemonUpdate("closed", fake.client);
    pending.resolve(status("0.0.130"));
    await flush();

    expect(useDaemonUpdateStore.getState().status).toBeNull();
  });

  it("stays empty when the request fails", async () => {
    const fake = makeFakeClient({ get: () => Promise.reject(new Error("boom")) });
    useConnectionStore.setState({ client: fake.client });

    bindDaemonUpdate("open", fake.client);
    await flush();

    expect(useDaemonUpdateStore.getState().status).toBeNull();
  });
});

describe("the announced restart", () => {
  it("is remembered when the status says restarting, and outlives the disconnect", () => {
    const restarting = {
      ...status("0.0.131"),
      state: { kind: "restarting", version: "0.0.131" },
    } as const;
    useDaemonUpdateStore.getState().apply(restarting);
    expect(useDaemonUpdateStore.getState().restartAnnouncedAt).not.toBeNull();

    useDaemonUpdateStore.getState().reset();

    expect(useDaemonUpdateStore.getState().status).toBeNull();
    expect(useDaemonUpdateStore.getState().restartAnnouncedAt).not.toBeNull();
  });

  it("is forgotten when a later status says anything else", () => {
    const store = useDaemonUpdateStore.getState();
    store.apply({ ...status("0.0.131"), state: { kind: "restarting", version: "0.0.131" } });

    store.apply({ ...status("0.0.131"), state: { kind: "idle" } });

    expect(useDaemonUpdateStore.getState().restartAnnouncedAt).toBeNull();
  });

  it("excuses a drop for four minutes at most", () => {
    expect(isRestartExpected(null, 1_000)).toBe(false);
    expect(isRestartExpected(1_000, 1_000 + RESTART_EXCUSE_MS - 1)).toBe(true);
    expect(isRestartExpected(1_000, 1_000 + RESTART_EXCUSE_MS)).toBe(false);
  });
});
