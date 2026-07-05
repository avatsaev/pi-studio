// Workspace pane/split tree and tab operations.
// clean-room-scope/features/workspace-ui.md § Pane / split model, § Tab operations

import { createWorkspaceTab, tabIdForTarget, type WorkspaceTab, type WorkspaceTabTarget } from "./tabs.js";

export const MAX_SPLIT_DEPTH = 4;
export const MIN_SPLIT_SIZE = 0.15;

export type SplitDirection = "row" | "column";
export type SplitSide = "left" | "right" | "top" | "bottom";

export type SplitPane = { kind: "pane"; id: string; tabIds: string[]; focusedTabId?: string };
export type SplitGroup = { kind: "group"; id: string; direction: SplitDirection; children: SplitNode[]; sizes: number[] };
export type SplitNode = SplitPane | SplitGroup;

export type WorkspaceLayout = {
  root: SplitNode;
  focusedPaneId: string;
  parentTabId: Record<string, string | undefined>;
  focusRestoreToken?: string;
};

export function defaultWorkspaceLayout(tabIds: readonly string[] = []): WorkspaceLayout {
  return { root: { kind: "pane", id: "main", tabIds: [...tabIds], focusedTabId: tabIds[0] }, focusedPaneId: "main", parentTabId: {} };
}

export function findPane(root: SplitNode, paneId: string): SplitPane | null {
  if (root.kind === "pane") return root.id === paneId ? root : null;
  for (const child of root.children) {
    const found = findPane(child, paneId);
    if (found) return found;
  }
  return null;
}

export function listPanes(root: SplitNode): SplitPane[] {
  if (root.kind === "pane") return [root];
  return root.children.flatMap(listPanes);
}

export function splitDepth(root: SplitNode): number {
  if (root.kind === "pane") return 1;
  return 1 + Math.max(...root.children.map(splitDepth));
}

export function activeTabForPane(pane: SplitPane, input: { preferredTabId?: string; focusedTabId?: string } = {}): string | undefined {
  const ids = dedupe(pane.tabIds);
  if (input.preferredTabId && ids.includes(input.preferredTabId)) return input.preferredTabId;
  if (pane.focusedTabId && ids.includes(pane.focusedTabId)) return pane.focusedTabId;
  if (input.focusedTabId && ids.includes(input.focusedTabId)) return input.focusedTabId;
  return ids[0];
}

export function openTabInFocusedPane(
  layout: WorkspaceLayout,
  tab: WorkspaceTab,
  mode: "focused" | "background" = "focused",
): WorkspaceLayout {
  const pane = findPane(layout.root, layout.focusedPaneId) ?? listPanes(layout.root)[0];
  if (!pane) return defaultWorkspaceLayout([tab.tabId]);
  const root = updatePane(layout.root, pane.id, (p) => {
    const tabIds = p.tabIds.includes(tab.tabId) ? p.tabIds : [...p.tabIds, tab.tabId];
    return { ...p, tabIds, focusedTabId: mode === "focused" ? tab.tabId : p.focusedTabId };
  });
  return { ...layout, root };
}

export function openChildTab(layout: WorkspaceLayout, parentTabId: string, child: WorkspaceTab): WorkspaceLayout {
  return { ...openTabInFocusedPane(layout, child, "focused"), parentTabId: { ...layout.parentTabId, [child.tabId]: parentTabId } };
}

export function closeTabInLayout(layout: WorkspaceLayout, tabId: string): WorkspaceLayout {
  let root = mapPanes(layout.root, (pane) => {
    if (!pane.tabIds.includes(tabId)) return pane;
    const tabIds = pane.tabIds.filter((id) => id !== tabId);
    const focusedTabId = pane.focusedTabId === tabId ? tabIds.at(-1) : pane.focusedTabId;
    return { ...pane, tabIds, focusedTabId };
  });
  root = collapseEmpty(root, layout.focusedPaneId, false);
  const parentTabId = { ...layout.parentTabId };
  delete parentTabId[tabId];
  const panes = listPanes(root);
  const focusedPaneId = panes.some((p) => p.id === layout.focusedPaneId) ? layout.focusedPaneId : (panes[0]?.id ?? "main");
  return { ...layout, root, focusedPaneId, parentTabId };
}

export function focusPane(layout: WorkspaceLayout, paneId: string): WorkspaceLayout {
  return findPane(layout.root, paneId) ? { ...layout, focusedPaneId: paneId, focusRestoreToken: undefined } : layout;
}

export function unfocusWithToken(layout: WorkspaceLayout, token: string): WorkspaceLayout {
  return { ...layout, focusRestoreToken: token };
}

export function restoreFocus(layout: WorkspaceLayout, token: string): WorkspaceLayout {
  return layout.focusRestoreToken === token ? { ...layout, focusRestoreToken: undefined } : layout;
}

export function retargetTabInLayout(layout: WorkspaceLayout, oldTabId: string, newTarget: WorkspaceTabTarget): WorkspaceLayout {
  const newTabId = tabIdForTarget(newTarget);
  const root = mapPanes(layout.root, (pane) => ({
    ...pane,
    tabIds: pane.tabIds.map((id) => id === oldTabId ? newTabId : id),
    focusedTabId: pane.focusedTabId === oldTabId ? newTabId : pane.focusedTabId,
  }));
  const parentTabId = { ...layout.parentTabId };
  if (oldTabId in parentTabId) {
    parentTabId[newTabId] = parentTabId[oldTabId];
    delete parentTabId[oldTabId];
  }
  return { ...layout, root, parentTabId };
}

export function reorderTabInPane(layout: WorkspaceLayout, paneId: string, fromIndex: number, toIndex: number): WorkspaceLayout {
  return { ...layout, root: updatePane(layout.root, paneId, (pane) => ({ ...pane, tabIds: moveIndex(pane.tabIds, fromIndex, toIndex) })) };
}

export function splitTabToSide(layout: WorkspaceLayout, paneId: string, tabId: string, side: SplitSide, newPaneId: string): { layout: WorkspaceLayout; split: boolean } {
  if (splitDepth(layout.root) >= MAX_SPLIT_DEPTH) return { layout, split: false };
  const source = findPane(layout.root, paneId);
  if (!source || !source.tabIds.includes(tabId)) return { layout, split: false };
  const direction: SplitDirection = side === "left" || side === "right" ? "row" : "column";
  const newPane: SplitPane = { kind: "pane", id: newPaneId, tabIds: [tabId], focusedTabId: tabId };
  const keepSourceTabs = source.tabIds.length > 1 ? source.tabIds.filter((id) => id !== tabId) : source.tabIds;
  const sourcePane: SplitPane = { ...source, tabIds: keepSourceTabs, focusedTabId: keepSourceTabs.includes(source.focusedTabId ?? "") ? source.focusedTabId : keepSourceTabs[0] };
  const children: SplitNode[] = side === "left" || side === "top" ? [newPane, sourcePane] : [sourcePane, newPane];
  const root = replacePaneWithNode(layout.root, paneId, { kind: "group", id: `group_${paneId}_${newPaneId}`, direction, children, sizes: [0.5, 0.5] });
  return { layout: { ...layout, root, focusedPaneId: newPaneId }, split: true };
}

export function splitEmptyToSide(layout: WorkspaceLayout, paneId: string, side: SplitSide, newPaneId: string, draftId: string, createdAt = Date.now()): { layout: WorkspaceLayout; tab: WorkspaceTab; split: boolean } {
  const tab = createWorkspaceTab({ kind: "draft", draftId }, createdAt);
  const result = splitTabToSide(openTabInFocusedPane(layout, tab, "background"), paneId, tab.tabId, side, newPaneId);
  return { ...result, tab };
}

export function moveTabBetweenPanes(layout: WorkspaceLayout, fromPaneId: string, toPaneId: string, tabId: string, index?: number): WorkspaceLayout {
  const from = findPane(layout.root, fromPaneId);
  const to = findPane(layout.root, toPaneId);
  if (!from || !to || !from.tabIds.includes(tabId)) return layout;
  let root = updatePane(layout.root, fromPaneId, (pane) => {
    const tabIds = pane.tabIds.filter((id) => id !== tabId);
    return { ...pane, tabIds, focusedTabId: pane.focusedTabId === tabId ? tabIds.at(-1) : pane.focusedTabId };
  });
  root = updatePane(root, toPaneId, (pane) => {
    const tabIds = [...pane.tabIds];
    const insertAt = Math.max(0, Math.min(index ?? tabIds.length, tabIds.length));
    tabIds.splice(insertAt, 0, tabId);
    return { ...pane, tabIds: dedupe(tabIds), focusedTabId: tabId };
  });
  root = collapseEmpty(root, toPaneId, false);
  return { ...layout, root, focusedPaneId: toPaneId };
}

export function resizeGroup(layout: WorkspaceLayout, groupId: string, sizes: readonly number[]): WorkspaceLayout {
  return { ...layout, root: resizeGroupNode(layout.root, groupId, sizes) };
}

function resizeGroupNode(node: SplitNode, groupId: string, sizes: readonly number[]): SplitNode {
  if (node.kind === "pane") return node;
  if (node.id === groupId) return { ...node, sizes: normalizeSizes(sizes, node.children.length) };
  return { ...node, children: node.children.map((child) => resizeGroupNode(child, groupId, sizes)) };
}

export function normalizeSizes(sizes: readonly number[], count: number): number[] {
  const raw = Array.from({ length: count }, (_, i) => Math.max(MIN_SPLIT_SIZE, sizes[i] ?? 1 / count));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((size) => size / sum);
}

function updatePane(root: SplitNode, paneId: string, update: (pane: SplitPane) => SplitPane): SplitNode {
  if (root.kind === "pane") return root.id === paneId ? update(root) : root;
  return { ...root, children: root.children.map((child) => updatePane(child, paneId, update)) };
}

function mapPanes(root: SplitNode, update: (pane: SplitPane) => SplitPane): SplitNode {
  if (root.kind === "pane") return update(root);
  return { ...root, children: root.children.map((child) => mapPanes(child, update)) };
}

function replacePaneWithNode(root: SplitNode, paneId: string, replacement: SplitNode): SplitNode {
  if (root.kind === "pane") return root.id === paneId ? replacement : root;
  return { ...root, children: root.children.map((child) => replacePaneWithNode(child, paneId, replacement)) };
}

function collapseEmpty(root: SplitNode, preferredPaneId: string, preservePreferredEmpty = true): SplitNode {
  if (root.kind === "pane") return root;
  const children = root.children
    .map((child) => collapseEmpty(child, preferredPaneId, preservePreferredEmpty))
    .filter((child) => child.kind !== "pane" || child.tabIds.length > 0 || (preservePreferredEmpty && child.id === preferredPaneId));
  if (children.length === 0) return { kind: "pane", id: preferredPaneId || "main", tabIds: [], focusedTabId: undefined };
  if (children.length === 1) return children[0]!;
  return { ...root, children, sizes: normalizeSizes(root.sizes.slice(0, children.length), children.length) };
}

function moveIndex<T>(items: readonly T[], from: number, to: number): T[] {
  const copy = [...items];
  if (from < 0 || from >= copy.length) return copy;
  const [item] = copy.splice(from, 1);
  copy.splice(Math.max(0, Math.min(to, copy.length)), 0, item!);
  return copy;
}

function dedupe(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}
