/**
 * Reopen the **client-side** tabs a persisted layout still claims: `file`, `diff`, and `molecule`.
 *
 * Chats and terminals are rebuilt from the daemon's own inventory (`use-session-restore.ts`,
 * `use-terminal-restore.ts`) — the daemon owns them, and one deleted since the last load must not
 * come back. A file/diff/molecule tab has no daemon-side existence at all; it is a *view of a path*.
 * Nothing would ever reopen it, so its claim expired at the hydration settle point and its pane was
 * pruned: open two files side by side, reload, and the split silently collapsed to one pane.
 *
 * No extra persisted state is needed, because the **identity is already the descriptor**:
 * `file:<path>`, `diff:<staged|worktree>:<path>`, `molecule:<path>` (`tab-store.ts`'s `tabIdentity`).
 * A kind whose identity carries no path — a slot-less terminal, an empty molecule tab — was never
 * persisted in the first place, so there is nothing to miss.
 *
 * `tabFromIdentity` is the exact inverse of `tabIdentity` for these three kinds, and is built here
 * rather than by calling `openFileTab` precisely because that helper *dispatches*: it re-routes a
 * molecule extension to a `molecule` tab, which would turn a persisted `file:/a/x.cif` claim into a
 * `molecule:` tab, leave the claim unconsumed, and prune the pane. Round-tripping identity is the
 * whole job here, so the mapping must be literal.
 *
 * Synchronous and claim-driven, which is what lets it run at boot before a connection exists: each
 * open consumes its own claim (`layout-store.claimPaneFor`), the panels' content queries are gated on
 * the client and fire when it arrives (`use-file-read.ts`'s `enabled`), and the whole replay finishes
 * long before either daemon restore reports in — so ordering against them needs no coordination.
 *
 * swe/features/workspace-split-panes.md § Restoring a persisted layout, § Tab identity
 */

import type { ValidatedWorkspaceLayout } from "@pi-studio-ui/lib/pane-layout-persistence.js";
import { tabIds, useTabStore, type Tab } from "@pi-studio-ui/stores/tab-store.js";

/** `diff:staged:/a/b.ts` / `diff:worktree:/a/b.ts` — the only identity with a middle segment. */
const DIFF_IDENTITY = /^diff:(staged|worktree):(.+)$/;

export function reopenClientTabs(loaded: ReadonlyMap<string, ValidatedWorkspaceLayout>): void {
  for (const [cwd, entry] of loaded) {
    for (const identity of Object.keys(entry.placement)) {
      const tab = tabFromIdentity(identity, cwd);
      if (tab !== null) useTabStore.getState().open(tab);
    }
  }
}

/**
 * The tab a persisted identity describes, or `null` when it names a daemon-owned kind (`agent:`,
 * `terminal:`) or anything unrecognised — a record written by a newer client can carry kinds this one
 * has never heard of, and those must be ignored rather than guessed at.
 */
export function tabFromIdentity(identity: string, workspaceCwd: string): Tab | null {
  const file = suffix(identity, "file:");
  if (file !== null) {
    return {
      id: tabIds.file(file),
      kind: "file",
      ...common(file),
      workspaceCwd,
      data: { path: file },
    };
  }
  const molecule = suffix(identity, "molecule:");
  if (molecule !== null) {
    return {
      id: tabIds.molecule(molecule),
      kind: "molecule",
      ...common(molecule),
      workspaceCwd,
      data: { path: molecule },
    };
  }
  const diff = DIFF_IDENTITY.exec(identity);
  if (diff !== null) {
    const path = diff[2]!;
    const staged = diff[1] === "staged";
    return {
      id: tabIds.diff(path, staged),
      kind: "diff",
      ...common(path),
      workspaceCwd,
      data: { path, staged },
    };
  }
  return null;
}

/** The path after `prefix`, or `null` when the prefix does not match or the path is empty. */
function suffix(identity: string, prefix: string): string | null {
  if (!identity.startsWith(prefix)) return null;
  const path = identity.slice(prefix.length);
  return path === "" ? null : path;
}

/** Same basename label and closability every path-backed tab is opened with elsewhere. */
function common(path: string): Pick<Tab, "label" | "closable"> {
  return { label: path.split("/").pop() || path, closable: true };
}
