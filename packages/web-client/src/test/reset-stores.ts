/**
 * Store resets for tests.
 *
 * Zustand's `setState` **merges**, so a `beforeEach` that spells out only some fields silently leaks
 * the rest across tests. That is how a suite acquires order-dependent flakiness months later: a field
 * added to a store (`restoring`, `pendingActiveWorkspace`) is picked up by whichever `beforeEach`
 * happened to be updated, and quietly retains the previous test's value everywhere else. These helpers
 * exist so a new store field is added in exactly one place.
 *
 * Not a vitest `setup` file on purpose: most suites touch one store, and an implicit global reset would
 * hide which state a test actually depends on.
 */

import { useLayoutStore } from "@pi-studio-ui/stores/layout-store.js";
import { useSessionStore } from "@pi-studio-ui/stores/session-store.js";
import { useTabStore } from "@pi-studio-ui/stores/tab-store.js";
import { useUiStore } from "@pi-studio-ui/stores/ui-store.js";

/** Every non-action field of the layout store, at its initial value. */
export function resetLayoutStore(): void {
  useLayoutStore.setState({
    layouts: {},
    hydrationSources: { sessions: false, terminals: false },
    restoring: false,
    pendingActiveWorkspace: null,
  });
}

export function resetTabStore(): void {
  useTabStore.setState({ tabs: [], activeTabId: null, activeWorkspaceCwd: null });
}

export function resetSessionStore(): void {
  useSessionStore.setState({ sessions: {}, order: [], activeSessionId: null });
}

/** Only the fields the pane/restore suites read; the rest of the UI store is untouched. */
export function resetWorkspaceUiState(): void {
  useUiStore.setState({ collapsedWorkspaces: new Set(), cwd: "~" });
}
