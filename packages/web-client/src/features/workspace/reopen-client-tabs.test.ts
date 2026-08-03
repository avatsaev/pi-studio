/**
 * The client-side half of layout restore: identities that only this client can rebuild. The mapping
 * must be the exact inverse of `tabIdentity`, or a replayed tab's claim goes unconsumed and its pane
 * is pruned at the settle point — the failure this module exists to fix.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { reopenClientTabs, tabFromIdentity } from "./reopen-client-tabs.js";
import { tabIdentity, useTabStore } from "@pi-studio-ui/stores/tab-store.js";
import { useLayoutStore } from "@pi-studio-ui/stores/layout-store.js";
import type { ValidatedWorkspaceLayout } from "@pi-studio-ui/lib/pane-layout-persistence.js";

const CWD = "/work";

beforeEach(() => {
  useTabStore.setState({ tabs: [], activeTabId: null, activeWorkspaceCwd: null });
  useLayoutStore.setState({ layouts: {} });
});

function twoPaneRecord(placement: Record<string, string>): Map<string, ValidatedWorkspaceLayout> {
  return new Map([
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
        placement,
        activeByPane: {},
        activePaneId: "P0",
      },
    ],
  ]);
}

describe("tabFromIdentity", () => {
  it("round-trips every client-side kind through tabIdentity", () => {
    for (const identity of [
      "file:/a/b.ts",
      "molecule:/a/x.cif",
      "diff:staged:/a/b.ts",
      "diff:worktree:/a/b.ts",
    ]) {
      const tab = tabFromIdentity(identity, CWD);
      expect(tab, identity).not.toBeNull();
      expect(tabIdentity(tab!)).toBe(identity);
    }
  });

  it("keeps a file and a molecule tab on the same path distinct", () => {
    const path = "/a/structure.cif";
    // The dispatching `openFileTab` would turn this into a molecule tab and orphan the claim.
    expect(tabFromIdentity(`file:${path}`, CWD)!.kind).toBe("file");
    expect(tabFromIdentity(`molecule:${path}`, CWD)!.kind).toBe("molecule");
  });

  it("carries the path, the staged flag, and a basename label", () => {
    expect(tabFromIdentity("diff:staged:/a/deep/b.ts", CWD)).toEqual({
      id: "diff-/a/deep/b.ts-staged",
      kind: "diff",
      label: "b.ts",
      closable: true,
      data: { path: "/a/deep/b.ts", staged: true },
      workspaceCwd: CWD,
    });
    expect(tabFromIdentity("diff:worktree:/a/b.ts", CWD)!.data).toEqual({
      path: "/a/b.ts",
      staged: false,
    });
  });

  it("ignores daemon-owned kinds — those are the restore hooks' job", () => {
    expect(tabFromIdentity("agent:a1", CWD)).toBeNull();
    expect(tabFromIdentity("terminal:4", CWD)).toBeNull();
  });

  it("ignores an unrecognised or path-less identity instead of guessing", () => {
    // A record written by a newer client may name kinds this one has never heard of.
    expect(tabFromIdentity("whiteboard:/a/b", CWD)).toBeNull();
    expect(tabFromIdentity("file:", CWD)).toBeNull();
    expect(tabFromIdentity("molecule:", CWD)).toBeNull();
    expect(tabFromIdentity("diff:staged:", CWD)).toBeNull();
    expect(tabFromIdentity("diff:sometime:/a/b.ts", CWD)).toBeNull();
  });
});

describe("reopenClientTabs", () => {
  it("puts each reopened tab in the pane that claimed it, consuming the claim", () => {
    const loaded = twoPaneRecord({ "file:/work/a.ts": "P0", "file:/work/b.ts": "P1" });
    useLayoutStore.getState().installPersistedLayouts(loaded);

    reopenClientTabs(loaded);

    const layout = useLayoutStore.getState().layouts[CWD]!;
    expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual([
      "file-/work/a.ts",
      "file-/work/b.ts",
    ]);
    expect(layout.placement).toEqual({ "file-/work/a.ts": "P0", "file-/work/b.ts": "P1" });
    expect(layout.pendingPlacement).toEqual({});
  });

  it("leaves daemon-owned claims pending for the restore hooks", () => {
    const loaded = twoPaneRecord({ "file:/work/a.ts": "P0", "agent:a1": "P1" });
    useLayoutStore.getState().installPersistedLayouts(loaded);

    reopenClientTabs(loaded);

    expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual(["file-/work/a.ts"]);
    // Untouched — pruning it here would destroy the pane a restored chat is still on its way to.
    expect(useLayoutStore.getState().layouts[CWD]!.pendingPlacement).toEqual({ "agent:a1": "P1" });
  });

  it("replays every workspace in the record, not just one", () => {
    const loaded = twoPaneRecord({ "file:/work/a.ts": "P0" });
    loaded.set("/other", {
      tree: { kind: "leaf", id: "Q0" },
      placement: { "molecule:/other/x.cif": "Q0" },
      activeByPane: {},
      activePaneId: "Q0",
    });
    useLayoutStore.getState().installPersistedLayouts(loaded);

    reopenClientTabs(loaded);

    expect(useLayoutStore.getState().layouts["/other"]!.placement).toEqual({
      "mol-/other/x.cif": "Q0",
    });
  });

  it("is idempotent — a second replay activates rather than duplicating", () => {
    const loaded = twoPaneRecord({ "file:/work/a.ts": "P0" });
    useLayoutStore.getState().installPersistedLayouts(loaded);

    reopenClientTabs(loaded);
    reopenClientTabs(loaded);

    expect(useTabStore.getState().tabs).toHaveLength(1);
  });

  it("does nothing with no record", () => {
    reopenClientTabs(new Map());
    expect(useTabStore.getState().tabs).toEqual([]);
  });
});
