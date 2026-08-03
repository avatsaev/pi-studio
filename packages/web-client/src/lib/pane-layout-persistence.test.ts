import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  flushPaneLayoutWrite,
  installPaneLayoutPersistence,
  loadPaneLayout,
  PANE_LAYOUT_WRITE_DEBOUNCE_MS,
  type PersistedPaneLayout,
} from "./pane-layout-persistence.js";
import { useLayoutStore } from "@pi-studio-ui/stores/layout-store.js";
import { tabIdentity, useTabStore, type Tab } from "@pi-studio-ui/stores/tab-store.js";
import { useSessionStore } from "@pi-studio-ui/stores/session-store.js";
import { PANE_LAYOUT_VERSION } from "@pi-studio-ui/features/workspace/pane-tree.js";
import { EMPTY_TIMELINE } from "@pi-studio-ui/timeline/reducer.js";

const KEY = "pi-studio-pane-layout";
const CWD = "/work";

let storage: Record<string, string>;
let setItem: ReturnType<typeof vi.fn>;
let uninstall: (() => void) | null = null;

beforeEach(() => {
  storage = {};
  setItem = vi.fn((key: string, value: string) => {
    storage[key] = value;
  });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage[key] ?? null,
    setItem,
    removeItem: (key: string) => delete storage[key],
  });
  useTabStore.setState({ tabs: [], activeTabId: null, activeWorkspaceCwd: null });
  useLayoutStore.setState({ layouts: {} });
  useSessionStore.setState({ sessions: {}, order: [], activeSessionId: null });
  vi.useFakeTimers();
});

afterEach(() => {
  uninstall?.();
  uninstall = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function tab(partial: Partial<Tab> & Pick<Tab, "id" | "kind" | "data">): Tab {
  return { label: partial.id, closable: true, workspaceCwd: CWD, ...partial } as Tab;
}

/**
 * A chat tab plus the session entry its identity resolves through — a chat is keyed on the
 * daemon-side agent id, not the tab's client-local session id, so the store must know the binding.
 * `agentId: null` is an unmaterialized draft.
 */
function chatTab(sessionId: string, agentId: string | null): Tab {
  useSessionStore.setState((s) => ({
    sessions: {
      ...s.sessions,
      [sessionId]: {
        id: sessionId,
        agentId,
        title: sessionId,
        status: "idle",
        cwd: CWD,
        timeline: EMPTY_TIMELINE,
        userMessageCount: 0,
      },
    },
  }));
  return tab({ id: `chat-${sessionId}`, kind: "chat", data: { sessionId } });
}

function written(): PersistedPaneLayout {
  return JSON.parse(storage[KEY]!) as PersistedPaneLayout;
}

// ─── tabIdentity ───────────────────────────────────────────────────────────────────────────

describe("tabIdentity", () => {
  it("prefixes each kind with its own namespace", () => {
    expect(tabIdentity(chatTab("s1", "a1"))).toBe("agent:a1");
    expect(tabIdentity(tab({ id: "file-a", kind: "file", data: { path: "/a/b.ts" } }))).toBe(
      "file:/a/b.ts",
    );
    expect(
      tabIdentity(tab({ id: "diff-a", kind: "diff", data: { path: "/a/b.ts", staged: true } })),
    ).toBe("diff:staged:/a/b.ts");
    expect(
      tabIdentity(tab({ id: "diff-b", kind: "diff", data: { path: "/a/b.ts", staged: false } })),
    ).toBe("diff:worktree:/a/b.ts");
    expect(tabIdentity(tab({ id: "term-4", kind: "terminal", data: { slot: 4, cwd: CWD } }))).toBe(
      "terminal:4",
    );
    expect(tabIdentity(tab({ id: "mol-a", kind: "molecule", data: { path: "/a/x.cif" } }))).toBe(
      "molecule:/a/x.cif",
    );
  });

  it("is null for a tab with nothing stable to key on", () => {
    expect(
      tabIdentity(tab({ id: "term-new-1", kind: "terminal", data: { slot: null, cwd: CWD } })),
    ).toBeNull();
    expect(
      tabIdentity(tab({ id: "mol-new-1", kind: "molecule", data: { path: null } })),
    ).toBeNull();
    // A chat whose `createAgent` has not returned yet: no daemon id, nothing to restore against.
    expect(tabIdentity(chatTab("s-draft", null))).toBeNull();
  });

  it("keeps a file tab and a molecule tab on the same path distinct", () => {
    const path = "/a/structure.cif";
    const file = tabIdentity(tab({ id: "file-x", kind: "file", data: { path } }));
    const molecule = tabIdentity(tab({ id: "mol-x", kind: "molecule", data: { path } }));
    expect(file).not.toBe(molecule);
    expect(file).toBe(`file:${path}`);
    expect(molecule).toBe(`molecule:${path}`);
  });
});

// ─── Save ──────────────────────────────────────────────────────────────────────────────────

describe("saving the record", () => {
  it("writes identities, the tree, and the focused pane", () => {
    const layoutStore = useLayoutStore.getState();
    layoutStore.ensureWorkspace(CWD);
    const p0 = useLayoutStore.getState().layouts[CWD]!.focusedPaneId;
    useTabStore.setState({ tabs: [chatTab("s1", "a1")] });
    layoutStore.assignTab(CWD, "chat-s1", p0);

    flushPaneLayoutWrite();

    const record = written();
    expect(record.version).toBe(PANE_LAYOUT_VERSION);
    expect(record.workspaces[CWD]).toEqual({
      tree: { kind: "leaf", id: p0 },
      placement: { "agent:a1": p0 },
      activeByPane: { [p0]: "agent:a1" },
      activePaneId: p0,
    });
  });

  it("records which workspace was in view, and drops it when its entry is damaged", () => {
    useLayoutStore.getState().ensureWorkspace(CWD);
    useTabStore.setState({ tabs: [chatTab("s1", "a1")], activeWorkspaceCwd: CWD });
    useLayoutStore.getState().assignTab(CWD, "chat-s1");

    flushPaneLayoutWrite();
    expect(written().activeWorkspaceCwd).toBe(CWD);
    expect(loadPaneLayout().activeWorkspaceCwd).toBe(CWD);

    // Naming a workspace whose geometry did not survive validation would land the user on a workspace
    // with no layout at all, so the loader drops it.
    storage[KEY] = JSON.stringify({
      version: PANE_LAYOUT_VERSION,
      workspaces: { [CWD]: { tree: { kind: "nonsense" } } },
      activeWorkspaceCwd: CWD,
    });
    expect(loadPaneLayout().activeWorkspaceCwd).toBeNull();
  });

  it("omits the active workspace when none is in view", () => {
    useLayoutStore.getState().ensureWorkspace(CWD);
    flushPaneLayoutWrite();
    expect(written().activeWorkspaceCwd).toBeUndefined();
  });

  it("skips identity-less tabs without dropping their pane", () => {
    const layoutStore = useLayoutStore.getState();
    layoutStore.ensureWorkspace(CWD);
    const p0 = useLayoutStore.getState().layouts[CWD]!.focusedPaneId;
    const p1 = layoutStore.splitEmpty(CWD, p0, "right")!;
    useTabStore.setState({
      tabs: [
        chatTab("s1", "a1"),
        tab({ id: "term-new-1", kind: "terminal", data: { slot: null, cwd: CWD } }),
      ],
    });
    layoutStore.assignTab(CWD, "chat-s1", p0);
    layoutStore.assignTab(CWD, "term-new-1", p1);

    flushPaneLayoutWrite();

    const entry = written().workspaces[CWD]!;
    expect(entry.placement).toEqual({ "agent:a1": p0 });
    expect(entry.activeByPane).toEqual({ [p0]: "agent:a1" });
    // The slot-less terminal's pane survives in the tree; only its claim is absent.
    expect(JSON.stringify(entry.tree)).toContain(p1);
  });

  it("round-trips two workspaces intact", () => {
    const layoutStore = useLayoutStore.getState();
    layoutStore.ensureWorkspace(CWD);
    layoutStore.ensureWorkspace("/other");
    const a0 = useLayoutStore.getState().layouts[CWD]!.focusedPaneId;
    const a1 = layoutStore.splitEmpty(CWD, a0, "bottom")!;
    const b0 = useLayoutStore.getState().layouts["/other"]!.focusedPaneId;
    useTabStore.setState({
      tabs: [
        chatTab("s1", "a1"),
        tab({ id: "term-7", kind: "terminal", data: { slot: 7, cwd: CWD } }),
        tab({
          id: "file-x",
          kind: "file",
          data: { path: "/other/x.ts" },
          workspaceCwd: "/other",
        }),
      ],
    });
    layoutStore.assignTab(CWD, "chat-s1", a0);
    layoutStore.assignTab(CWD, "term-7", a1);
    layoutStore.assignTab("/other", "file-x", b0);

    flushPaneLayoutWrite();
    const loaded = loadPaneLayout().workspaces;

    expect([...loaded.keys()].toSorted()).toEqual(["/other", CWD]);
    const work = loaded.get(CWD)!;
    expect(work.tree).toEqual(useLayoutStore.getState().layouts[CWD]!.tree);
    expect(work.placement).toEqual({ "agent:a1": a0, "terminal:7": a1 });
    expect(work.activeByPane).toEqual({ [a0]: "agent:a1", [a1]: "terminal:7" });
    expect(work.activePaneId).toBe(a1);
    expect(loaded.get("/other")!.placement).toEqual({ "file:/other/x.ts": b0 });
  });

  it("keeps unconsumed claims, so a write mid-restore cannot orphan a pane", () => {
    // The exact sequence that lost layouts: the client-side tab replay opens its tabs (and schedules a
    // write) while the daemon's chats and terminals are still in flight.
    useLayoutStore.getState().installPersistedLayouts(
      new Map([
        [
          CWD,
          {
            tree: {
              kind: "split" as const,
              direction: "row" as const,
              children: [
                { kind: "leaf" as const, id: "P0" },
                { kind: "leaf" as const, id: "P1" },
              ],
              sizes: [0.5, 0.5],
            },
            placement: { "file:/work/a.ts": "P0", "agent:a1": "P1" },
            activeByPane: { P0: "file:/work/a.ts", P1: "agent:a1" },
            activePaneId: "P1",
          },
        ],
      ]),
    );
    const fileTab = tab({ id: "file-a", kind: "file", data: { path: "/work/a.ts" } });
    useTabStore.setState({ tabs: [fileTab] });
    useLayoutStore.getState().claimPaneFor(CWD, fileTab.id, tabIdentity(fileTab));

    flushPaneLayoutWrite();

    const entry = written().workspaces[CWD]!;
    // The arrived tab is projected from live state; the chat that has not arrived keeps its claim.
    expect(entry.placement).toEqual({ "file:/work/a.ts": "P0", "agent:a1": "P1" });
    expect(entry.activeByPane).toEqual({ P0: "file:/work/a.ts", P1: "agent:a1" });
  });

  it("drops a claim once hydration settles without it", () => {
    useLayoutStore.getState().installPersistedLayouts(
      new Map([
        [
          CWD,
          {
            tree: { kind: "leaf" as const, id: "P0" },
            placement: { "agent:gone": "P0" },
            activeByPane: {},
            activePaneId: "P0",
          },
        ],
      ]),
    );
    useLayoutStore.getState().markHydrationSource("sessions");
    useLayoutStore.getState().markHydrationSource("terminals");

    flushPaneLayoutWrite();

    // Post-settle the record is exactly the live projection again — no zombie claim is rewritten.
    expect(written().workspaces[CWD]!.placement).toEqual({});
  });
});

// ─── Debounce & triggers ───────────────────────────────────────────────────────────────────

describe("write triggers", () => {
  it("collapses a burst of layout mutations into one write", () => {
    uninstall = installPaneLayoutPersistence();
    const layoutStore = useLayoutStore.getState();
    layoutStore.ensureWorkspace(CWD);
    let pane = useLayoutStore.getState().layouts[CWD]!.focusedPaneId;
    pane = layoutStore.splitEmpty(CWD, pane, "right")!;
    for (let i = 0; i < 20; i += 1) layoutStore.resizeDivider(CWD, [], 0, 0.001);

    expect(setItem).not.toHaveBeenCalled(); // nothing written mid-drag
    vi.advanceTimersByTime(PANE_LAYOUT_WRITE_DEBOUNCE_MS);
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it("writes when a terminal acquires its daemon slot", () => {
    const layoutStore = useLayoutStore.getState();
    layoutStore.ensureWorkspace(CWD);
    const p0 = useLayoutStore.getState().layouts[CWD]!.focusedPaneId;
    useTabStore.setState({
      tabs: [tab({ id: "term-new-1", kind: "terminal", data: { slot: null, cwd: CWD } })],
    });
    layoutStore.assignTab(CWD, "term-new-1", p0);
    uninstall = installPaneLayoutPersistence();

    // `TerminalPanel` reports the slot the daemon assigned — no layout state changes at all.
    useTabStore.getState().updateData("term-new-1", { slot: 9 });
    vi.advanceTimersByTime(PANE_LAYOUT_WRITE_DEBOUNCE_MS);

    expect(setItem).toHaveBeenCalledTimes(1);
    expect(written().workspaces[CWD]!.placement).toEqual({ "terminal:9": p0 });
  });

  it("writes when a draft chat binds its agent", () => {
    const layoutStore = useLayoutStore.getState();
    layoutStore.ensureWorkspace(CWD);
    const p0 = useLayoutStore.getState().layouts[CWD]!.focusedPaneId;
    useTabStore.setState({ tabs: [chatTab("s1", null)] });
    layoutStore.assignTab(CWD, "chat-s1", p0);
    uninstall = installPaneLayoutPersistence();

    // `materialize.ts`'s `createAgent` returns — a session-store mutation, no tab or layout change.
    useSessionStore.getState().bindAgent("s1", "a1");
    vi.advanceTimersByTime(PANE_LAYOUT_WRITE_DEBOUNCE_MS);

    expect(setItem).toHaveBeenCalledTimes(1);
    expect(written().workspaces[CWD]!.placement).toEqual({ "agent:a1": p0 });
  });

  it("ignores session changes that do not touch identity", () => {
    useLayoutStore.getState().ensureWorkspace(CWD);
    useTabStore.setState({ tabs: [chatTab("s1", "a1")] });
    uninstall = installPaneLayoutPersistence();

    useSessionStore.getState().setTitle("s1", "Renamed");
    useSessionStore.getState().setStatus("s1", "running");
    vi.advanceTimersByTime(PANE_LAYOUT_WRITE_DEBOUNCE_MS);

    expect(setItem).not.toHaveBeenCalled();
  });

  it("ignores tab changes that do not touch identity", () => {
    useTabStore.setState({ tabs: [chatTab("s1", "a1")] });
    uninstall = installPaneLayoutPersistence();

    useTabStore.getState().updateLabel("chat-s1", "Renamed");
    vi.advanceTimersByTime(PANE_LAYOUT_WRITE_DEBOUNCE_MS);

    expect(setItem).not.toHaveBeenCalled();
  });

  it("stops writing once uninstalled", () => {
    const teardown = installPaneLayoutPersistence();
    teardown();
    useLayoutStore.getState().ensureWorkspace(CWD);
    vi.advanceTimersByTime(PANE_LAYOUT_WRITE_DEBOUNCE_MS);
    expect(setItem).not.toHaveBeenCalled();
  });
});

// ─── Load ──────────────────────────────────────────────────────────────────────────────────

describe("loading the record", () => {
  function persist(record: unknown): void {
    storage[KEY] = JSON.stringify(record);
  }

  it("returns an empty map when nothing is stored", () => {
    expect(loadPaneLayout().workspaces.size).toBe(0);
  });

  it("discards the whole record on a version mismatch", () => {
    persist({
      version: PANE_LAYOUT_VERSION + 1,
      workspaces: { [CWD]: { tree: { kind: "leaf", id: "p0" }, placement: {}, activeByPane: {} } },
    });
    expect(loadPaneLayout().workspaces.size).toBe(0);
  });

  it("drops only the malformed workspace entry", () => {
    persist({
      version: PANE_LAYOUT_VERSION,
      workspaces: {
        "/good": { tree: { kind: "leaf", id: "p0" }, placement: {}, activeByPane: {} },
        // A split with one child is structural damage, not drift.
        "/bad": {
          tree: {
            kind: "split",
            direction: "row",
            children: [{ kind: "leaf", id: "p1" }],
            sizes: [1],
          },
          placement: {},
          activeByPane: {},
        },
      },
    });
    const loaded = loadPaneLayout().workspaces;
    expect([...loaded.keys()]).toEqual(["/good"]);
  });

  it("drops placement and active entries naming panes absent from the tree", () => {
    persist({
      version: PANE_LAYOUT_VERSION,
      workspaces: {
        [CWD]: {
          tree: {
            kind: "split",
            direction: "row",
            children: [
              { kind: "leaf", id: "p0" },
              { kind: "leaf", id: "p1" },
            ],
            sizes: [0.5, 0.5],
          },
          placement: { "agent:s1": "p0", "agent:s2": "ghost" },
          activeByPane: { p1: "agent:s3", ghost: "agent:s4" },
          activePaneId: "ghost",
        },
      },
    });
    const entry = loadPaneLayout().workspaces.get(CWD)!;
    expect(entry.placement).toEqual({ "agent:s1": "p0" });
    expect(entry.activeByPane).toEqual({ p1: "agent:s3" });
    // An `activePaneId` that is not in the tree becomes null — the caller picks the fallback.
    expect(entry.activePaneId).toBeNull();
  });

  it("renormalizes drifted sizes rather than discarding the entry", () => {
    persist({
      version: PANE_LAYOUT_VERSION,
      workspaces: {
        [CWD]: {
          tree: {
            kind: "split",
            direction: "row",
            children: [
              { kind: "leaf", id: "p0" },
              { kind: "leaf", id: "p1" },
            ],
            sizes: [1, 1],
          },
          placement: {},
          activeByPane: {},
        },
      },
    });
    const entry = loadPaneLayout().workspaces.get(CWD)!;
    expect(entry.tree).toMatchObject({ sizes: [0.5, 0.5] });
  });

  it("survives corrupt and nonsensical storage without throwing", () => {
    for (const raw of ["not json", "null", '"a string"', "7", "[]", "{}", '{"version":1}']) {
      storage[KEY] = raw;
      expect(() => loadPaneLayout()).not.toThrow();
      expect(loadPaneLayout().workspaces.size).toBe(0);
    }
  });
});
