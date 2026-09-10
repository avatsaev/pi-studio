import { beforeEach, describe, expect, it } from "vitest";
import type { PiStudioClient, ViewerSettingsPatch } from "@av-pi-studio/client";
import type { ViewerSettings } from "@av-pi-studio/protocol";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { isViewerEnabled, useViewerSettingsStore } from "./viewer-settings-store.js";

/**
 * Minimal stub of the `PiStudioClient` surface the store touches
 * (`hasViewerSettingsCapability`/`getViewerSettings`/`setViewerSettings`/
 * `onViewerSettingsUpdate`) — no real transport, matching `agent-ui-store.test.ts`'s
 * `makeFakeClient` shape.
 */
interface FakeClient {
  client: PiStudioClient;
  setCapable(v: boolean): void;
  setGetResult(fn: () => Promise<ViewerSettings>): void;
  setSetResult(fn: (patch: ViewerSettingsPatch) => Promise<ViewerSettings>): void;
  readonly setCalls: ViewerSettingsPatch[];
}

async function defaultGetResult(): Promise<ViewerSettings> {
  return { version: 1, viewers: {} };
}

function defaultSetResult(patch: ViewerSettingsPatch): Promise<ViewerSettings> {
  return Promise.resolve({ version: 1, viewers: patch as ViewerSettings["viewers"] });
}

function makeFakeClient(opts: { capable?: boolean } = {}): FakeClient {
  let capable = opts.capable ?? true;
  let getImpl: () => Promise<ViewerSettings> = defaultGetResult;
  let setImpl: (patch: ViewerSettingsPatch) => Promise<ViewerSettings> = defaultSetResult;
  const setCalls: ViewerSettingsPatch[] = [];

  const client = {
    hasViewerSettingsCapability: () => capable,
    getViewerSettings: () => getImpl(),
    setViewerSettings: (patch: ViewerSettingsPatch) => {
      setCalls.push(patch);
      return setImpl(patch);
    },
    onViewerSettingsUpdate: () => () => {},
  } as unknown as PiStudioClient;

  return {
    client,
    setCapable(v) {
      capable = v;
    },
    setGetResult(fn) {
      getImpl = fn;
    },
    setSetResult(fn) {
      setImpl = fn;
    },
    get setCalls() {
      return setCalls;
    },
  };
}

beforeEach(() => {
  useViewerSettingsStore.getState().reset();
  useConnectionStore.setState({ client: null });
});

describe("viewer-settings-store", () => {
  it("fresh store: unhydrated, and everything reads as enabled", () => {
    const state = useViewerSettingsStore.getState();
    expect(state.loaded).toBe(false);
    expect(state.isViewerEnabled("anything")).toBe(true);
    expect(isViewerEnabled("anything")).toBe(true);
  });

  it("hydrate() against a daemon reporting a disabled viewer sets loaded/capable and the per-id read", async () => {
    const fake = makeFakeClient();
    fake.setGetResult(async () => ({
      version: 1,
      viewers: { molviewer: { enabled: false } },
    }));
    useConnectionStore.setState({ client: fake.client });

    await useViewerSettingsStore.getState().hydrate();

    const state = useViewerSettingsStore.getState();
    expect(state.loaded).toBe(true);
    expect(state.capable).toBe(true);
    expect(state.isViewerEnabled("molviewer")).toBe(false);
    expect(state.isViewerEnabled("other")).toBe(true);
  });

  it("hydrate() against a capability-free daemon issues no RPC and leaves everything enabled", async () => {
    const fake = makeFakeClient({ capable: false });
    let getCalls = 0;
    fake.setGetResult(async () => {
      getCalls++;
      return { version: 1, viewers: {} };
    });
    useConnectionStore.setState({ client: fake.client });

    await useViewerSettingsStore.getState().hydrate();

    expect(getCalls).toBe(0);
    const state = useViewerSettingsStore.getState();
    expect(state.capable).toBe(false);
    expect(state.loaded).toBe(true);
    expect(state.isViewerEnabled("molviewer")).toBe(true);
  });

  it("hydrate() on RPC failure degrades to all-enabled but still sets loaded — a failed fetch must not wedge tab restore", async () => {
    const fake = makeFakeClient();
    fake.setGetResult(async () => {
      throw new Error("network error");
    });
    useConnectionStore.setState({ client: fake.client });

    await useViewerSettingsStore.getState().hydrate();

    const state = useViewerSettingsStore.getState();
    expect(state.loaded).toBe(true);
    expect(state.isViewerEnabled("molviewer")).toBe(true);
  });

  it("applyUpdate replaces viewers wholesale — a row present locally but absent from the push is gone", () => {
    useViewerSettingsStore.setState({
      loaded: true,
      capable: true,
      viewers: { molviewer: { enabled: false }, other: { enabled: false } },
    });

    useViewerSettingsStore.getState().applyUpdate({
      version: 1,
      viewers: { molviewer: { enabled: false } },
    });

    const state = useViewerSettingsStore.getState();
    expect(state.viewers).toEqual({ molviewer: { enabled: false } });
    expect(state.isViewerEnabled("other")).toBe(true);
  });

  it("setEnabled flips state before the RPC resolves, then reconciles with the effective document", async () => {
    const fake = makeFakeClient();
    const { promise: setPromise, resolve: resolveSet } = Promise.withResolvers<ViewerSettings>();
    fake.setSetResult(() => setPromise);
    useConnectionStore.setState({ client: fake.client });

    const pending = useViewerSettingsStore.getState().setEnabled("molviewer", false);
    // Optimistic flip already visible before the RPC settles.
    expect(useViewerSettingsStore.getState().isViewerEnabled("molviewer")).toBe(false);

    resolveSet({ version: 1, viewers: { molviewer: { enabled: false, config: { x: 1 } } } });
    await pending;

    expect(useViewerSettingsStore.getState().viewers["molviewer"]).toEqual({
      enabled: false,
      config: { x: 1 },
    });
    expect(fake.setCalls).toEqual([{ molviewer: { enabled: false } }]);
  });

  it("setEnabled restores the exact prior value on rejection, including restoring 'no row at all'", async () => {
    const fake = makeFakeClient();
    fake.setSetResult(async () => {
      throw new Error("rejected");
    });
    useConnectionStore.setState({ client: fake.client });

    // No row exists yet for "molviewer" before the call.
    expect(useViewerSettingsStore.getState().viewers["molviewer"]).toBeUndefined();

    await useViewerSettingsStore.getState().setEnabled("molviewer", false);

    expect(useViewerSettingsStore.getState().viewers["molviewer"]).toBeUndefined();
  });

  it("setEnabled restores a pre-existing row's exact prior value on rejection", async () => {
    const fake = makeFakeClient();
    fake.setSetResult(async () => {
      throw new Error("rejected");
    });
    useConnectionStore.setState({ client: fake.client });
    useViewerSettingsStore.setState({
      loaded: true,
      capable: true,
      viewers: { molviewer: { enabled: true, config: { theme: "dark" } } },
    });

    await useViewerSettingsStore.getState().setEnabled("molviewer", false);

    expect(useViewerSettingsStore.getState().viewers["molviewer"]).toEqual({
      enabled: true,
      config: { theme: "dark" },
    });
  });

  it("reset() returns to the unhydrated state; a subsequent hydrate re-populates it", async () => {
    const fake = makeFakeClient();
    fake.setGetResult(async () => ({
      version: 1,
      viewers: { molviewer: { enabled: false } },
    }));
    useConnectionStore.setState({ client: fake.client });
    await useViewerSettingsStore.getState().hydrate();
    expect(useViewerSettingsStore.getState().loaded).toBe(true);

    useViewerSettingsStore.getState().reset();
    expect(useViewerSettingsStore.getState().loaded).toBe(false);
    expect(useViewerSettingsStore.getState().viewers).toEqual({});

    await useViewerSettingsStore.getState().hydrate();
    expect(useViewerSettingsStore.getState().isViewerEnabled("molviewer")).toBe(false);
  });
});
