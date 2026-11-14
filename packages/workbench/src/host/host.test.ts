import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { createBrowserHost } from "./browser-host.js";
import { getHost, installHost, resetHostForTests } from "./install.js";
import { flushPaneLayoutWrite, loadPaneLayout } from "../lib/pane-layout-persistence.js";
import {
  COLLAPSE_WRITE_DEBOUNCE_MS,
  useAgentTodosStore,
} from "../features/chat/todos/agent-todos-store.js";
import { TODO_COLLAPSE_STORAGE_KEY } from "../features/chat/todos/todo-collapse-codec.js";
import { useLayoutStore } from "../stores/layout-store.js";
import { useTabStore } from "../stores/tab-store.js";
import { resetLayoutStore, resetTabStore } from "../test/reset-stores.js";
import { createTestHost } from "../test/test-host.js";

const memoryHost = (storage: Record<string, string> = {}) => createTestHost({ storage });

let localSetItem: Mock;

beforeEach(() => {
  resetHostForTests();
  resetTabStore();
  resetLayoutStore();
  localSetItem = vi.fn();
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: localSetItem,
    removeItem: vi.fn(),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("host installation", () => {
  it("falls back to a browser host until one is installed", () => {
    const fallback = getHost();
    expect(fallback.app.title).toBe("Pi-Studio");
    const host = memoryHost();
    expect(installHost(host)).toBe(host);
    expect(getHost()).toBe(host);
  });

  it("keeps the first host and warns once about a different one", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = memoryHost();
    installHost(first);
    installHost(first);
    expect(warn).not.toHaveBeenCalled();

    expect(installHost(memoryHost())).toBe(first);
    installHost(memoryHost());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(getHost()).toBe(first);
  });

  it("passes the app identity through the browser host", () => {
    const host = createBrowserHost({ app: { title: "Acme", version: "1.2.3" } });
    expect(host.app).toEqual({ title: "Acme", version: "1.2.3" });
  });
});

describe("storage through the host", () => {
  it("round-trips the pane layout through the installed host, not localStorage", () => {
    const host = memoryHost();
    installHost(host);
    useLayoutStore.getState().ensureWorkspace("/work");
    useTabStore.setState({ activeWorkspaceCwd: "/work" });

    flushPaneLayoutWrite();

    const raw = host.data.get("pi-studio-pane-layout");
    expect(raw).toBeDefined();
    expect(JSON.parse(raw!)).toMatchObject({ activeWorkspaceCwd: "/work" });
    expect(loadPaneLayout().activeWorkspaceCwd).toBe("/work");
    expect(localSetItem).not.toHaveBeenCalled();
  });

  it("re-reads the todo collapse state from the installed host and writes back to it", () => {
    vi.useFakeTimers();
    const host = memoryHost({
      [TODO_COLLAPSE_STORAGE_KEY]: JSON.stringify({ version: 1, collapsed: ["agent-a"] }),
    });
    installHost(host);
    expect(useAgentTodosStore.getState().collapsed.has("agent-a")).toBe(true);

    useAgentTodosStore.getState().setCollapsed("agent-b", true);
    vi.advanceTimersByTime(COLLAPSE_WRITE_DEBOUNCE_MS);

    expect(JSON.parse(host.data.get(TODO_COLLAPSE_STORAGE_KEY)!)).toEqual({
      version: 1,
      collapsed: ["agent-a", "agent-b"],
    });
    expect(localSetItem).not.toHaveBeenCalled();
  });
});
