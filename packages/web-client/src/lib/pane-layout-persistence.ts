/**
 * Pane layout persistence — one versioned, client-local record holding every workspace's pane
 * arrangement, keyed against **stable tab identities** rather than tab ids.
 *
 * Why identities: terminal tab ids are not stable across a reconnect (see `tab-store.tabIdentity`,
 * which computes them — it lives there because `tab-store` calls it on every open).
 *
 * Why the write is debounced and *also* triggered by tab-store changes: a divider drag mutates the
 * layout per pointer frame, so writes are trailing-debounced; and acquiring an identity counts as a
 * mutation, because a terminal placed by drag and never touched again would otherwise lose its pane
 * when its daemon slot finally arrives.
 *
 * clean-room-scope/features/workspace-split-panes.md § Persisted layout record, § Tab identity,
 * § Data & Persistence
 */

import { localKvStore } from "@pi-studio-ui/providers/kv-store.js";
import {
  leafIds,
  PANE_LAYOUT_VERSION,
  parsePaneTree,
  type PaneNode,
} from "@pi-studio-ui/features/workspace/pane-tree.js";
import { useLayoutStore } from "@pi-studio-ui/stores/layout-store.js";
import { tabIdentity, useTabStore, type Tab } from "@pi-studio-ui/stores/tab-store.js";
import { useSessionStore } from "@pi-studio-ui/stores/session-store.js";

/** Matches the `pi-studio-appearance` key convention already used by the appearance store. */
const STORAGE_KEY = "pi-studio-pane-layout";

/** Short enough to survive a reload, long enough that a divider drag writes once. */
export const PANE_LAYOUT_WRITE_DEBOUNCE_MS = 250;

// ─── Record shape ──────────────────────────────────────────────────────────────────────────

export interface PersistedWorkspaceLayout {
  /** Untrusted on load — validated by `parsePaneTree`. */
  tree: unknown;
  /** identity → pane id */
  placement: Record<string, string>;
  /** pane id → identity */
  activeByPane: Record<string, string>;
  activePaneId: string;
}

export interface PersistedPaneLayout {
  version: typeof PANE_LAYOUT_VERSION;
  /** Keyed by normalized workspace cwd. */
  workspaces: Record<string, PersistedWorkspaceLayout>;
  /** The workspace that was in view. Optional — records written before this existed simply lack it. */
  activeWorkspaceCwd?: string;
}

/** A validated record: geometry per workspace, plus which one was in view. */
export interface LoadedPaneLayout {
  workspaces: Map<string, ValidatedWorkspaceLayout>;
  /** `null` when absent, or naming a workspace whose entry did not survive validation. */
  activeWorkspaceCwd: string | null;
}

/** A loaded workspace entry whose tree parsed and whose pane references are known to exist. */
export interface ValidatedWorkspaceLayout {
  tree: PaneNode;
  /** identity → pane id; every pane id is a leaf of `tree`. */
  placement: Record<string, string>;
  /** pane id → identity; every pane id is a leaf of `tree`. */
  activeByPane: Record<string, string>;
  /** `null` when absent or naming a pane that is not in `tree` — the caller picks a fallback. */
  activePaneId: string | null;
}

// ─── Load ──────────────────────────────────────────────────────────────────────────────────

/**
 * Read the record, discarding what cannot be trusted: a `version` mismatch drops the **whole**
 * record, a structurally damaged tree drops only **that workspace's** entry, and pane references
 * that do not exist in the parsed tree are dropped individually. Never throws.
 */
export function loadPaneLayout(): LoadedPaneLayout {
  const workspaces = new Map<string, ValidatedWorkspaceLayout>();
  const empty: LoadedPaneLayout = { workspaces, activeWorkspaceCwd: null };
  const raw = localKvStore.get(STORAGE_KEY);
  if (!raw) return empty;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty; // hand-edited or truncated storage: start from a single pane
  }
  if (typeof parsed !== "object" || parsed === null) return empty;

  const record = parsed as Partial<PersistedPaneLayout>;
  if (record.version !== PANE_LAYOUT_VERSION) return empty;
  if (typeof record.workspaces !== "object" || record.workspaces === null) return empty;

  for (const [cwd, entry] of Object.entries(record.workspaces)) {
    const workspace = validateWorkspace(entry);
    if (workspace) workspaces.set(cwd, workspace);
  }
  // A workspace whose entry was dropped as damaged must not be restored as the view, or the user
  // would land on a workspace with no geometry at all.
  const active = record.activeWorkspaceCwd;
  return {
    workspaces,
    activeWorkspaceCwd: typeof active === "string" && workspaces.has(active) ? active : null,
  };
}

function validateWorkspace(entry: unknown): ValidatedWorkspaceLayout | null {
  if (typeof entry !== "object" || entry === null) return null;
  const candidate = entry as Partial<PersistedWorkspaceLayout>;
  const tree = parsePaneTree(candidate.tree);
  if (!tree) return null;

  const panes = new Set(leafIds(tree));
  const placement: Record<string, string> = {};
  for (const [identity, paneId] of stringEntries(candidate.placement)) {
    if (panes.has(paneId)) placement[identity] = paneId; // else: pane is gone, claim is worthless
  }
  const activeByPane: Record<string, string> = {};
  for (const [paneId, identity] of stringEntries(candidate.activeByPane)) {
    if (panes.has(paneId)) activeByPane[paneId] = identity;
  }
  const activePaneId = candidate.activePaneId;
  return {
    tree,
    placement,
    activeByPane,
    activePaneId: typeof activePaneId === "string" && panes.has(activePaneId) ? activePaneId : null,
  };
}

function stringEntries(value: unknown): [string, string][] {
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).filter(
    (pair): pair is [string, string] => typeof pair[1] === "string",
  );
}

// ─── Save ──────────────────────────────────────────────────────────────────────────────────

/**
 * Cancels the pending debounce, or `null` when none is in flight. Holding a closure rather than the
 * raw handle keeps the timer id's type inferred — it is a `number` in the browser and a `Timeout`
 * under Node, and this module is compiled for both.
 */
let cancelPendingWrite: (() => void) | null = null;

/** Queue a write on a trailing debounce, so a pointer-frame burst collapses into one. */
export function schedulePaneLayoutWrite(): void {
  cancelPendingWrite?.();
  const handle = setTimeout(() => {
    cancelPendingWrite = null;
    writePaneLayout();
  }, PANE_LAYOUT_WRITE_DEBOUNCE_MS);
  cancelPendingWrite = () => clearTimeout(handle);
}

/** Write immediately, cancelling any pending debounce (tests, `pagehide`). */
export function flushPaneLayoutWrite(): void {
  cancelPendingWrite?.();
  cancelPendingWrite = null;
  writePaneLayout();
}

function writePaneLayout(): void {
  const identities = new Map<string, string>();
  for (const tab of useTabStore.getState().tabs) {
    const identity = tabIdentity(tab);
    if (identity !== null) identities.set(tab.id, identity);
  }

  const workspaces: Record<string, PersistedWorkspaceLayout> = {};
  for (const [cwd, layout] of Object.entries(useLayoutStore.getState().layouts)) {
    // Unconsumed claims are the starting point, NOT an empty object: a write that lands while restore
    // is still in flight — and the client-side tab replay triggers one immediately — would otherwise
    // persist a record describing only the tabs that happen to be open already, silently dropping
    // every pane whose chat or terminal is still on its way from the daemon. Next reload, those panes
    // have no claim and get pruned at the settle point: the split quietly collapses. Live tabs are
    // layered on top, so a tab that HAS arrived wins over the claim it consumed, and once hydration
    // settles (`pendingPlacement` emptied) this reduces to exactly the live-tab projection.
    const placement: Record<string, string> = { ...layout.pendingPlacement };
    for (const [tabId, paneId] of Object.entries(layout.placement)) {
      const identity = identities.get(tabId);
      // An identity-less tab is skipped; its pane still exists in the tree.
      if (identity !== undefined) placement[identity] = paneId;
    }
    const activeByPane: Record<string, string> = { ...layout.pendingActive };
    for (const [paneId, tabId] of Object.entries(layout.activeByPane)) {
      const identity = identities.get(tabId);
      if (identity !== undefined) activeByPane[paneId] = identity;
    }
    workspaces[cwd] = {
      tree: layout.tree,
      placement,
      activeByPane,
      activePaneId: layout.focusedPaneId,
    };
  }

  // Which workspace was in view is part of the layout: without it, restore lands wherever the most
  // recently active agent happens to live (`use-session-restore`'s `order[0]`), so a user with two
  // workspaces came back to the wrong one — panes correctly restored, just not the ones on screen.
  const record: PersistedPaneLayout = {
    version: PANE_LAYOUT_VERSION,
    workspaces,
    activeWorkspaceCwd: useTabStore.getState().activeWorkspaceCwd ?? undefined,
  };
  localKvStore.set(STORAGE_KEY, JSON.stringify(record));
}

// ─── Triggers ──────────────────────────────────────────────────────────────────────────────

/**
 * Wire the write triggers; returns the teardown. Called once at app bootstrap.
 *
 * Layout mutations are the obvious trigger. The other two exist purely for **identity acquisition**,
 * where a tab becomes restorable without any layout state changing:
 * - `tab-store` — a terminal's daemon slot arrives via `updateData`.
 * - `session-store` — a draft chat's `createAgent` returns and `bindAgent` supplies the agent id the
 *   chat's identity is keyed on (`materialize.ts`). Nothing in `tab-store` changes, so without this
 *   the pane holding a brand-new conversation would stay unclaimed until some later layout mutation
 *   happened to flush it. The subscription fires on every stream event too; re-deriving the
 *   signature is a short string join over the open tabs, and a no-change result schedules nothing.
 */
export function installPaneLayoutPersistence(): () => void {
  let lastSignature = identitySignature(useTabStore.getState().tabs);
  const onIdentityMaybeChanged = (): void => {
    const signature = identitySignature(useTabStore.getState().tabs);
    if (signature === lastSignature) return;
    lastSignature = signature;
    schedulePaneLayoutWrite();
  };
  const unsubscribeLayout = useLayoutStore.subscribe(schedulePaneLayoutWrite);
  const unsubscribeTabs = useTabStore.subscribe(onIdentityMaybeChanged);
  const unsubscribeSessions = useSessionStore.subscribe(onIdentityMaybeChanged);
  return () => {
    unsubscribeLayout();
    unsubscribeTabs();
    unsubscribeSessions();
  };
}

/** Changes only when some tab gains, loses, or changes its identity. */
function identitySignature(tabs: Tab[]): string {
  return tabs.map((tab) => `${tab.id}\u0000${tabIdentity(tab) ?? ""}`).join("\u0001");
}
