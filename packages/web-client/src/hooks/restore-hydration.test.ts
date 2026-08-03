/**
 * The restore hooks' half of the pane-layout hydration settle point. The hooks themselves cannot be
 * rendered here (this project's vitest runs `.test.ts` under plain Node, no DOM), so their extracted
 * bodies are driven directly — which is exactly where the `finally` that reports hydration lives.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { PiStudioClient } from "@av-pi-studio/client";
import { runSessionRestore } from "./use-session-restore.js";
import { runTerminalRestore } from "./use-terminal-restore.js";
import { useLayoutStore } from "@pi-studio-ui/stores/layout-store.js";
import { useSessionStore } from "@pi-studio-ui/stores/session-store.js";
import { useTabStore } from "@pi-studio-ui/stores/tab-store.js";
import { useUiStore } from "@pi-studio-ui/stores/ui-store.js";

/** A client whose every RPC resolves to `response`, or rejects when `response` is an Error. */
function stubClient(response: unknown): PiStudioClient {
  return {
    connection: {
      request: async () => {
        if (response instanceof Error) throw response;
        return response;
      },
    },
  } as unknown as PiStudioClient;
}

beforeEach(() => {
  useLayoutStore.setState({
    layouts: {},
    hydrationSources: { sessions: false, terminals: false },
    restoring: false,
    pendingActiveWorkspace: null,
  });
  useSessionStore.setState({ sessions: {}, order: [], activeSessionId: null });
  useTabStore.setState({ tabs: [], activeTabId: null, activeWorkspaceCwd: null });
  useUiStore.setState({ collapsedWorkspaces: new Set(), cwd: "~" });
});

describe("terminal restore hydration signal", () => {
  it("reports when the daemon lists no terminals", async () => {
    await runTerminalRestore(stubClient({ terminals: [] }));
    expect(useLayoutStore.getState().hydrationSources.terminals).toBe(true);
  });

  it("reports when the request fails", async () => {
    await runTerminalRestore(stubClient(new Error("socket closed")));
    expect(useLayoutStore.getState().hydrationSources.terminals).toBe(true);
  });

  it("reports when the response carries no terminals field at all", async () => {
    await runTerminalRestore(stubClient({}));
    expect(useLayoutStore.getState().hydrationSources.terminals).toBe(true);
  });

  it("does not report the other source", async () => {
    await runTerminalRestore(stubClient({ terminals: [] }));
    expect(useLayoutStore.getState().hydrationSources.sessions).toBe(false);
  });
});

describe("session restore hydration signal", () => {
  it("reports when the daemon lists no agents", async () => {
    await runSessionRestore(stubClient({ agents: [] }));
    expect(useLayoutStore.getState().hydrationSources.sessions).toBe(true);
  });

  it("reports when the request fails", async () => {
    await runSessionRestore(stubClient(new Error("socket closed")));
    expect(useLayoutStore.getState().hydrationSources.sessions).toBe(true);
  });

  it("does not report the other source", async () => {
    await runSessionRestore(stubClient({ agents: [] }));
    expect(useLayoutStore.getState().hydrationSources.terminals).toBe(false);
  });
});

describe("the settle point both sources gate", () => {
  it("only settles once both have reported", async () => {
    useLayoutStore.getState().installPersistedLayouts(
      new Map([
        [
          "/work",
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
            placement: { "agent:s1": "P0", "agent:s2": "P1" },
            activeByPane: {},
            activePaneId: "P0",
          },
        ],
      ]),
    );

    await runSessionRestore(stubClient({ agents: [] }));
    // Sessions alone must not prune: the terminals inventory has not arrived yet.
    expect(useLayoutStore.getState().layouts["/work"]!.pendingPlacement).toEqual({
      "agent:s1": "P0",
      "agent:s2": "P1",
    });

    await runTerminalRestore(stubClient({ terminals: [] }));

    const layout = useLayoutStore.getState().layouts["/work"]!;
    expect(layout.pendingPlacement).toEqual({});
    // Nothing ever claimed either pane, so the tree collapses to the single-leaf terminal state.
    expect(layout.tree.kind).toBe("leaf");
  });
});

// ─── Claimed chat restore ──────────────────────────────────────────────────────────────────

/**
 * A persisted two-pane row (`P0` | `P1`) for `cwd`, holding `placement` as unconsumed claims.
 * `inView` mirrors the record's `activeWorkspaceCwd` — which workspace the user was looking at.
 */
function installClaims(
  cwd: string,
  placement: Record<string, string>,
  inView: string | null = null,
): void {
  useLayoutStore.getState().installPersistedLayouts(
    new Map([
      [
        cwd,
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
          placement,
          activeByPane: {},
          activePaneId: "P0",
        },
      ],
    ]),
    inView,
  );
}

/** A claimless single-pane record: geometry only, so nothing is waiting for a tab to arrive. */
function singlePane() {
  return {
    tree: { kind: "leaf" as const, id: "P0" },
    placement: {},
    activeByPane: {},
    activePaneId: "P0",
  };
}

describe("restoring the chats a persisted layout claims", () => {
  const CWD = "/work";

  /** Two agents in `/work`; `a1` is the more recent, so it is `order[0]` after restore. */
  const twoAgents = {
    agents: [
      { agentId: "a1", cwd: CWD, lastActivity: 2, title: "One" },
      { agentId: "a2", cwd: CWD, lastActivity: 1, title: "Two" },
    ],
  };

  it("reopens every claimed chat into the pane that claimed it", async () => {
    installClaims(CWD, { "agent:a1": "P0", "agent:a2": "P1" });

    await runSessionRestore(stubClient(twoAgents));

    const layout = useLayoutStore.getState().layouts[CWD]!;
    expect(
      useTabStore
        .getState()
        .tabs.map((t) => t.id)
        .toSorted(),
    ).toEqual(["chat-s-a1", "chat-s-a2"]);
    expect(layout.placement).toEqual({ "chat-s-a1": "P0", "chat-s-a2": "P1" });
    // Both claims were consumed, so the settle point has nothing left to prune.
    expect(layout.pendingPlacement).toEqual({});
  });

  it("keys a restored chat on its agent id, not the session id it is reloaded under", async () => {
    // The pane was persisted while the chat lived under some earlier session id; only `agent:a1`
    // survives a reload, and it is what the restored `s-a1` tab must match.
    installClaims(CWD, { "agent:a1": "P1" });

    await runSessionRestore(stubClient({ agents: [twoAgents.agents[0]] }));

    expect(useLayoutStore.getState().layouts[CWD]!.placement).toEqual({ "chat-s-a1": "P1" });
  });

  it("opens only the most recent chat when nothing is claimed", async () => {
    await runSessionRestore(stubClient(twoAgents));

    expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual(["chat-s-a1"]);
  });

  it("restores a claimed chat in a workspace that is not the active one", async () => {
    installClaims("/other", { "agent:a2": "P1" });

    await runSessionRestore(
      stubClient({
        agents: [twoAgents.agents[0], { ...twoAgents.agents[1]!, cwd: "/other" }],
      }),
    );

    // `/work` gets its default single tab; `/other`'s claimed pane is filled even though the user
    // lands in `/work` — otherwise switching workspaces would show a collapsed layout.
    expect(
      useTabStore
        .getState()
        .tabs.map((t) => t.id)
        .toSorted(),
    ).toEqual(["chat-s-a1", "chat-s-a2"]);
    expect(useLayoutStore.getState().layouts["/other"]!.placement).toEqual({ "chat-s-a2": "P1" });
  });

  it("leaves an unclaimed pane's chat out and prunes it at the settle point", async () => {
    installClaims(CWD, { "agent:a1": "P0", "terminal:4": "P1" });

    await runSessionRestore(stubClient(twoAgents));
    await runTerminalRestore(stubClient({ terminals: [] }));

    const layout = useLayoutStore.getState().layouts[CWD]!;
    // `a2` was never claimed, so it stays closed; the terminal never came back, so its pane goes.
    expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual(["chat-s-a1"]);
    expect(layout.tree).toEqual({ kind: "leaf", id: "P0" });
  });
});

// ─── Claimed terminal restore ──────────────────────────────────────────────────────────────

describe("restoring the terminals a persisted layout claims", () => {
  it("reopens only a claimed terminal once its workspace has a persisted record", async () => {
    // The exact bug reported live: an unrelated terminal left running in a workspace that WAS split
    // used to force its way into a tab regardless, on every reload.
    installClaims("/work", { "terminal:1": "P0" });

    await runTerminalRestore(
      stubClient({
        terminals: [
          { slot: 1, name: "one", cwd: "/work", closed: false },
          { slot: 2, name: "two", cwd: "/work", closed: false }, // no claim for this one
        ],
      }),
    );

    expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual(["term-1"]);
    expect(useLayoutStore.getState().layouts["/work"]!.placement).toEqual({ "term-1": "P0" });
  });

  it("still reopens every terminal in a workspace with no persisted record at all", async () => {
    // No `installClaims` call — nothing was ever split here — matching the original "never leak a
    // terminal silently" guarantee for a workspace that has no arrangement to conflict with.
    await runTerminalRestore(
      stubClient({
        terminals: [
          { slot: 1, name: "one", cwd: "/scratch", closed: false },
          { slot: 2, name: "two", cwd: "/scratch", closed: false },
        ],
      }),
    );

    expect(
      useTabStore
        .getState()
        .tabs.map((t) => t.id)
        .toSorted(),
    ).toEqual(["term-1", "term-2"]);
  });

  it("a record for one workspace never suppresses a terminal in a different, unrecorded one", async () => {
    installClaims("/work", { "terminal:1": "P0" });

    await runTerminalRestore(
      stubClient({
        terminals: [
          { slot: 1, name: "one", cwd: "/work", closed: false },
          { slot: 9, name: "stray", cwd: "/other", closed: false }, // /other was never split
        ],
      }),
    );

    expect(
      useTabStore
        .getState()
        .tabs.map((t) => t.id)
        .toSorted(),
    ).toEqual(["term-1", "term-9"]);
  });
});

// ─── Seeding the sidebar / explorer / active chat from the workspace in view ────────────────

describe("seeding the sidebar and explorer on restore", () => {
  /** `a1` in `/other` is the globally most recent, so it is `order[0]`; `a2` lives in `/work`. */
  const acrossTwoWorkspaces = {
    agents: [
      { agentId: "a1", cwd: "/other", lastActivity: 2, title: "Newest" },
      { agentId: "a2", cwd: "/work", lastActivity: 1, title: "In view" },
    ],
  };

  it("expands the workspace that was in view, not the newest agent's", async () => {
    // The reported bug: panes came back in `/work` while the sidebar sat expanded on `/other`,
    // because the collapse set was computed from `order[0]` — a global winner, a different question.
    installClaims("/work", { "agent:a2": "P0" }, "/work");

    await runSessionRestore(stubClient(acrossTwoWorkspaces));

    const { collapsedWorkspaces, cwd } = useUiStore.getState();
    expect(collapsedWorkspaces.has("/work")).toBe(false);
    expect(collapsedWorkspaces.has("/other")).toBe(true);
    expect(cwd).toBe("/work");
  });

  it("seeds the active conversation from the workspace in view when no tab overwrites it", async () => {
    // Both workspaces are recorded and nothing is claimed, so restore opens no chat tab at all: no
    // `open()` runs to bring its own workspace into view, and this seed is the only writer. (Once any
    // chat tab does open it wins, which is why the non-chat-focused-pane case is fixed at the settle
    // point instead — see restore-active-workspace.test.ts.)
    useLayoutStore.getState().installPersistedLayouts(
      new Map([
        ["/work", singlePane()],
        ["/other", singlePane()],
      ]),
      "/work",
    );

    await runSessionRestore(stubClient(acrossTwoWorkspaces));

    expect(useTabStore.getState().tabs).toEqual([]);
    expect(useSessionStore.getState().activeSessionId).toBe("s-a2");
  });

  it("falls back to the newest agent's workspace when nothing was in view", async () => {
    // Fresh install / cleared storage: the pre-split default is the only sensible target.
    await runSessionRestore(stubClient(acrossTwoWorkspaces));

    const { collapsedWorkspaces, cwd } = useUiStore.getState();
    expect(collapsedWorkspaces.has("/other")).toBe(false);
    expect(collapsedWorkspaces.has("/work")).toBe(true);
    expect(cwd).toBe("/other");
    expect(useSessionStore.getState().activeSessionId).toBe("s-a1");
  });

  it("still force-opens the newest agent when ITS OWN workspace has no record", async () => {
    // task-011's rule, which must not drift onto the view target: `/work` has a record and is where
    // restore is heading, but `/other` has none — so `a1` still gets its fallback tab, and `a2` comes
    // back from its claim.
    installClaims("/work", { "agent:a2": "P0" }, "/work");

    await runSessionRestore(stubClient(acrossTwoWorkspaces));

    expect(
      useTabStore
        .getState()
        .tabs.map((t) => t.id)
        .toSorted(),
    ).toEqual(["chat-s-a1", "chat-s-a2"]);
  });

  it("does not force-open the newest agent when its own workspace IS recorded", async () => {
    // Both agents live in the recorded workspace and only `a2` is claimed: `a1` must stay closed,
    // or it lands in a pane a claim already spoke for.
    installClaims("/work", { "agent:a2": "P0" }, "/work");

    await runSessionRestore(
      stubClient({
        agents: [
          { agentId: "a1", cwd: "/work", lastActivity: 2, title: "Newest" },
          { agentId: "a2", cwd: "/work", lastActivity: 1, title: "Claimed" },
        ],
      }),
    );

    expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual(["chat-s-a2"]);
  });
});
