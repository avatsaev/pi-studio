/**
 * Restoring *which* workspace is in view. The panes were always restored correctly; landing on the
 * wrong workspace is what made it look otherwise, so these tests pin the switch and both of its
 * refusals.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  installActiveWorkspaceRestore,
  restoreActiveWorkspace,
} from "./restore-active-workspace.js";
import { useLayoutStore } from "@pi-studio-ui/stores/layout-store.js";
import { useTabStore, type Tab } from "@pi-studio-ui/stores/tab-store.js";
import { useSessionStore } from "@pi-studio-ui/stores/session-store.js";

const A = "/work/a";
const B = "/work/b";

beforeEach(() => {
  useTabStore.setState({ tabs: [], activeTabId: null, activeWorkspaceCwd: null });
  useSessionStore.setState({ sessions: {}, order: [], activeSessionId: null });
  useLayoutStore.setState({
    layouts: {},
    hydrationSources: { sessions: false, terminals: false },
    restoring: false,
    pendingActiveWorkspace: null,
  });
});

/** A restored chat tab, opened the way `use-session-restore` opens one. */
function openChat(cwd: string, id: string): Tab {
  const tab: Tab = {
    id,
    kind: "chat",
    label: id,
    closable: true,
    data: { sessionId: id },
    workspaceCwd: cwd,
  };
  useTabStore.getState().open(tab);
  return tab;
}

/** A restored terminal tab — a pane whose active tab carries no conversation. */
function openTerminal(cwd: string, id: string): void {
  useTabStore.getState().open({
    id,
    kind: "terminal",
    label: id,
    closable: true,
    data: { slot: 1, cwd },
    workspaceCwd: cwd,
  });
}

function settle(): void {
  useLayoutStore.getState().markHydrationSource("sessions");
  useLayoutStore.getState().markHydrationSource("terminals");
}

describe("restoreActiveWorkspace", () => {
  it("switches the view to the persisted workspace", () => {
    openChat(A, "chat-a");
    openChat(B, "chat-b"); // the later open left B in view, exactly as restore would
    expect(useTabStore.getState().activeWorkspaceCwd).toBe(B);

    expect(restoreActiveWorkspace(A)).toBe(true);

    expect(useTabStore.getState().activeWorkspaceCwd).toBe(A);
    expect(useTabStore.getState().activeTabId).toBe("chat-a");
  });

  it("refuses when the workspace has no restored tab", () => {
    openChat(B, "chat-b");
    useLayoutStore.getState().ensureWorkspace(A); // geometry exists, every session was deleted

    expect(restoreActiveWorkspace(A)).toBe(false);
    expect(useTabStore.getState().activeWorkspaceCwd).toBe(B);
  });

  it("refuses when the workspace has no layout at all", () => {
    openChat(B, "chat-b");

    expect(restoreActiveWorkspace("/gone")).toBe(false);
    expect(useTabStore.getState().activeWorkspaceCwd).toBe(B);
  });

  it("is a no-op when that workspace is already in view", () => {
    openChat(A, "chat-a");
    expect(restoreActiveWorkspace(A)).toBe(false);
    expect(useTabStore.getState().activeWorkspaceCwd).toBe(A);
  });

  it("moves the active conversation into the restored workspace when its focused tab is not a chat", () => {
    // The status-bar half of the same bug. `A`'s focused pane holds a terminal, so `switchWorkspace`'s
    // chat sync deliberately no-ops — and what restore left active is `B`'s conversation, from a
    // workspace the user is no longer looking at.
    openChat(A, "chat-a");
    openTerminal(A, "term-a");
    openChat(B, "chat-b");
    expect(useSessionStore.getState().activeSessionId).toBe("chat-b");

    expect(restoreActiveWorkspace(A)).toBe(true);

    expect(useTabStore.getState().activeTabId).toBe("term-a");
    expect(useSessionStore.getState().activeSessionId).toBe("chat-a");
  });

  it("corrects a foreign active conversation even when the view is already right", () => {
    // The view being right says nothing about the active conversation: `use-session-restore` seeds it
    // from the globally most recent agent, which is a different question.
    openChat(B, "chat-b");
    openChat(A, "chat-a");
    openTerminal(A, "term-a");
    useSessionStore.getState().activate("chat-b");
    expect(useTabStore.getState().activeWorkspaceCwd).toBe(A);

    expect(restoreActiveWorkspace(A)).toBe(false);

    expect(useSessionStore.getState().activeSessionId).toBe("chat-a");
  });

  it("leaves the active conversation alone when the restored workspace has no chat", () => {
    // Nothing local to offer, and blanking the status bar would be worse than a stale label.
    openTerminal(A, "term-a");
    openChat(B, "chat-b"); // the later open leaves B in view, so restoring A really does switch

    expect(restoreActiveWorkspace(A)).toBe(true);

    expect(useSessionStore.getState().activeSessionId).toBe("chat-b");
  });
});

describe("installActiveWorkspaceRestore", () => {
  it("waits for the settle point, then switches once", () => {
    installActiveWorkspaceRestore(A);
    openChat(A, "chat-a");
    openChat(B, "chat-b");

    // Mid-restore: one source in, nothing switched yet — more tabs may still arrive and move the view.
    useLayoutStore.getState().markHydrationSource("sessions");
    expect(useTabStore.getState().activeWorkspaceCwd).toBe(B);

    useLayoutStore.getState().markHydrationSource("terminals");
    expect(useTabStore.getState().activeWorkspaceCwd).toBe(A);
  });

  it("never fights a later user switch — it is one-shot", () => {
    installActiveWorkspaceRestore(A);
    openChat(A, "chat-a");
    openChat(B, "chat-b");
    settle();
    expect(useTabStore.getState().activeWorkspaceCwd).toBe(A);

    // The user goes to B; nothing pulls them back, even as the layout keeps mutating.
    useTabStore.getState().switchWorkspace(B);
    useLayoutStore.getState().ensureWorkspace("/third");
    expect(useTabStore.getState().activeWorkspaceCwd).toBe(B);
  });

  it("switches immediately when hydration already settled", () => {
    openChat(A, "chat-a");
    openChat(B, "chat-b");
    settle();

    installActiveWorkspaceRestore(A);

    expect(useTabStore.getState().activeWorkspaceCwd).toBe(A);
  });

  it("does nothing without a persisted workspace", () => {
    openChat(B, "chat-b");
    installActiveWorkspaceRestore(null);
    settle();
    expect(useTabStore.getState().activeWorkspaceCwd).toBe(B);
  });
});
