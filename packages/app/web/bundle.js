// src/workspace/tabs.ts
function tabIdForTarget(target) {
  switch (target.kind) {
    case "draft":
      return target.draftId;
    case "agent":
      return `agent_${target.agentId}`;
    case "terminal":
      return `terminal_${target.terminalId}`;
    case "browser":
      return `browser_${target.browserId}`;
    case "file":
      return `file_${target.path}`;
    case "setup":
      return `setup_${target.workspaceId}`;
  }
}
function createWorkspaceTab(target, createdAt = Date.now(), parentTabId) {
  return { tabId: tabIdForTarget(target), target, createdAt, parentTabId };
}
function defaultTabLabel(target) {
  switch (target.kind) {
    case "draft":
      return "New Agent";
    case "agent":
      return "Agent";
    case "terminal":
      return "Terminal";
    case "browser":
      return "Browser";
    case "file":
      return filename(target.path);
    case "setup":
      return "Setup";
  }
}
function filename(path) {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.at(-1) ?? path;
}

// src/workspace/panel-registry.ts
var WORKSPACE_PANEL_REGISTRY = {
  draft: entry("draft", "AgentConversationPanel", "sparkles"),
  agent: entry("agent", "AgentConversationPanel", "bot", (tab) => `Close ${defaultTabLabel(tab.target)}?`),
  terminal: entry("terminal", "TerminalPanel", "terminal", () => "Close terminal? Running processes may stop."),
  browser: entry("browser", "BrowserPanel", "globe"),
  file: entry("file", "FilePreviewPanel", "file"),
  setup: entry("setup", "SetupPanel", "wrench")
};
function descriptorForTab(tab, hints = {}) {
  return WORKSPACE_PANEL_REGISTRY[tab.target.kind].useDescriptor(tab, hints);
}
function entry(kind, component, icon, confirmClose) {
  return {
    kind,
    component,
    confirmClose,
    useDescriptor: (tab, hints = {}) => ({
      label: hints.loading ? "" : hints.title ?? defaultTabLabel(tab.target),
      subtitle: hints.subtitle,
      titleState: hints.loading ? "skeleton" : "ready",
      icon: hints.favicon ?? icon,
      statusBucket: hints.statusBucket
    })
  };
}

// src/workspace/subagents.ts
function closeAgentTabDecision(agent) {
  if (agent.parentAgentId) return { action: "layout-close", archive: false, reason: "subagent" };
  return { action: "archive-agent", archive: true, reason: "root-agent" };
}

// src/workspace/layout.ts
var MAX_SPLIT_DEPTH = 4;
var MIN_SPLIT_SIZE = 0.15;
function defaultWorkspaceLayout(tabIds = []) {
  return { root: { kind: "pane", id: "main", tabIds: [...tabIds], focusedTabId: tabIds[0] }, focusedPaneId: "main", parentTabId: {} };
}
function findPane(root2, paneId) {
  if (root2.kind === "pane") return root2.id === paneId ? root2 : null;
  for (const child of root2.children) {
    const found = findPane(child, paneId);
    if (found) return found;
  }
  return null;
}
function listPanes(root2) {
  if (root2.kind === "pane") return [root2];
  return root2.children.flatMap(listPanes);
}
function splitDepth(root2) {
  if (root2.kind === "pane") return 1;
  return 1 + Math.max(...root2.children.map(splitDepth));
}
function activeTabForPane(pane, input = {}) {
  const ids = dedupe(pane.tabIds);
  if (input.preferredTabId && ids.includes(input.preferredTabId)) return input.preferredTabId;
  if (pane.focusedTabId && ids.includes(pane.focusedTabId)) return pane.focusedTabId;
  if (input.focusedTabId && ids.includes(input.focusedTabId)) return input.focusedTabId;
  return ids[0];
}
function openTabInFocusedPane(layout, tab, mode = "focused") {
  const pane = findPane(layout.root, layout.focusedPaneId) ?? listPanes(layout.root)[0];
  if (!pane) return defaultWorkspaceLayout([tab.tabId]);
  const root2 = updatePane(layout.root, pane.id, (p) => {
    const tabIds = p.tabIds.includes(tab.tabId) ? p.tabIds : [...p.tabIds, tab.tabId];
    return { ...p, tabIds, focusedTabId: mode === "focused" ? tab.tabId : p.focusedTabId };
  });
  return { ...layout, root: root2 };
}
function closeTabInLayout(layout, tabId) {
  let root2 = mapPanes(layout.root, (pane) => {
    if (!pane.tabIds.includes(tabId)) return pane;
    const tabIds = pane.tabIds.filter((id) => id !== tabId);
    const focusedTabId = pane.focusedTabId === tabId ? tabIds.at(-1) : pane.focusedTabId;
    return { ...pane, tabIds, focusedTabId };
  });
  root2 = collapseEmpty(root2, layout.focusedPaneId, false);
  const parentTabId = { ...layout.parentTabId };
  delete parentTabId[tabId];
  const panes = listPanes(root2);
  const focusedPaneId = panes.some((p) => p.id === layout.focusedPaneId) ? layout.focusedPaneId : panes[0]?.id ?? "main";
  return { ...layout, root: root2, focusedPaneId, parentTabId };
}
function splitTabToSide(layout, paneId, tabId, side, newPaneId) {
  if (splitDepth(layout.root) >= MAX_SPLIT_DEPTH) return { layout, split: false };
  const source = findPane(layout.root, paneId);
  if (!source || !source.tabIds.includes(tabId)) return { layout, split: false };
  const direction = side === "left" || side === "right" ? "row" : "column";
  const newPane = { kind: "pane", id: newPaneId, tabIds: [tabId], focusedTabId: tabId };
  const keepSourceTabs = source.tabIds.length > 1 ? source.tabIds.filter((id) => id !== tabId) : source.tabIds;
  const sourcePane = { ...source, tabIds: keepSourceTabs, focusedTabId: keepSourceTabs.includes(source.focusedTabId ?? "") ? source.focusedTabId : keepSourceTabs[0] };
  const children = side === "left" || side === "top" ? [newPane, sourcePane] : [sourcePane, newPane];
  const root2 = replacePaneWithNode(layout.root, paneId, { kind: "group", id: `group_${paneId}_${newPaneId}`, direction, children, sizes: [0.5, 0.5] });
  return { layout: { ...layout, root: root2, focusedPaneId: newPaneId }, split: true };
}
function splitEmptyToSide(layout, paneId, side, newPaneId, draftId, createdAt = Date.now()) {
  const tab = createWorkspaceTab({ kind: "draft", draftId }, createdAt);
  const result = splitTabToSide(openTabInFocusedPane(layout, tab, "background"), paneId, tab.tabId, side, newPaneId);
  return { ...result, tab };
}
function normalizeSizes(sizes, count) {
  const raw = Array.from({ length: count }, (_, i) => Math.max(MIN_SPLIT_SIZE, sizes[i] ?? 1 / count));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((size) => size / sum);
}
function updatePane(root2, paneId, update) {
  if (root2.kind === "pane") return root2.id === paneId ? update(root2) : root2;
  return { ...root2, children: root2.children.map((child) => updatePane(child, paneId, update)) };
}
function mapPanes(root2, update) {
  if (root2.kind === "pane") return update(root2);
  return { ...root2, children: root2.children.map((child) => mapPanes(child, update)) };
}
function replacePaneWithNode(root2, paneId, replacement) {
  if (root2.kind === "pane") return root2.id === paneId ? replacement : root2;
  return { ...root2, children: root2.children.map((child) => replacePaneWithNode(child, paneId, replacement)) };
}
function collapseEmpty(root2, preferredPaneId, preservePreferredEmpty = true) {
  if (root2.kind === "pane") return root2;
  const children = root2.children.map((child) => collapseEmpty(child, preferredPaneId, preservePreferredEmpty)).filter((child) => child.kind !== "pane" || child.tabIds.length > 0 || preservePreferredEmpty && child.id === preferredPaneId);
  if (children.length === 0) return { kind: "pane", id: preferredPaneId || "main", tabIds: [], focusedTabId: void 0 };
  if (children.length === 1) return children[0];
  return { ...root2, children, sizes: normalizeSizes(root2.sizes.slice(0, children.length), children.length) };
}
function dedupe(ids) {
  return [...new Set(ids)];
}

// src/workspace/layout-store.ts
function workspacePersistenceKey(serverId, workspaceId) {
  return `${serverId}:${workspaceId}`;
}
function serializeLayout(layout) {
  const persisted = { version: 1, root: layout.root, focusedPaneId: layout.focusedPaneId };
  return JSON.stringify(persisted);
}
function deserializeLayout(value) {
  if (!value) return defaultWorkspaceLayout();
  try {
    const parsed = JSON.parse(value);
    if (parsed.version !== 1 || !parsed.root || !parsed.focusedPaneId) return defaultWorkspaceLayout();
    return { root: parsed.root, focusedPaneId: parsed.focusedPaneId, parentTabId: {} };
  } catch {
    return defaultWorkspaceLayout();
  }
}
var WorkspaceLayoutStore = class {
  constructor(storage) {
    this.storage = storage;
  }
  load(serverId, workspaceId) {
    return deserializeLayout(this.storage.getItem(workspacePersistenceKey(serverId, workspaceId)));
  }
  save(serverId, workspaceId, layout) {
    this.storage.setItem(workspacePersistenceKey(serverId, workspaceId), serializeLayout(layout));
  }
};

// src/workspace/keepalive.ts
var DEFAULT_MOUNTED_TAB_CAP = 3;
function nextMountedTabLru(previous, activeTabId2, cap = DEFAULT_MOUNTED_TAB_CAP) {
  if (!activeTabId2) return previous.slice(0, cap);
  return [activeTabId2, ...previous.filter((id) => id !== activeTabId2)].slice(0, cap);
}
function mountedTabState(tabId, activeTabId2, lru) {
  if (tabId === activeTabId2) return "active";
  return lru.includes(tabId) ? "mounted-hidden" : "unmounted";
}

// src/workspace/dnd.ts
function supportsPaneSplits(platform, isCompact) {
  return platform === "web" && !isCompact;
}

// src/workspace/composition.ts
function composeWorkspaceScreen(input) {
  return {
    showPrimaryHeader: !input.focusMode || input.formFactor === "mobile",
    showExplorerSidebar: input.formFactor === "wide" && input.explorerOpen && input.workspaceDirPresent,
    tabStripMode: input.formFactor === "mobile" ? "mobile-switcher" : input.platform === "web" && input.panes.length > 1 ? "per-pane" : "single",
    rootModals: ["import-session", "rename-tab"]
  };
}
function workspaceHeaderModel(input) {
  const mobile = input.formFactor === "mobile";
  const iconOnly = input.formFactor === "narrow";
  const title = input.loading ? "" : input.title ?? "Workspace";
  const subtitle = input.projectSubtitle && input.projectSubtitle.toLowerCase() !== title.toLowerCase() ? input.projectSubtitle : void 0;
  const branch = input.projectKind === "git" && !input.detachedHead ? input.branch : void 0;
  const menuItems = [
    { id: "new-agent", label: "New agent" },
    { id: "new-terminal", label: "New terminal", disabled: !input.terminalReady },
    ...input.isElectron ? [{ id: "new-browser", label: "New browser tab" }] : [],
    { id: "import-session", label: "Import session" },
    ...input.workspaceDir ? [{ id: "copy-path", label: "Copy workspace path" }] : [],
    ...branch ? [{ id: "copy-branch", label: "Copy branch name" }] : [],
    ...input.setupAvailable ? [{ id: "show-setup", label: "Show setup" }] : [],
    ...mobile && input.scriptsCount > 0 ? [{ id: "scripts", label: "Scripts" }] : []
  ];
  const right = mobile ? [{ id: "explorer", label: "Explorer", iconOnly: true, badge: diffBadge(input.diffStat) }] : [
    ...input.scriptsCount > 0 ? [{ id: "scripts", label: "Scripts", iconOnly }] : [],
    ...input.workspaceDir ? [{ id: "open-editor", label: "Open in editor", iconOnly }] : [],
    { id: input.projectKind === "git" ? "git-explorer" : "explorer", label: "Explorer", iconOnly, badge: diffBadge(input.diffStat) }
  ];
  return { left: { sidebarToggle: true, title, loading: input.loading, branch, subtitle }, menuItems, right };
}
function diffBadge(stat) {
  if (!stat) return void 0;
  const total = stat.added + stat.modified + stat.deleted;
  return total > 0 ? String(total) : void 0;
}

// src/workspace/tab-strip.ts
var TAB_ICON_MIN_WIDTH = 44;
var TAB_MAX_WIDTH = 200;
function distributeTabWidths(tabCount, availableWidth) {
  if (tabCount <= 0) return { widths: [], scroll: false };
  const maxNeeded = tabCount * TAB_MAX_WIDTH;
  if (availableWidth >= maxNeeded) return { widths: Array.from({ length: tabCount }, () => TAB_MAX_WIDTH), scroll: false };
  const minNeeded = tabCount * TAB_ICON_MIN_WIDTH;
  if (availableWidth < minNeeded) return { widths: Array.from({ length: tabCount }, () => TAB_ICON_MIN_WIDTH), scroll: true };
  const width = Math.floor(availableWidth / tabCount);
  return { widths: Array.from({ length: tabCount }, () => Math.max(TAB_ICON_MIN_WIDTH, Math.min(TAB_MAX_WIDTH, width))), scroll: false };
}
function tabContextMenu(input) {
  const agent = input.tab.target.kind === "agent";
  const terminal = input.tab.target.kind === "terminal";
  const rename = agent || terminal;
  const orientation = input.formFactor === "mobile" ? ["above", "below"] : ["left", "right"];
  return [
    ...agent ? [
      { id: "copy-resume", label: "Copy resume command" },
      { id: "copy-agent-id", label: "Copy agent id" },
      { id: "reload-agent", label: "Reload agent" }
    ] : [],
    ...rename ? [{ id: "rename", label: "Rename" }] : [],
    { id: `close-${orientation[0]}`, label: `Close to the ${orientation[0]}`, disabled: input.index === 0 },
    { id: `close-${orientation[1]}`, label: `Close to the ${orientation[1]}`, disabled: input.index >= input.tabs.length - 1 },
    { id: "close-others", label: "Close other tabs", disabled: input.tabs.length <= 1 },
    { id: "close", label: "Close" }
  ];
}
function tabTooltip(tab, label) {
  return `${label} \u2022 ${tab.tabId}`;
}

// src/workspace/bulk-close.ts
function classifyBulkClose(tabs, agents) {
  const agentById = new Map(agents.map((agent) => [agent.agentId, agent]));
  const result = { archiveAgentIds: [], layoutOnlyAgentIds: [], closeTerminalIds: [], localOnlyTabIds: [] };
  for (const tab of tabs) {
    if (tab.target.kind === "agent") {
      const agent = agentById.get(tab.target.agentId) ?? { agentId: tab.target.agentId };
      const decision = closeAgentTabDecision(agent);
      if (decision.archive) result.archiveAgentIds.push(tab.target.agentId);
      else result.layoutOnlyAgentIds.push(tab.target.agentId);
    } else if (tab.target.kind === "terminal") {
      result.closeTerminalIds.push(tab.target.terminalId);
    } else {
      result.localOnlyTabIds.push(tab.tabId);
    }
  }
  return result;
}
function bulkCloseConfirmation(classification) {
  const parts = [];
  if (classification.archiveAgentIds.length > 0) parts.push(`archive ${classification.archiveAgentIds.length} agent${plural(classification.archiveAgentIds.length)}`);
  if (classification.closeTerminalIds.length > 0) parts.push(`close ${classification.closeTerminalIds.length} terminal${plural(classification.closeTerminalIds.length)} and stop running processes`);
  if (classification.layoutOnlyAgentIds.length > 0) parts.push(`close ${classification.layoutOnlyAgentIds.length} subagent tab${plural(classification.layoutOnlyAgentIds.length)} locally`);
  if (classification.localOnlyTabIds.length > 0) parts.push(`close ${classification.localOnlyTabIds.length} local tab${plural(classification.localOnlyTabIds.length)}`);
  return parts.length === 0 ? "No tabs to close." : `This will ${joinParts(parts)}.`;
}
function planBulkClose(tabs, agents) {
  const classification = classifyBulkClose(tabs, agents);
  return { ...classification, confirmation: bulkCloseConfirmation(classification), closingTabIds: tabs.map((tab) => tab.tabId) };
}
function plural(count) {
  return count === 1 ? "" : "s";
}
function joinParts(parts) {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

// src/workspace/pinned-targets.ts
var PINNED_TARGETS_KEY = "pinned-tab-targets";
var DEFAULT_PINNED_TARGETS = [{ kind: "terminal" }, { kind: "browser" }];
function pinnedTargetKey(target) {
  return target.kind === "profile" ? `profile:${target.profileId}` : target.kind;
}
function migratePinnedTargets(value) {
  if (isPinnedState(value)) return withDefaults(dedupePinned(value.targets));
  if (Array.isArray(value)) return withDefaults(dedupePinned(value.filter(isPinnedTarget)));
  return { version: 1, targets: [...DEFAULT_PINNED_TARGETS] };
}
function togglePinnedTarget(targets, target) {
  const key = pinnedTargetKey(target);
  return targets.some((item) => pinnedTargetKey(item) === key) ? targets.filter((item) => pinnedTargetKey(item) !== key) : [...targets, target];
}
function quickLaunchButtons(targets, input) {
  return targets.map((target) => ({ key: pinnedTargetKey(target), label: quickLaunchLabel(target), target, tabTarget: tabTargetForPinned(target, input) }));
}
function tabTargetForPinned(target, input) {
  switch (target.kind) {
    case "draft":
      return { kind: "draft", draftId: input.nextDraftId };
    case "terminal":
      return { kind: "terminal", terminalId: input.nextTerminalId };
    case "browser":
      return { kind: "browser", browserId: input.nextBrowserId };
    case "profile":
      return { kind: "draft", draftId: input.nextDraftId, setup: { provider: target.profileId, cwd: input.profileCwd ?? "" } };
  }
}
var PinnedTargetsStore = class {
  constructor(storage) {
    this.storage = storage;
  }
  load() {
    const raw = this.storage.getItem(PINNED_TARGETS_KEY);
    if (!raw) return { version: 1, targets: [...DEFAULT_PINNED_TARGETS] };
    try {
      return migratePinnedTargets(JSON.parse(raw));
    } catch {
      return { version: 1, targets: [...DEFAULT_PINNED_TARGETS] };
    }
  }
  save(state2) {
    this.storage.setItem(PINNED_TARGETS_KEY, JSON.stringify(migratePinnedTargets(state2)));
  }
  toggle(target) {
    const next = { version: 1, targets: togglePinnedTarget(this.load().targets, target) };
    this.save(next);
    return next;
  }
};
function quickLaunchLabel(target) {
  switch (target.kind) {
    case "draft":
      return "New agent";
    case "terminal":
      return "New terminal";
    case "browser":
      return "New browser";
    case "profile":
      return `Profile ${target.profileId}`;
  }
}
function withDefaults(targets) {
  return { version: 1, targets: dedupePinned([...DEFAULT_PINNED_TARGETS, ...targets]) };
}
function dedupePinned(targets) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const target of targets) {
    const key = pinnedTargetKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(target);
  }
  return result;
}
function isPinnedState(value) {
  return typeof value === "object" && value !== null && value.version === 1 && Array.isArray(value.targets);
}
function isPinnedTarget(value) {
  if (typeof value !== "object" || value === null) return false;
  const kind = value.kind;
  return kind === "draft" || kind === "terminal" || kind === "browser" || kind === "profile" && typeof value.profileId === "string";
}

// src/workspace/seeding.ts
function shouldSeedDraft(state2) {
  return Boolean(
    state2.routeFocused && state2.persistenceKey && state2.workspaceDir && state2.layoutHydrated && state2.agentsHydrated && state2.terminalsHydrated && state2.activeAgentCount === 0 && state2.terminalCount === 0 && state2.tabs.length === 0
  );
}
function seedDraftTab(state2, draftId, createdAt = Date.now()) {
  return shouldSeedDraft(state2) ? createWorkspaceTab({ kind: "draft", draftId, setup: { provider: "default", cwd: state2.workspaceDir } }, createdAt) : null;
}
function targetFromOpenIntent(intent) {
  if (!intent) return null;
  switch (intent.kind) {
    case "agent":
      return { kind: "agent", agentId: intent.id };
    case "terminal":
      return { kind: "terminal", terminalId: intent.id };
    case "file":
      return { kind: "file", path: intent.path };
    case "draft":
      return { kind: "draft", draftId: intent.id };
    case "setup":
      return { kind: "setup", workspaceId: intent.workspaceId };
  }
}
function resolveWorkspaceEntry(input) {
  const target = targetFromOpenIntent(input.openIntent);
  if (target) {
    const existing = input.state.tabs.find((tab) => tab.target.kind === target.kind && tab.tabId === createWorkspaceTab(target).tabId);
    return existing ? { action: "focus-existing", tabId: existing.tabId } : { action: "open-target", target };
  }
  const seeded = seedDraftTab(input.state, input.nextDraftId, input.now);
  return seeded ? { action: "seed-draft", tab: seeded } : { action: "none" };
}

// src/workspace/route-gating.ts
function resolveWorkspaceRouteGate(input) {
  if (input.activeServerId && input.activeServerId !== input.routeServerId) return { state: "foreign", redirect: `/h/${encodeURIComponent(input.activeServerId)}` };
  const known = input.knownWorkspaceIds.includes(input.workspaceId);
  if (!input.hostOnline) return known ? { state: "reconnecting", actions: ["retry-host", "manage-host"] } : { state: "unreachable", actions: ["retry-host", "manage-host"] };
  if (!input.workspacesHydrated) return { state: "loading" };
  if (!known) return { state: "missing", actions: ["dismiss-missing-workspace", "manage-host"] };
  if (input.workspaceDirExists === false) return { state: "directory-missing" };
  if (!input.tabsHydrated) return { state: "splash" };
  return { state: "ready" };
}

// src/workspace/mobile-switcher.ts
function buildMobileSwitcher(input) {
  const visibleTabId = input.activeTabId ?? input.tabs[0]?.tabId;
  return {
    visibleTabId,
    entries: input.tabs.map((tab) => {
      const descriptor = descriptorForTab(tab);
      return {
        tabId: tab.tabId,
        label: descriptor.label,
        icon: descriptor.icon,
        statusBucket: descriptor.statusBucket,
        active: tab.tabId === visibleTabId,
        closable: true
      };
    }),
    newTabActions: quickLaunchButtons(input.pinnedTargets, input),
    splitsVisible: false
  };
}
function compactVisibleTabs(tabs, activeTabId2) {
  const active = activeTabId2 ? tabs.find((tab) => tab.tabId === activeTabId2) : void 0;
  const first = active ?? tabs[0];
  return first ? [first] : [];
}

// src/theme/palette.ts
var scale = (s50, s100, s200, s300, s400, s500, s600, s700, s800, s900, s950) => ({
  "50": s50,
  "100": s100,
  "200": s200,
  "300": s300,
  "400": s400,
  "500": s500,
  "600": s600,
  "700": s700,
  "800": s800,
  "900": s900,
  "950": s950
});
var palette = {
  zinc: scale(
    "#fafafa",
    "#f4f4f5",
    "#e4e4e7",
    "#d4d4d8",
    "#a1a1aa",
    "#71717a",
    "#52525b",
    "#3f3f46",
    "#27272a",
    "#18181b",
    "#09090b"
  ),
  gray: scale(
    "#f9fafb",
    "#f3f4f6",
    "#e5e7eb",
    "#d1d5db",
    "#9ca3af",
    "#6b7280",
    "#4b5563",
    "#374151",
    "#1f2937",
    "#111827",
    "#030712"
  ),
  slate: scale(
    "#f8fafc",
    "#f1f5f9",
    "#e2e8f0",
    "#cbd5e1",
    "#94a3b8",
    "#64748b",
    "#475569",
    "#334155",
    "#1e293b",
    "#0f172a",
    "#020617"
  ),
  blue: scale(
    "#eff6ff",
    "#dbeafe",
    "#bfdbfe",
    "#93c5fd",
    "#60a5fa",
    "#3b82f6",
    "#2563eb",
    "#1d4ed8",
    "#1e40af",
    "#1e3a8a",
    "#172554"
  ),
  green: scale(
    "#f0fdf4",
    "#dcfce7",
    "#bbf7d0",
    "#86efac",
    "#4ade80",
    "#22c55e",
    "#16a34a",
    "#15803d",
    "#166534",
    "#14532d",
    "#052e16"
  ),
  red: scale(
    "#fef2f2",
    "#fee2e2",
    "#fecaca",
    "#fca5a5",
    "#f87171",
    "#ef4444",
    "#dc2626",
    "#b91c1c",
    "#991b1b",
    "#7f1d1d",
    "#450a0a"
  ),
  teal: scale(
    "#f0fdfa",
    "#ccfbf1",
    "#99f6e4",
    "#5eead4",
    "#2dd4bf",
    "#14b8a6",
    "#0d9488",
    "#0f766e",
    "#115e59",
    "#134e4a",
    "#042f2e"
  ),
  amber: scale(
    "#fffbeb",
    "#fef3c7",
    "#fde68a",
    "#fcd34d",
    "#fbbf24",
    "#f59e0b",
    "#d97706",
    "#b45309",
    "#92400e",
    "#78350f",
    "#451a03"
  ),
  yellow: scale(
    "#fefce8",
    "#fef9c3",
    "#fef08a",
    "#fde047",
    "#facc15",
    "#eab308",
    "#ca8a04",
    "#a16207",
    "#854d0e",
    "#713f12",
    "#422006"
  ),
  purple: scale(
    "#faf5ff",
    "#f3e8ff",
    "#e9d5ff",
    "#d8b4fe",
    "#c084fc",
    "#a855f7",
    "#9333ea",
    "#7e22ce",
    "#6b21a8",
    "#581c87",
    "#3b0764"
  ),
  orange: scale(
    "#fff7ed",
    "#ffedd5",
    "#fed7aa",
    "#fdba74",
    "#fb923c",
    "#f97316",
    "#ea580c",
    "#c2410c",
    "#9a3412",
    "#7c2d12",
    "#431407"
  ),
  white: "#ffffff",
  black: "#000000"
};

// src/theme/color-utils.ts
function hexToRgb(hex) {
  const h = hex.trim().replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (full.length !== 6 || /[^0-9a-fA-F]/.test(full)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16)
  };
}
function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrastForeground(hex, dark = "#18181b", light = "#ffffff") {
  return relativeLuminance(hex) > 0.45 ? dark : light;
}

// src/theme/tokens.ts
var spacing = {
  "0": 0,
  "1": 4,
  "1.5": 6,
  "2": 8,
  "3": 12,
  "4": 16,
  "6": 24,
  "8": 32,
  "12": 48,
  "16": 64,
  "20": 80,
  "24": 96,
  "32": 128
};
var baseFontSize = {
  xs: 12,
  code: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  "2xl": 22,
  "3xl": 26,
  "4xl": 34
};
var fontWeight = {
  normal: "400",
  medium: "500",
  semibold: "600",
  bold: "700"
};
var borderRadius = {
  none: 0,
  sm: 2,
  base: 4,
  md: 6,
  lg: 8,
  xl: 12,
  "2xl": 16,
  full: 9999
};
var borderWidth = {
  "0": 0,
  "1": 1,
  "2": 2
};
var opacity = {
  "0": 0,
  "50": 0.5,
  "100": 1
};
var iconSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20
};
var baseLineHeight = { diff: 22 };
var DEFAULT_UI_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
var DEFAULT_MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
function buildShadows(colorScheme) {
  const color = colorScheme === "dark" ? "rgba(0,0,0,0.55)" : "rgba(24,24,27,0.12)";
  return {
    sm: { color, offsetX: 0, offsetY: 1, radius: 2, elevation: 1 },
    md: { color, offsetX: 0, offsetY: 3, radius: 8, elevation: 4 },
    lg: { color, offsetX: 0, offsetY: 10, radius: 24, elevation: 12 }
  };
}

// src/theme/colors.ts
var STATUS = {
  success: palette.green["700"],
  danger: palette.red["700"],
  warning: palette.amber["700"],
  merged: palette.purple["600"]
};
function darkSyntax() {
  return {
    keyword: palette.purple["300"],
    string: palette.green["300"],
    number: palette.orange["300"],
    boolean: palette.orange["300"],
    comment: palette.zinc["500"],
    function: palette.blue["300"],
    variable: palette.zinc["200"],
    type: palette.teal["300"],
    class: palette.amber["300"],
    constant: palette.orange["300"],
    operator: palette.zinc["400"],
    punctuation: palette.zinc["400"],
    tag: palette.red["300"],
    attribute: palette.amber["300"],
    property: palette.blue["200"],
    regexp: palette.teal["300"],
    escape: palette.orange["200"],
    heading: palette.blue["300"],
    link: palette.blue["400"],
    deleted: palette.red["400"],
    inserted: palette.green["400"]
  };
}
function lightSyntax() {
  return {
    keyword: palette.purple["700"],
    string: palette.green["700"],
    number: palette.orange["700"],
    boolean: palette.orange["700"],
    comment: palette.zinc["500"],
    function: palette.blue["700"],
    variable: palette.zinc["800"],
    type: palette.teal["700"],
    class: palette.amber["700"],
    constant: palette.orange["700"],
    operator: palette.zinc["600"],
    punctuation: palette.zinc["600"],
    tag: palette.red["700"],
    attribute: palette.amber["700"],
    property: palette.blue["700"],
    regexp: palette.teal["700"],
    escape: palette.orange["700"],
    heading: palette.blue["700"],
    link: palette.blue["600"],
    deleted: palette.red["700"],
    inserted: palette.green["700"]
  };
}
function terminalFrom(surface0, foreground, accent) {
  return {
    background: surface0,
    foreground,
    cursor: accent,
    cursorAccent: surface0,
    selectionBackground: "rgba(255,255,255,0.18)",
    black: palette.zinc["900"],
    red: palette.red["500"],
    green: palette.green["500"],
    yellow: palette.amber["500"],
    blue: palette.blue["500"],
    magenta: palette.purple["500"],
    cyan: palette.teal["500"],
    white: palette.zinc["300"],
    brightBlack: palette.zinc["600"],
    brightRed: palette.red["400"],
    brightGreen: palette.green["400"],
    brightYellow: palette.amber["400"],
    brightBlue: palette.blue["400"],
    brightMagenta: palette.purple["400"],
    brightCyan: palette.teal["400"],
    brightWhite: palette.zinc["50"]
  };
}
function buildDarkColors(tint) {
  const foreground = palette.zinc["100"];
  const accentForeground = contrastForeground(tint.accent);
  return {
    surface0: tint.surface0,
    surface1: tint.surface1,
    surface2: tint.surface2,
    surface3: tint.surface3,
    surface4: tint.surface4,
    surfaceDiffEmpty: tint.surface1,
    surfaceSidebar: tint.surfaceSidebar,
    surfaceSidebarHover: tint.surfaceSidebarHover,
    surfaceWorkspace: tint.surface0,
    foreground,
    foregroundMuted: tint.mutedForeground,
    accent: tint.accent,
    accentBright: tint.accentBright,
    accentForeground,
    destructive: tint.destructive,
    destructiveForeground: palette.white,
    success: palette.green["500"],
    successForeground: palette.white,
    border: tint.border,
    borderAccent: tint.borderAccent,
    statusSuccess: STATUS.success,
    statusDanger: STATUS.danger,
    statusWarning: STATUS.warning,
    statusMerged: STATUS.merged,
    diffAddition: palette.green["400"],
    diffDeletion: palette.red["400"],
    scrollbarHandle: tint.scrollbarHandle,
    // Legacy aliases → nearest semantic token
    background: tint.surface0,
    popover: tint.surface2,
    popoverForeground: foreground,
    primary: tint.accent,
    secondary: tint.surface2,
    muted: tint.surface2,
    mutedForeground: tint.mutedForeground,
    input: tint.surface2,
    ring: tint.accent,
    palette,
    syntax: darkSyntax(),
    terminal: terminalFrom(tint.surface0, foreground, tint.accent)
  };
}
function buildLightColors() {
  const foreground = palette.zinc["900"];
  const accent = "#20744A";
  return {
    surface0: palette.white,
    surface1: palette.zinc["50"],
    surface2: palette.zinc["100"],
    surface3: palette.zinc["200"],
    surface4: palette.zinc["300"],
    surfaceDiffEmpty: palette.zinc["50"],
    surfaceSidebar: palette.zinc["100"],
    surfaceSidebarHover: palette.zinc["200"],
    surfaceWorkspace: palette.white,
    foreground,
    foregroundMuted: palette.zinc["600"],
    accent,
    accentBright: "#2D8B62",
    accentForeground: palette.white,
    destructive: palette.red["600"],
    destructiveForeground: palette.white,
    success: palette.green["600"],
    successForeground: palette.white,
    border: palette.zinc["200"],
    borderAccent: palette.zinc["100"],
    statusSuccess: STATUS.success,
    statusDanger: STATUS.danger,
    statusWarning: STATUS.warning,
    statusMerged: STATUS.merged,
    diffAddition: palette.green["700"],
    diffDeletion: palette.red["700"],
    scrollbarHandle: palette.zinc["300"],
    background: palette.white,
    popover: palette.white,
    popoverForeground: foreground,
    primary: accent,
    secondary: palette.zinc["100"],
    muted: palette.zinc["100"],
    mutedForeground: palette.zinc["600"],
    input: palette.zinc["100"],
    ring: accent,
    palette,
    syntax: lightSyntax(),
    terminal: {
      ...terminalFrom(palette.white, foreground, accent),
      selectionBackground: "rgba(24,24,27,0.15)",
      white: palette.zinc["700"],
      brightWhite: palette.zinc["900"]
    }
  };
}

// src/theme/variants.ts
var THEME_SWATCHES = {
  light: "#ffffff",
  dark: "#2D8B62",
  zinc: "#808080",
  midnight: "#4A6BA8",
  claude: "#D97757",
  ghostty: "#8caaee"
};
var THEME_NAMES = [
  "light",
  "dark",
  "zinc",
  "midnight",
  "claude",
  "ghostty"
];
function buildVariantColors(name) {
  if (name === "light") return buildLightColors();
  switch (name) {
    case "dark":
      return buildDarkColors({
        surface0: "#1a1f1c",
        surface1: "#1f2622",
        surface2: "#252e28",
        surface3: "#2d3830",
        surface4: "#36453c",
        surfaceSidebar: "#181d1a",
        surfaceSidebarHover: "#1f2622",
        mutedForeground: "#7a9484",
        scrollbarHandle: "#3a4a40",
        border: "#2a3830",
        borderAccent: "#253028",
        accent: "#20744A",
        accentBright: "#7ccba0",
        destructive: palette.red["700"]
      });
    case "zinc":
      return buildDarkColors({
        surface0: "#18181b",
        surface1: "#1c1c1f",
        surface2: "#222226",
        surface3: "#2a2a2e",
        surface4: "#333338",
        surfaceSidebar: "#141417",
        surfaceSidebarHover: "#1c1c1f",
        mutedForeground: "#71717a",
        scrollbarHandle: "#3f3f46",
        border: "#27272a",
        borderAccent: "#222225",
        accent: "#e4e4e7",
        accentBright: "#f4f4f5",
        destructive: palette.red["600"]
      });
    case "midnight":
      return buildDarkColors({
        surface0: "#181c2a",
        surface1: "#1c2130",
        surface2: "#222840",
        surface3: "#2a3350",
        surface4: "#334060",
        surfaceSidebar: "#151928",
        surfaceSidebarHover: "#1c2130",
        mutedForeground: "#6a7fa8",
        scrollbarHandle: "#2e3f60",
        border: "#253050",
        borderAccent: "#1e2a48",
        accent: "#3b6fcf",
        accentBright: "#628de8",
        destructive: palette.red["700"]
      });
    case "claude":
      return buildDarkColors({
        surface0: "#1c1814",
        surface1: "#221e18",
        surface2: "#2a231c",
        surface3: "#342c24",
        surface4: "#3e342a",
        surfaceSidebar: "#181510",
        surfaceSidebarHover: "#221e18",
        mutedForeground: "#9b7560",
        scrollbarHandle: "#4a3a2e",
        border: "#3a2e24",
        borderAccent: "#2e241c",
        accent: "#d97757",
        accentBright: "#e89878",
        destructive: palette.red["700"]
      });
    case "ghostty":
      return buildDarkColors({
        surface0: "#1e2030",
        surface1: "#232538",
        surface2: "#292c42",
        surface3: "#30334c",
        surface4: "#393d58",
        surfaceSidebar: "#1a1c2c",
        surfaceSidebarHover: "#232538",
        mutedForeground: "#6878a8",
        scrollbarHandle: "#383c5a",
        border: "#2c3054",
        borderAccent: "#252848",
        accent: "#89b4fa",
        accentBright: "#a0c8fc",
        destructive: palette.red["600"]
      });
  }
}
var _variants = {};
for (const name of THEME_NAMES) {
  const colorScheme = name === "light" ? "light" : "dark";
  _variants[name] = {
    name,
    colorScheme,
    colors: buildVariantColors(name),
    swatch: THEME_SWATCHES[name]
  };
}
var THEME_VARIANTS = _variants;

// src/theme/theme.ts
function buildTheme(name) {
  const variant = THEME_VARIANTS[name];
  return {
    name,
    colorScheme: variant.colorScheme,
    colors: variant.colors,
    spacing,
    fontSize: { ...baseFontSize },
    fontFamily: {
      ui: DEFAULT_UI_FONT,
      mono: DEFAULT_MONO_FONT
    },
    lineHeight: { ...baseLineHeight },
    iconSize,
    fontWeight,
    borderRadius,
    borderWidth,
    opacity,
    shadow: buildShadows(variant.colorScheme),
    swatch: variant.swatch
  };
}
function getTheme(name) {
  return buildTheme(name);
}

// src/timeline/reducer.ts
var EMPTY_TIMELINE = {
  rows: [],
  gaps: [],
  cursor: void 0,
  endCursor: void 0,
  hasNewer: false,
  epoch: void 0
};
function applyLiveRow(state2, row) {
  const alreadyPresent = state2.rows.some(
    (existing) => existing.seqStart === row.seqStart && existing.source === "page"
  );
  if (alreadyPresent) return state2;
  const deduped = state2.rows.filter((existing) => existing.rowId !== row.rowId);
  const merged = sortRows([...deduped, { ...row, source: "live" }]);
  return { ...state2, rows: merged, gaps: detectGaps(merged) };
}
function detectGaps(rows) {
  if (rows.length < 2) return [];
  const gaps = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const curr = rows[i];
    if (curr.seqStart > prev.seqEnd + 1) {
      gaps.push({ afterSeq: prev.seqEnd, beforeSeq: curr.seqStart });
    }
  }
  return gaps;
}
function sortRows(rows) {
  return [...rows].sort((a, b) => a.seqStart - b.seqStart || a.timestamp - b.timestamp);
}

// src/timeline/render-model.ts
function renderKey(row) {
  return `${row.epochId}:${row.seqStart}:${row.rowId}`;
}
function buildRenderItems(rows) {
  return rows.map((row, index) => ({
    key: renderKey(row),
    index,
    row,
    blockGroupId: extractBlockGroupId(row),
    blockIndex: extractBlockIndex(row)
  }));
}
function extractBlockGroupId(row) {
  if (row.kind !== "assistant_message") return void 0;
  const payload = row.payload;
  return payload?.blockGroupId;
}
function extractBlockIndex(row) {
  if (row.kind !== "assistant_message") return void 0;
  const payload = row.payload;
  return payload?.blockIndex;
}

// src/timeline/row-dispatch.ts
var ROW_GAP_VALUES = {
  "user-to-user": 4,
  "tool-seq-packed": 0,
  "user-to-tool": 16,
  "assistant-tool": 4,
  "block-group": 12,
  "default": 16
};
var TIMELINE_MAX_CONTENT_WIDTH = 820;
var DISPATCH_TABLE = {
  user_message: { kind: "user_message", component: "UserMessageRow", maxWidth: TIMELINE_MAX_CONTENT_WIDTH, gapKey: "user-to-user" },
  assistant_message: { kind: "assistant_message", component: "AssistantMessageRow", maxWidth: TIMELINE_MAX_CONTENT_WIDTH, gapKey: "default" },
  thought: { kind: "thought", component: "ThinkingCard", maxWidth: TIMELINE_MAX_CONTENT_WIDTH, gapKey: "assistant-tool" },
  tool_call: { kind: "tool_call", component: "ToolCallCard", maxWidth: TIMELINE_MAX_CONTENT_WIDTH, gapKey: "tool-seq-packed" },
  todo_list: { kind: "todo_list", component: "TodoListCard", maxWidth: TIMELINE_MAX_CONTENT_WIDTH, gapKey: "default" },
  activity_log: { kind: "activity_log", component: "ActivityLogPill", maxWidth: TIMELINE_MAX_CONTENT_WIDTH, gapKey: "default" },
  compaction: { kind: "compaction", component: "CompactionMarker", maxWidth: TIMELINE_MAX_CONTENT_WIDTH, gapKey: "default" },
  unknown: { kind: "unknown", component: "UnknownRowFallback", maxWidth: TIMELINE_MAX_CONTENT_WIDTH, gapKey: "default" }
};
function dispatchRow(kind) {
  return DISPATCH_TABLE[kind] ?? DISPATCH_TABLE.unknown;
}
function resolveRowGap(current, next) {
  if (!next) return ROW_GAP_VALUES.default;
  if (current === "user_message" && next === "user_message") return ROW_GAP_VALUES["user-to-user"];
  if (current === "tool_call" && next === "tool_call") return ROW_GAP_VALUES["tool-seq-packed"];
  if (current === "user_message" && next === "tool_call") return ROW_GAP_VALUES["user-to-tool"];
  if ((current === "assistant_message" || current === "thought") && (next === "tool_call" || next === "thought")) return ROW_GAP_VALUES["assistant-tool"];
  if ((current === "tool_call" || current === "thought") && (next === "assistant_message" || next === "thought")) return ROW_GAP_VALUES["assistant-tool"];
  return ROW_GAP_VALUES.default;
}

// src/timeline/autoscroll.ts
var INITIAL_AUTOSCROLL_STATE = {
  mode: "sticky-bottom",
  anchorRowId: void 0,
  showJumpButton: false,
  pending: false
};
function onRowsAdded(state2) {
  return { ...state2, shouldScroll: state2.mode === "sticky-bottom" };
}
function onJumpToBottom(state2) {
  return { ...state2, mode: "sticky-bottom", showJumpButton: false, pending: true, shouldScroll: true };
}

// src/timeline/row-treatments.ts
function buildUserMessageModel(row) {
  return {
    alignment: "right",
    text: row.text,
    timestamp: row.timestamp,
    images: row.images ?? [],
    attachments: row.attachments ?? [],
    optimistic: row.optimistic ?? false,
    showRewindMenu: row.canRewind,
    showCopyButton: true
  };
}

// src/timeline/turn-grouping.ts
function segmentIntoTurns(rows) {
  const turns = [];
  let current;
  let turnCounter = 0;
  for (const row of rows) {
    if (row.kind === "user_message") {
      current = {
        turnId: `turn-${turnCounter++}`,
        rows: [row],
        status: "running",
        startedAt: row.timestamp
      };
      turns.push(current);
    } else {
      if (!current) {
        current = { turnId: `turn-${turnCounter++}`, rows: [], status: "running" };
        turns.push(current);
      }
      current.rows.push(row);
    }
  }
  return turns;
}

// src/timeline/tool-cards.ts
var TRUNCATE_LIMIT = 2e3;
function buildToolCardPresentation(payload) {
  const detail = payload.detail;
  const detailType = detail?.type ?? "unknown";
  return {
    displayName: resolveDisplayName(detailType, payload.name, detail),
    summary: resolveSummary(detailType, detail),
    icon: resolveIcon(detailType, payload.name),
    status: payload.status,
    errorText: payload.status === "failed" ? payload.error : void 0,
    isLoadingDetails: payload.status === "running" && !detail,
    hasDetails: Boolean(detail),
    canOpenDetails: detailType !== "unknown" || Boolean(detail),
    openFilePath: resolveOpenFilePath(detail),
    isPlan: detailType === "plan"
  };
}
function resolveDisplayName(type, name, detail) {
  switch (type) {
    case "shell":
      return "Shell";
    case "worktree_setup":
      return "Worktree Setup";
    case "read":
      return "Read";
    case "edit":
      return "Edit";
    case "write":
      return "Write";
    case "search":
      return "Search";
    case "fetch":
      return "Fetch";
    case "sub_agent":
      return detail?.subAgentType ?? "Task";
    case "plan":
      return "Plan";
    case "plain_text":
      return detail?.label ?? humanizeName(name);
    default:
      if (name === "task" || name === "thinking") return humanizeName(name);
      if (name === "terminal") return "Terminal";
      return humanizeName(name);
  }
}
function resolveSummary(type, detail) {
  if (!detail) return "";
  switch (type) {
    case "shell":
      return detail.command ?? "";
    case "worktree_setup":
      return detail.branch ?? "";
    case "read":
      return detail.filePath ?? "";
    case "edit":
      return detail.filePath ?? "";
    case "write":
      return detail.filePath ?? "";
    case "search":
      return detail.query ?? "";
    case "fetch":
      return detail.url ?? "";
    case "sub_agent":
      return detail.description ?? "";
    default:
      return "";
  }
}
function resolveIcon(type, name) {
  switch (type) {
    case "shell":
    case "worktree_setup":
      return "terminal";
    case "read":
      return "eye";
    case "edit":
    case "write":
      return "pencil";
    case "search":
    case "fetch":
      return "search";
    case "sub_agent":
      return "bot";
    case "plan":
      return "brain";
    case "plain_text":
      if (name === "speak") return "mic";
      return "wrench";
    default:
      if (name === "task" || name.includes("agent")) return "bot";
      if (name === "thinking") return "brain";
      if (name === "speak") return "mic";
      return "wrench";
  }
}
function resolveOpenFilePath(detail) {
  if (!detail) return void 0;
  if ("filePath" in detail) return detail.filePath;
  return void 0;
}
function humanizeName(name) {
  if (name.includes("/") || name.includes("::") || name.includes("__")) return name;
  return name.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function buildExpandedDetail(payload) {
  const sections = [];
  const detail = payload.detail;
  if (!detail) return [{ kind: "empty" }];
  switch (detail.type) {
    case "shell":
      sections.push({ kind: "code", language: "shell", content: `$ ${detail.command}${detail.output ? `
${truncate(detail.output)}` : ""}`, fullBleed: true });
      break;
    case "worktree_setup":
      sections.push({ kind: "code", language: "plaintext", content: detail.log ?? `Preparing worktree ${detail.branch}${detail.path ? ` at ${detail.path}` : ""}`, fullBleed: true });
      break;
    case "read":
      sections.push({ kind: "code", language: extensionOf(detail.filePath), content: truncate(detail.content ?? ""), fullBleed: false });
      break;
    case "edit":
      sections.push({ kind: "diff", filePath: detail.filePath, diff: detail.diff ?? "" });
      break;
    case "write":
      sections.push({ kind: "code", language: extensionOf(detail.filePath), content: truncate(detail.content ?? ""), fullBleed: true });
      break;
    case "search":
      sections.push({ kind: "search-results", content: detail.content, filePaths: detail.filePaths, webResults: detail.webResults });
      break;
    case "fetch":
      sections.push({ kind: "text", content: detail.url });
      if (detail.result) sections.push({ kind: "code", language: "plaintext", content: truncate(detail.result), fullBleed: false });
      break;
    case "sub_agent":
      sections.push({ kind: "sub-agent-log", lines: parseSubAgentLog(detail.log ?? ""), sessionId: detail.sessionId });
      break;
    case "plan":
      sections.push({ kind: "text", content: [detail.title, detail.description, detail.body].filter(Boolean).join("\n\n") });
      break;
    case "plain_text":
      sections.push({ kind: "text", content: detail.text });
      break;
    case "unknown":
      if (detail.input) sections.push({ kind: "json", label: "Input", value: detail.input });
      if (detail.output) sections.push({ kind: "json", label: "Output", value: detail.output });
      if (!detail.input && !detail.output) sections.push({ kind: "empty" });
      break;
  }
  if (payload.error) {
    sections.push({ kind: "error", errorText: payload.error });
  }
  return sections;
}
function truncate(text, limit = TRUNCATE_LIMIT) {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + `
\u2026 (${text.length - limit} more characters)`;
}
function parseSubAgentLog(log) {
  return log.split("\n").map((line) => {
    const m = /^\[([^\]]+)\]\s*(.*)$/.exec(line);
    return m ? { type: "action", tool: m[1], summary: m[2] } : { type: "text", text: line };
  });
}
function extensionOf(filePath) {
  const m = /\.(\w+)$/.exec(filePath);
  return m?.[1] ?? "plaintext";
}
function resolveStatusVisual(status) {
  switch (status) {
    case "running":
      return { shimmer: true, iconVariant: "dimmed", labelDimmed: true };
    case "completed":
      return { shimmer: false, iconVariant: "normal", labelDimmed: false };
    case "failed":
      return { shimmer: false, iconVariant: "alert", labelDimmed: false };
    case "canceled":
      return { shimmer: false, iconVariant: "dimmed", labelDimmed: false };
  }
}

// src/timeline/diff-rows.ts
var MAX_DIFF_LINES = 500;
function parseDiff(raw, filePath) {
  const lines = raw.split("\n");
  const hunks = [];
  let current;
  let stat = { added: 0, removed: 0 };
  let truncated = false;
  let count = 0;
  for (const line of lines) {
    if (count > MAX_DIFF_LINES) {
      truncated = true;
      break;
    }
    if (line.startsWith("@@")) {
      current = { header: line, lines: [] };
      hunks.push(current);
    } else if (current) {
      const type = diffLineType(line);
      const prefix = line.length > 0 ? line[0] : " ";
      const content = line.length > 1 ? line.slice(1) : "";
      current.lines.push({ type, prefix, content });
      if (type === "add") stat.added++;
      else if (type === "remove") stat.removed++;
      count++;
    }
  }
  return { filePath, hunks, stat, truncated };
}
function diffLineType(line) {
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "remove";
  if (line.startsWith("@@") || line.startsWith("diff") || line.startsWith("---") || line.startsWith("+++")) return "header";
  return "context";
}
function diffStatLabel(stat) {
  const parts = [];
  if (stat.added > 0) parts.push(`+${stat.added}`);
  if (stat.removed > 0) parts.push(`-${stat.removed}`);
  return parts.join(" ");
}

// src/timeline/markdown.ts
var _idCounter = 0;
function nextId() {
  return `md-${++_idCounter}`;
}
function parseMarkdownBlocks(markdown) {
  const lines = markdown.split("\n");
  const blocks = [];
  let i = 0;
  let streamingFenceOpen = false;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```|^~~~/.test(line)) {
      const fence = line.slice(0, 3);
      const language = line.slice(3).trim();
      const codeLines = [];
      i++;
      let closed = false;
      while (i < lines.length) {
        const l = lines[i];
        if (l.startsWith(fence)) {
          closed = true;
          i++;
          break;
        }
        codeLines.push(l);
        i++;
      }
      streamingFenceOpen = !closed;
      blocks.push({ kind: "code_block", language, code: codeLines.join("\n"), id: nextId() });
      continue;
    }
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (headingMatch) {
      blocks.push({ kind: "heading", level: headingMatch[1].length, text: headingMatch[2], id: nextId() });
      i++;
      continue;
    }
    if (/^(\*{3,}|-{3,}|_{3,})$/.test(line.trim())) {
      blocks.push({ kind: "rule", id: nextId() });
      i++;
      continue;
    }
    if (line.startsWith(">")) {
      const quoteLines = [line.slice(1).trim()];
      i++;
      while (i < lines.length && lines[i].startsWith(">")) {
        quoteLines.push(lines[i].slice(1).trim());
        i++;
      }
      blocks.push({ kind: "blockquote", text: quoteLines.join("\n"), id: nextId() });
      continue;
    }
    if (/^[\*\-\+]\s/.test(line)) {
      const items = [line.slice(2)];
      i++;
      while (i < lines.length && /^[\*\-\+]\s/.test(lines[i])) {
        items.push(lines[i].slice(2));
        i++;
      }
      blocks.push({ kind: "bullet_list", items, id: nextId() });
      continue;
    }
    const olMatch = /^(\d+)\.\s(.*)/.exec(line);
    if (olMatch) {
      const start = Number(olMatch[1]);
      const items = [olMatch[2]];
      i++;
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s/, ""));
        i++;
      }
      blocks.push({ kind: "ordered_list", items, start, id: nextId() });
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && /^\|?[\s\-:]+\|/.test(lines[i + 1] ?? "")) {
      const tableLines = [line];
      i++;
      while (i < lines.length && lines[i].includes("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      const parsedTable = parseTable(tableLines);
      if (parsedTable) {
        blocks.push({ ...parsedTable, id: nextId() });
        continue;
      }
    }
    const imgMatch = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(line.trim());
    if (imgMatch) {
      blocks.push({ kind: "image", alt: imgMatch[1], src: imgMatch[2], id: nextId() });
      i++;
      continue;
    }
    if (line.trim()) {
      const paraLines = [line];
      i++;
      while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|~~~|>|[\*\-\+]\s|\d+\.\s)/.test(lines[i])) {
        paraLines.push(lines[i]);
        i++;
      }
      blocks.push({ kind: "paragraph", text: paraLines.join("\n"), id: nextId() });
      continue;
    }
    i++;
  }
  return { blocks, streamingFenceOpen };
}
function parseTable(lines) {
  const splitRow = (l) => l.split("|").map((c) => c.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const headers = splitRow(lines[0]);
  const rows = lines.slice(2).map(splitRow);
  return { kind: "table", headers, rows };
}
var LANGUAGE_ALIASES = {
  typescript: "ts",
  javascript: "js",
  python: "py",
  rust: "rs",
  "c++": "cpp",
  csharp: "cs",
  golang: "go",
  ruby: "rb",
  bash: "sh",
  shell: "sh",
  kotlin: "kt",
  swift: "swift"
};
function normalizeLanguage(lang) {
  const lower = lang.toLowerCase().trim();
  return LANGUAGE_ALIASES[lower] ?? lower;
}

// ../highlight/dist/highlight.js
var EXTENSION_LANGUAGE = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json"
};
var KEYWORDS = /* @__PURE__ */ new Set([
  "const",
  "let",
  "var",
  "function",
  "return",
  "if",
  "else",
  "for",
  "while",
  "do",
  "switch",
  "case",
  "break",
  "continue",
  "new",
  "class",
  "extends",
  "super",
  "this",
  "import",
  "export",
  "from",
  "as",
  "default",
  "async",
  "await",
  "yield",
  "try",
  "catch",
  "finally",
  "throw",
  "typeof",
  "instanceof",
  "in",
  "of",
  "void",
  "delete",
  "interface",
  "type",
  "enum",
  "implements",
  "public",
  "private",
  "protected",
  "readonly",
  "static",
  "abstract",
  "namespace",
  "declare",
  "true",
  "false",
  "null",
  "undefined"
]);
function detectLanguage(pathOrHint) {
  if (!pathOrHint)
    return "plaintext";
  const hint = pathOrHint.toLowerCase();
  if (hint === "typescript" || hint === "ts")
    return "typescript";
  if (hint === "javascript" || hint === "js")
    return "javascript";
  if (hint === "json")
    return "json";
  const ext = hint.includes(".") ? hint.split(".").at(-1) ?? "" : hint;
  return EXTENSION_LANGUAGE[ext] ?? "plaintext";
}
function highlight(source, hint) {
  const language = detectLanguage(hint);
  if (language === "plaintext") {
    return { language, tokens: source.length > 0 ? [{ type: "text", value: source }] : [] };
  }
  return { language, tokens: tokenize(source, language) };
}
var CODE_MATCHERS = [
  { type: "comment", re: /^\/\/[^\n]*/ },
  { type: "comment", re: /^\/\*[\s\S]*?(?:\*\/|$)/ },
  { type: "string", re: /^"(?:\\.|[^"\\])*"/ },
  { type: "string", re: /^'(?:\\.|[^'\\])*'/ },
  { type: "string", re: /^`(?:\\.|[^`\\])*`/ },
  { type: "number", re: /^0[xX][0-9a-fA-F]+|^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/ },
  { type: "identifier", re: /^[A-Za-z_$][\w$]*/ },
  { type: "punctuation", re: /^[{}()[\];:,.<>+\-*/%=!&|^~?@]+/ }
];
var JSON_MATCHERS = [
  { type: "string", re: /^"(?:\\.|[^"\\])*"/ },
  { type: "number", re: /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/ },
  { type: "keyword", re: /^(?:true|false|null)\b/ },
  { type: "punctuation", re: /^[{}[\]:,]+/ }
];
function tokenize(source, language) {
  const matchers = language === "json" ? JSON_MATCHERS : CODE_MATCHERS;
  const tokens = [];
  let rest = source;
  let pendingText = "";
  const flushText = () => {
    if (pendingText) {
      tokens.push({ type: "text", value: pendingText });
      pendingText = "";
    }
  };
  while (rest.length > 0) {
    const ws = /^\s+/.exec(rest);
    if (ws) {
      pendingText += ws[0];
      rest = rest.slice(ws[0].length);
      continue;
    }
    let matched = false;
    for (const matcher of matchers) {
      const m = matcher.re.exec(rest);
      if (m && m[0].length > 0) {
        flushText();
        const value = m[0];
        let type = matcher.type;
        if (type === "identifier" && KEYWORDS.has(value))
          type = "keyword";
        tokens.push({ type, value });
        rest = rest.slice(value.length);
        matched = true;
        break;
      }
    }
    if (!matched) {
      pendingText += rest[0];
      rest = rest.slice(1);
    }
  }
  flushText();
  return tokens;
}

// src/timeline/syntax-highlight.ts
function highlightCode(code, langHint, serverSpans) {
  if (serverSpans && serverSpans.length > 0) {
    return applyServerSpans(code, serverSpans);
  }
  const lang = normalizeLanguage(langHint);
  const detectedLang = detectLanguage(lang.length <= 6 && /^\w+$/.test(lang) ? `file.${lang}` : lang);
  const result = highlight(code, detectedLang);
  return tokenLinesToLines(code, result.tokens);
}
function applyServerSpans(code, spans) {
  const lines = code.split("\n");
  const lineLines = [];
  let spanIndex = 0;
  let charPos = 0;
  const spanBuffer = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const lineStart = charPos;
    const lineEnd = charPos + lines[lineIndex].length;
    const lineSpans = [];
    while (spanIndex < spans.length) {
      const span = spans[spanIndex];
      const consumed = spanBuffer.reduce((n, s) => n + s.value.length, 0);
      if (consumed >= lineEnd - lineStart) break;
      lineSpans.push({ type: span.type, value: span.value });
      spanIndex++;
    }
    lineLines.push({ lineIndex, spans: lineSpans.length > 0 ? lineSpans : [{ type: "text", value: lines[lineIndex] }] });
    charPos = lineEnd + 1;
  }
  return lineLines;
}
function tokenLinesToLines(code, tokens) {
  const lines = code.split("\n");
  const lineLines = [];
  let tokenIndex = 0;
  let offsetInToken = 0;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const lineText = lines[lineIndex];
    let remaining = lineText.length;
    const spans = [];
    while (remaining > 0 && tokenIndex < tokens.length) {
      const token = tokens[tokenIndex];
      const available = token.value.length - offsetInToken;
      if (available <= remaining) {
        spans.push({ type: token.type, value: token.value.slice(offsetInToken) });
        remaining -= available;
        tokenIndex++;
        offsetInToken = 0;
      } else {
        spans.push({ type: token.type, value: token.value.slice(offsetInToken, offsetInToken + remaining) });
        offsetInToken += remaining;
        remaining = 0;
      }
    }
    if (remaining > 0) spans.push({ type: "text", value: lineText.slice(lineText.length - remaining) });
    lineLines.push({ lineIndex, spans: spans.length > 0 ? spans : [{ type: "text", value: lineText }] });
    tokenIndex++;
  }
  return lineLines;
}

// src/timeline/rewind.ts
var REWIND_LABELS = {
  conversation: { label: "Rewind conversation", description: "Undo this message and all following turns in the conversation" },
  files: { label: "Rewind files", description: "Revert workspace file changes since this message" },
  both: { label: "Rewind conversation & files", description: "Undo this message and revert all file changes made after it" }
};
function rewindMenuItems(capabilities) {
  const items = [];
  if (capabilities.supportsRewindConversation) items.push({ mode: "conversation", ...REWIND_LABELS.conversation });
  if (capabilities.supportsRewindFiles) items.push({ mode: "files", ...REWIND_LABELS.files });
  if (capabilities.supportsRewindBoth) items.push({ mode: "both", ...REWIND_LABELS.both });
  return items;
}
var REWIND_IDLE = { status: "idle" };
function startRewind(messageId, mode) {
  return { status: "pending", mode, messageId };
}
function postRewindActions(input) {
  const actions = [];
  if (input.mode !== "files") {
    actions.push({ kind: "refetch-tail", agentId: input.agentId });
    if (input.composerEmpty && input.rewoundMessageText) {
      actions.push({ kind: "restore-composer", text: input.rewoundMessageText });
    }
  }
  return actions.length > 0 ? actions : [{ kind: "noop" }];
}

// src/composer/draft-store.ts
var DRAFTS_STORE_KEY = "pi-studio-drafts-v2";
function draftStoreKey(draftKey) {
  return `${DRAFTS_STORE_KEY}:${draftKey}`;
}
var DraftStore = class {
  constructor(storage) {
    this.storage = storage;
  }
  load(draftKey) {
    const raw = this.storage.getItem(draftStoreKey(draftKey));
    if (!raw) return { key: draftKey, text: "", attachments: [], lifecycle: "active" };
    try {
      return JSON.parse(raw);
    } catch {
      return { key: draftKey, text: "", attachments: [], lifecycle: "active" };
    }
  }
  save(draft) {
    if (draft.lifecycle === "active" && !draft.text && draft.attachments.length === 0) {
      this.storage.setItem(draftStoreKey(draft.key), "");
    } else {
      this.storage.setItem(draftStoreKey(draft.key), JSON.stringify(draft));
    }
  }
  setText(draftKey, text) {
    const draft = { ...this.load(draftKey), text };
    this.save(draft);
    return draft;
  }
  addAttachment(draftKey, attachment) {
    const draft = this.load(draftKey);
    const updated = { ...draft, attachments: [...draft.attachments, attachment] };
    this.save(updated);
    return updated;
  }
  removeAttachment(draftKey, index) {
    const draft = this.load(draftKey);
    const updated = { ...draft, attachments: draft.attachments.filter((_, i) => i !== index) };
    this.save(updated);
    return updated;
  }
  markSent(draftKey) {
    const draft = { ...this.load(draftKey), lifecycle: "sent", text: "", attachments: [] };
    this.save(draft);
  }
  markAbandoned(draftKey) {
    const draft = { ...this.load(draftKey), lifecycle: "abandoned" };
    this.save(draft);
  }
  restore(draftKey, text) {
    const draft = { ...this.load(draftKey), text, lifecycle: "active" };
    this.save(draft);
    return draft;
  }
};

// src/composer/preferences.ts
function prefStoreKey(projectKey) {
  return `pi-studio-create-agent-prefs:${projectKey}`;
}
var CreateAgentPrefsStore = class {
  constructor(storage) {
    this.storage = storage;
  }
  load(projectKey) {
    const raw = this.storage.getItem(prefStoreKey(projectKey));
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  save(projectKey, prefs) {
    this.storage.setItem(prefStoreKey(projectKey), JSON.stringify(prefs));
  }
  setProvider(projectKey, provider) {
    const prefs = { ...this.load(projectKey), provider };
    this.save(projectKey, prefs);
    return prefs;
  }
  setModel(projectKey, provider, model) {
    const prefs = this.load(projectKey);
    const pp = { ...prefs.providerPreferences?.[provider] ?? {}, model };
    const updated = { ...prefs, providerPreferences: { ...prefs.providerPreferences, [provider]: pp } };
    this.save(projectKey, updated);
    return updated;
  }
  setMode(projectKey, provider, mode) {
    const prefs = this.load(projectKey);
    const pp = { ...prefs.providerPreferences?.[provider] ?? {}, mode };
    const updated = { ...prefs, providerPreferences: { ...prefs.providerPreferences, [provider]: pp } };
    this.save(projectKey, updated);
    return updated;
  }
  setThinking(projectKey, provider, model, thinkingLevel) {
    const prefs = this.load(projectKey);
    const existing = prefs.providerPreferences?.[provider] ?? {};
    const pp = { ...existing, thinkingByModel: { ...existing.thinkingByModel ?? {}, [model]: thinkingLevel } };
    const updated = { ...prefs, providerPreferences: { ...prefs.providerPreferences, [provider]: pp } };
    this.save(projectKey, updated);
    return updated;
  }
  toggleFavoriteModel(projectKey, provider, modelId) {
    const prefs = this.load(projectKey);
    const favorites = prefs.favoriteModels ?? [];
    const exists = favorites.some((f) => f.provider === provider && f.modelId === modelId);
    const updated = {
      ...prefs,
      favoriteModels: exists ? favorites.filter((f) => !(f.provider === provider && f.modelId === modelId)) : [...favorites, { provider, modelId }]
    };
    this.save(projectKey, updated);
    return updated;
  }
  isFavorite(prefs, provider, modelId) {
    return prefs.favoriteModels?.some((f) => f.provider === provider && f.modelId === modelId) ?? false;
  }
  prefillDefaults(prefs, provider) {
    return prefs.providerPreferences?.[provider] ?? {};
  }
};

// src/composer/submit.ts
function resolveSubmitDecision(input) {
  const hasSendable = input.text.trim().length > 0 || input.attachments.length > 0;
  if (!hasSendable || !input.canSubmit) return "noop";
  if (input.agentRunning && !input.forceSubmit) return "queued";
  return "submitted";
}

// src/composer/autocomplete.ts
function detectActiveToken(text, cursorPos) {
  const upToCursor = text.slice(0, cursorPos);
  const lastNl = upToCursor.lastIndexOf("\n");
  const lineStart = lastNl + 1;
  const lineText = upToCursor.slice(lineStart);
  const atMatch = /(?:^|\s)@(\S*)$/.exec(lineText);
  if (atMatch) {
    const token = atMatch[1];
    const startIndex = cursorPos - token.length - 1;
    return { mode: "file", token, startIndex, endIndex: cursorPos, isLineLead: false };
  }
  const slashMatch = /(?:^|\s)(\/\S*)$/.exec(lineText);
  if (slashMatch) {
    const token = slashMatch[1];
    const startIndex = cursorPos - token.length;
    const isLineLead = slashMatch[0].trimStart() === token;
    return { mode: "command", token, startIndex, endIndex: cursorPos, isLineLead };
  }
  return { mode: "none", token: "", startIndex: cursorPos, endIndex: cursorPos, isLineLead: false };
}
var CLIENT_SLASH_COMMANDS = [
  { name: "exit", description: "Archive the current agent", argumentHint: void 0, isClientCommand: true },
  { name: "clear", description: "Archive and start a fresh draft", argumentHint: void 0, isClientCommand: true }
];

// src/composer/voice.ts
var INITIAL_DICTATION_STATE = { status: "idle", volume: 0, durationMs: 0 };
var INITIAL_VOICE_STATE = { phase: "disabled", muted: false, volume: 0, speaking: false };
function isVoiceActive(state2) {
  return state2.phase !== "disabled" && state2.phase !== "stopping";
}
function activeInputMode(dictation, voice) {
  if (isVoiceActive(voice)) return "voice";
  if (dictation.status === "recording" || dictation.status === "processing") return "dictation";
  return "none";
}

// web/main.ts
var SERVER_ID = "local-preview";
var WORKSPACE_ID = "pi-studio";
var WORKSPACE_DIR = "/home/avatsaev/DEV/avatsaev/pi-studio";
var layoutStore = new WorkspaceLayoutStore(window.localStorage);
var pinnedStore = new PinnedTargetsStore(window.localStorage);
var draftStore = new DraftStore(window.localStorage);
var prefsStore = new CreateAgentPrefsStore(window.localStorage);
var DEMO_DRAFT_KEY = `${SERVER_ID}:demo-draft`;
var state = createInitialState();
var rootElement = document.getElementById("root");
if (!rootElement) throw new Error("#root missing");
var root = rootElement;
injectStyles();
render();
function createInitialState() {
  const seeded = resolveWorkspaceEntry({
    state: {
      routeFocused: true,
      persistenceKey: `${SERVER_ID}:${WORKSPACE_ID}`,
      workspaceDir: WORKSPACE_DIR,
      layoutHydrated: true,
      agentsHydrated: true,
      terminalsHydrated: true,
      activeAgentCount: 0,
      terminalCount: 0,
      tabs: []
    },
    openIntent: null,
    nextDraftId: "draft-1",
    now: Date.now()
  });
  const tabs = seeded.action === "seed-draft" ? [seeded.tab] : [createWorkspaceTab({ kind: "draft", draftId: "draft-1", setup: { provider: "default", cwd: WORKSPACE_DIR } })];
  const persisted = layoutStore.load(SERVER_ID, WORKSPACE_ID);
  const layout = listPanes(persisted.root).some((pane) => pane.tabIds.length > 0) ? persisted : defaultWorkspaceLayout(tabs.map((tab) => tab.tabId));
  const activeId = activeTabForPane(findPane(layout.root, layout.focusedPaneId) ?? listPanes(layout.root)[0]);
  return {
    tabs,
    layout,
    mountedLru: nextMountedTabLru([], activeId),
    formFactor: window.innerWidth < 680 ? "mobile" : window.innerWidth < 980 ? "narrow" : "wide",
    focusMode: false,
    explorerOpen: true,
    gateScenario: "ready",
    eventLog: ["Seeded initial draft tab from workspace seeding model."],
    nextDraft: 2,
    nextTerminal: 1,
    nextBrowser: 1,
    nextAgent: 1,
    timeline: createTimelinePreview()
  };
}
function render() {
  const theme = getTheme("dark");
  const panes = listPanes(state.layout.root);
  const composition = composeWorkspaceScreen({
    focusMode: state.focusMode,
    formFactor: state.formFactor,
    platform: "web",
    explorerOpen: state.explorerOpen,
    workspaceDirPresent: true,
    panes
  });
  const header = workspaceHeaderModel({
    loading: false,
    title: "pi-studio",
    projectSubtitle: WORKSPACE_DIR,
    branch: "main",
    projectKind: "git",
    formFactor: state.formFactor,
    scriptsCount: 2,
    workspaceDir: WORKSPACE_DIR,
    diffStat: { added: 3, modified: 4, deleted: 1 },
    setupAvailable: true,
    terminalReady: true,
    isElectron: false
  });
  const gate = gateState();
  const pinned = pinnedStore.load().targets;
  document.documentElement.style.setProperty("--surface0", theme.colors.surface0);
  document.documentElement.style.setProperty("--surface1", theme.colors.surface1);
  document.documentElement.style.setProperty("--surface2", theme.colors.surface2);
  document.documentElement.style.setProperty("--surface3", theme.colors.surface3);
  document.documentElement.style.setProperty("--surface4", theme.colors.surface4);
  document.documentElement.style.setProperty("--sidebar", theme.colors.surfaceSidebar);
  document.documentElement.style.setProperty("--fg", theme.colors.foreground);
  document.documentElement.style.setProperty("--muted", theme.colors.foregroundMuted);
  document.documentElement.style.setProperty("--border", theme.colors.border);
  document.documentElement.style.setProperty("--accent", theme.colors.accent);
  document.documentElement.style.setProperty("--accentBright", theme.colors.accentBright);
  document.documentElement.style.setProperty("--danger", theme.colors.destructive);
  document.documentElement.style.setProperty("--success", theme.colors.success);
  root.innerHTML = `
    <div class="app-shell ${state.formFactor}">
      ${composition.showPrimaryHeader ? renderHeader(header) : ""}
      <main class="workspace-shell">
        <aside class="sidebar ${composition.showExplorerSidebar ? "" : "hidden"}">
          ${renderSidebar(pinned)}
        </aside>
        <section class="workspace-main">
          ${renderGateBanner(gate)}
          ${state.formFactor === "mobile" ? renderMobileSwitcher(pinned) : renderDesktopTabStrip(panes)}
          <div class="pane-area ${composition.tabStripMode}">
            ${state.formFactor === "mobile" ? renderMobilePane() : renderSplitNode(state.layout.root)}
          </div>
        </section>
        <aside class="inspect">
          ${renderInspector(composition.tabStripMode, gate.state)}
        </aside>
      </main>
    </div>
  `;
  bindActions();
}
function renderHeader(header) {
  return `
    <header class="topbar">
      <button data-action="toggle-sidebar" title="Toggle explorer">\u2630</button>
      <div class="title-block">
        <strong>${escapeHtml(header.left.title)}</strong>
        <span>${escapeHtml(header.left.branch ?? "no branch")}</span>
      </div>
      <div class="header-actions">
        ${header.right.map((item) => `<button data-action="header:${item.id}" title="${escapeHtml(item.label)}">${escapeHtml(item.iconOnly ? iconForAction(item.id) : item.label)}${item.badge ? `<b>${escapeHtml(item.badge)}</b>` : ""}</button>`).join("")}
        <button data-action="toggle-focus">${state.focusMode ? "Exit focus" : "Focus"}</button>
      </div>
    </header>
  `;
}
function renderSidebar(pinned) {
  const launch = quickLaunchButtons(pinned, nextIds());
  return `
    <div class="panel-title">Workspace</div>
    <div class="path">${escapeHtml(WORKSPACE_DIR)}</div>
    <div class="section-label">Quick launch</div>
    <div class="quick-actions">
      ${launch.map((button) => `<button data-open-target="${encodeURIComponent(JSON.stringify(button.tabTarget))}">${escapeHtml(button.label)}</button>`).join("")}
    </div>
    <div class="section-label">Pin new-menu targets</div>
    <div class="pin-list">
      ${renderPinToggle({ kind: "draft" }, pinned)}
      ${renderPinToggle({ kind: "terminal" }, pinned)}
      ${renderPinToggle({ kind: "browser" }, pinned)}
      ${renderPinToggle({ kind: "profile", profileId: "fast-agent" }, pinned)}
    </div>
    <div class="section-label">Route gates</div>
    <select data-action="gate-select">
      ${["ready", "splash", "foreign", "missing", "offline"].map((key) => `<option value="${key}" ${state.gateScenario === key ? "selected" : ""}>${key}</option>`).join("")}
    </select>
  `;
}
function renderPinToggle(target, pinned) {
  const active = pinned.some((item) => JSON.stringify(item) === JSON.stringify(target));
  const label = target.kind === "profile" ? `profile:${target.profileId}` : target.kind;
  return `<button class="pin ${active ? "active" : ""}" data-pin="${encodeURIComponent(JSON.stringify(target))}">${active ? "Unpin" : "Pin"} ${escapeHtml(label)}</button>`;
}
function renderGateBanner(gate) {
  const detail = gate.state === "foreign" ? `redirect \u2192 ${gate.redirect}` : "actions" in gate ? gate.actions.join(", ") : "";
  return `<div class="gate ${gate.state}"><strong>Route gate:</strong> ${escapeHtml(gate.state)} ${detail ? `<span>${escapeHtml(detail)}</span>` : ""}</div>`;
}
function renderDesktopTabStrip(panes) {
  const allIds = panes.flatMap((pane) => pane.tabIds);
  const widths = distributeTabWidths(Math.max(1, allIds.length), Math.max(360, window.innerWidth - 520));
  return `
    <div class="desktop-strip ${widths.scroll ? "scroll" : ""}">
      ${allIds.map((tabId, index) => renderTabButton(tabById(tabId), tabId, widths.widths[index] ?? 120)).join("")}
      <button data-action="new-agent">+ Agent</button>
      <button data-action="new-terminal">+ Terminal</button>
      <button data-action="new-browser">+ Browser</button>
      <button data-action="split-right" ${supportsPaneSplits("web", state.formFactor === "mobile") ? "" : "disabled"}>Split right</button>
      <button data-action="split-down" ${supportsPaneSplits("web", state.formFactor === "mobile") ? "" : "disabled"}>Split down</button>
    </div>
  `;
}
function renderTabButton(tab, tabId, width) {
  if (!tab) return "";
  const descriptor = descriptorForTab(tab);
  const active = tabId === activeTabId();
  const menu = tabContextMenu({ tab, tabs: state.tabs, index: state.tabs.findIndex((item) => item.tabId === tabId), formFactor: "desktop" });
  return `
    <button class="tab ${active ? "active" : ""}" style="width:${width}px" title="${escapeHtml(tabTooltip(tab, descriptor.label))}" data-focus-tab="${escapeHtml(tabId)}">
      <span class="glyph">${escapeHtml(visualIcon(descriptor.icon))}</span><span>${escapeHtml(descriptor.label)}</span>
      <small>${menu.filter((item) => !item.disabled).length}</small>
      <i data-close-tab="${escapeHtml(tabId)}">\xD7</i>
    </button>
  `;
}
function renderMobileSwitcher(pinned) {
  const model = buildMobileSwitcher({ tabs: state.tabs, activeTabId: activeTabId(), pinnedTargets: pinned, ...nextIds() });
  return `
    <div class="mobile-switcher">
      <select data-action="mobile-tab-select">
        ${model.entries.map((entry2) => `<option value="${escapeHtml(entry2.tabId)}" ${entry2.active ? "selected" : ""}>${escapeHtml(visualIcon(entry2.icon))} ${escapeHtml(entry2.label)} \xB7 ${escapeHtml(entry2.statusBucket ?? "idle")}</option>`).join("")}
      </select>
      ${model.newTabActions.map((button) => `<button data-open-target="${encodeURIComponent(JSON.stringify(button.tabTarget))}">+ ${escapeHtml(button.label)}</button>`).join("")}
    </div>
  `;
}
function renderMobilePane() {
  const visible = compactVisibleTabs(state.tabs, activeTabId());
  const tab = visible[0];
  return tab ? `<div class="single-mobile-pane">${renderTabContent(tab)}</div>` : `<div class="empty">No tab</div>`;
}
function renderSplitNode(node) {
  if (node.kind === "pane") return renderPane(node);
  return `<div class="split ${node.direction}" style="--children:${node.children.length}">${node.children.map((child, index) => `<div class="split-child" style="flex:${node.sizes[index] ?? 1}">${renderSplitNode(child)}</div>`).join("")}</div>`;
}
function renderPane(pane) {
  const activeId = activeTabForPane(pane);
  const tab = activeId ? tabById(activeId) : void 0;
  const focused = pane.id === state.layout.focusedPaneId;
  return `
    <section class="pane ${focused ? "focused" : ""}" data-focus-pane="${escapeHtml(pane.id)}">
      <div class="pane-head">
        <span>Pane ${escapeHtml(pane.id)}</span>
        <span>${pane.tabIds.length} tab${pane.tabIds.length === 1 ? "" : "s"}</span>
      </div>
      ${tab ? renderTabContent(tab) : renderEmptyPane(pane.id)}
    </section>
  `;
}
function renderEmptyPane(paneId) {
  return `<div class="empty"><strong>Empty pane</strong><p>Seed a draft composer in this pane.</p><button data-seed-pane="${escapeHtml(paneId)}">Seed draft</button></div>`;
}
function renderTabContent(tab) {
  const descriptor = descriptorForTab(tab, tab.target.kind === "agent" ? { statusBucket: "running" } : {});
  const active = tab.tabId === activeTabId();
  const mountedState = mountedTabState(tab.tabId, activeTabId(), state.mountedLru);
  const body = panelBody(tab);
  return `
    <article class="tab-panel ${active ? "active" : ""}">
      <div class="panel-heading">
        <span class="avatar">${escapeHtml(visualIcon(descriptor.icon))}</span>
        <div><strong>${escapeHtml(descriptor.label)}</strong><small>${escapeHtml(descriptor.subtitle ?? descriptor.statusBucket ?? mountedState)}</small></div>
        <span class="pill">${escapeHtml(tab.target.kind)}</span>
      </div>
      ${body}
    </article>
  `;
}
function panelBody(tab) {
  switch (tab.target.kind) {
    case "draft":
      return `<div class="composer">${renderComposer()}<div><button data-action="promote-draft" data-tab="${escapeHtml(tab.tabId)}">Create demo agent from draft</button></div></div>`;
    case "agent":
      return renderTimelinePanel();
    case "terminal":
      return `<pre class="terminal">$ npm run dev
terminal ${escapeHtml(tab.target.terminalId)}
PTY rendering arrives in later panel sprint.</pre>`;
    case "browser":
      return `<div class="browser-mock"><div>https://localhost:${8080 + state.nextBrowser}/</div><p>Browser panel placeholder from workspace tab registry.</p></div>`;
    case "file":
      return `<pre class="file-preview">// ${escapeHtml(tab.target.path)}
export const preview = true;</pre>`;
    case "setup":
      return `<div class="setup-panel">Workspace setup for ${escapeHtml(tab.target.workspaceId)}</div>`;
  }
}
function renderInspector(tabStripMode, gateState2) {
  const closePlan = planBulkClose(state.tabs, state.tabs.filter((tab) => tab.target.kind === "agent").map((tab) => ({ agentId: tab.target.kind === "agent" ? tab.target.agentId : "" })));
  return `
    <div class="panel-title">Current implementation state</div>
    <dl>
      <dt>Tabs</dt><dd>${state.tabs.length}</dd>
      <dt>Panes</dt><dd>${listPanes(state.layout.root).length}</dd>
      <dt>Tab strip</dt><dd>${escapeHtml(tabStripMode)}</dd>
      <dt>Route gate</dt><dd>${escapeHtml(gateState2)}</dd>
      <dt>Mounted LRU</dt><dd>${escapeHtml(state.mountedLru.join(" \u2192 ") || "none")}</dd>
    </dl>
    <button data-action="bulk-close">Plan bulk close</button>
    <button data-action="reset">Reset preview state</button>
    <div class="section-label">Bulk close wording</div>
    <p class="muted">${escapeHtml(closePlan.confirmation)}</p>
    <div class="section-label">Event log</div>
    <ol class="log">${state.eventLog.slice(-8).reverse().map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ol>
  `;
}
function createTimelinePreview() {
  const now = Date.now();
  const rows = [
    { rowId: "r1", kind: "user_message", seqStart: 1, seqEnd: 1, source: "page", epochId: "e1", timestamp: now - 3e4, payload: { text: "Implement the workspace shell.", canRewind: true } },
    { rowId: "r2", kind: "tool_call", seqStart: 2, seqEnd: 2, source: "page", epochId: "e1", timestamp: now - 29e3, payload: { callId: "c1", name: "read_file", status: "completed", detail: { type: "read", filePath: "packages/app/src/workspace/tabs.ts", content: "export type WorkspaceTab = ..." } } },
    { rowId: "r3", kind: "tool_call", seqStart: 3, seqEnd: 3, source: "page", epochId: "e1", timestamp: now - 28e3, payload: { callId: "c2", name: "bash", status: "completed", detail: { type: "shell", command: "npm run build", output: "Build succeeded" } } },
    { rowId: "r4", kind: "assistant_message", seqStart: 4, seqEnd: 4, source: "page", epochId: "e1", timestamp: now - 5e3, payload: { text: "I've implemented the workspace shell with **tabs**, pane splits, and seeding. Here's a summary:\n\n```typescript\nexport type WorkspaceTab = {\n  tabId: string;\n  target: WorkspaceTabTarget;\n};\n```", blockGroupId: "bg1", blockIndex: 0 } },
    { rowId: "r5", kind: "activity_log", seqStart: 5, seqEnd: 5, source: "live", epochId: "e1", timestamp: now - 1e3, payload: { activityType: "success", message: "Build passed \u2014 929 tests" } }
  ];
  let timeline = EMPTY_TIMELINE;
  for (const row of rows) timeline = applyLiveRow(timeline, row);
  return { timeline, autoscroll: INITIAL_AUTOSCROLL_STATE, expandedToolIds: /* @__PURE__ */ new Set(), rewindState: REWIND_IDLE, draftText: draftStore.load(DEMO_DRAFT_KEY).text };
}
function renderTimelinePanel() {
  const tl = state.timeline;
  const items = buildRenderItems(tl.timeline.rows);
  const turns = segmentIntoTurns(tl.timeline.rows);
  return `
    <div class="timeline-panel">
      <div class="panel-heading">
        <span class="avatar">${escapeHtml(visualIcon("bot"))}</span>
        <div><strong>Agent Timeline</strong><small>${items.length} rows \xB7 sprint-015</small></div>
        <button data-action="add-live-row">+ Live row</button>
        <button data-action="clear-timeline">Clear</button>
      </div>
      <div class="timeline-rows">
        ${items.map((item) => renderTimelineRow(item.row, tl)).join("")}
        ${tl.autoscroll.showJumpButton ? `<div class="jump-btn"><button data-action="jump-to-bottom">\u2193 Jump to latest</button></div>` : ""}
      </div>
      <div class="composer-area">
        ${renderComposer()}
      </div>
    </div>
  `;
}
function renderTimelineRow(row, tl) {
  const renderer = dispatchRow(row.kind);
  const payload = row.payload;
  let body = "";
  if (row.kind === "user_message") {
    const m = buildUserMessageModel({ text: String(payload.text ?? ""), timestamp: row.timestamp, canRewind: Boolean(payload.canRewind) });
    const rewindItems = rewindMenuItems({ supportsRewindConversation: true, supportsRewindFiles: true, supportsRewindBoth: true });
    const rewindMenu = m.showRewindMenu ? `<div class="rewind-menu">${rewindItems.map((item) => `<button data-rewind-mode="${escapeHtml(item.mode)}" data-row-id="${escapeHtml(row.rowId)}" title="${escapeHtml(item.description)}">${escapeHtml(item.label)}</button>`).join("")}</div>` : "";
    body = `<div class="bubble user">${escapeHtml(String(payload.text ?? ""))}${rewindMenu}</div>`;
  } else if (row.kind === "assistant_message") {
    const text = String(payload.text ?? "");
    const { blocks, streamingFenceOpen } = parseMarkdownBlocks(text);
    const mdHtml = blocks.map((block) => {
      if (block.kind === "code_block") {
        const lines = highlightCode(block.code, block.language);
        return `<pre class="code-block"><code>${lines.map((l) => l.spans.map((s) => `<span style="color:${escapeHtml(tokenColorVar(s.type))}">${escapeHtml(s.value)}</span>`).join("")).join("\n")}</code></pre>`;
      }
      if (block.kind === "heading") return `<h${block.level}>${escapeHtml(block.text)}</h${block.level}>`;
      if (block.kind === "bullet_list") return `<ul>${block.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`;
      return `<p>${escapeHtml(block.text ?? "")}</p>`;
    }).join("");
    body = `<div class="bubble assistant">${mdHtml}${streamingFenceOpen ? `<span class="streaming">\u25CF streaming</span>` : ""}</div>`;
  } else if (row.kind === "tool_call") {
    const card = buildToolCardPresentation(payload);
    const visual = resolveStatusVisual(card.status);
    const expanded = tl.expandedToolIds.has(row.rowId);
    const details = expanded ? buildExpandedDetail(payload).map(renderDetailSection).join("") : "";
    body = `<div class="tool-card ${visual.shimmer ? "shimmer" : ""} ${visual.iconVariant}" data-toggle-tool="${escapeHtml(row.rowId)}">
      <span class="glyph">${escapeHtml(visualIcon(toolIconName(card.icon)))}</span>
      <span class="tool-name">${escapeHtml(card.displayName)}</span>
      <span class="tool-summary muted">${escapeHtml(card.summary)}</span>
      <span class="tool-status">${escapeHtml(card.status)}</span>
      ${card.errorText ? `<span class="error">${escapeHtml(card.errorText)}</span>` : ""}
      ${expanded ? `<div class="tool-details">${details}</div>` : ""}
    </div>`;
  } else if (row.kind === "activity_log") {
    const type = String(payload.activityType ?? "info");
    body = `<div class="activity-pill ${escapeHtml(type)}">${escapeHtml(String(payload.message ?? ""))}</div>`;
  } else {
    body = `<div class="fallback">[${escapeHtml(row.kind)}]</div>`;
  }
  const gap = resolveRowGap(row.kind, void 0);
  return `<div class="row-wrapper" style="margin-bottom:${gap}px">${body}</div>`;
}
function renderDetailSection(section) {
  if (section.kind === "code") return `<pre class="terminal">${escapeHtml(section.content)}</pre>`;
  if (section.kind === "text") return `<p>${escapeHtml(section.content)}</p>`;
  if (section.kind === "error") return `<p class="error">${escapeHtml(section.errorText)}</p>`;
  if (section.kind === "diff") {
    const parsed = parseDiff(section.diff, section.filePath);
    return `<div class="diff-stat">${escapeHtml(diffStatLabel(parsed.stat))}</div>`;
  }
  return `<p class="muted">[${escapeHtml(section.kind)}]</p>`;
}
function renderComposer() {
  const draft = draftStore.load(DEMO_DRAFT_KEY);
  const token = detectActiveToken(draft.text, draft.text.length);
  const decision = resolveSubmitDecision({ text: draft.text, attachments: draft.attachments, agentRunning: false, forceSubmit: false, canSubmit: true });
  const inputMode = activeInputMode(INITIAL_DICTATION_STATE, INITIAL_VOICE_STATE);
  const suggestions = token.mode === "command" ? CLIENT_SLASH_COMMANDS.map((cmd) => `<li><b>/${escapeHtml(cmd.name)}</b> \u2014 ${escapeHtml(cmd.description)}</li>`).join("") : "";
  return `
    <div class="composer-surface">
      ${token.mode !== "none" ? `<div class="autocomplete">${token.mode}: <em>${escapeHtml(token.token)}</em><ul>${suggestions}</ul></div>` : ""}
      <textarea data-action="composer-input" placeholder="Message the agent, tag @files, or use /commands\u2026" rows="3">${escapeHtml(draft.text)}</textarea>
      <div class="composer-controls">
        <span class="muted">Submit: <b>${escapeHtml(decision)}</b> \xB7 Input mode: <b>${escapeHtml(inputMode)}</b></span>
        <button data-action="composer-submit" ${decision === "noop" ? "disabled" : ""}>Send</button>
      </div>
    </div>
  `;
}
function tokenColorVar(type) {
  const known = /* @__PURE__ */ new Set(["keyword", "string", "number", "boolean", "comment", "function", "variable", "type", "class", "constant", "operator", "punctuation"]);
  if (known.has(type)) return `var(--syntax-${type}, inherit)`;
  return "inherit";
}
function toolIconName(icon) {
  return { terminal: "terminal", eye: "file", pencil: "file", search: "search", bot: "bot", brain: "bot", mic: "mic", wrench: "wrench" }[icon] ?? icon;
}
function bindActions() {
  root.querySelectorAll("[data-action]").forEach((el) => {
    el.addEventListener("click", (event) => {
      const action = event.currentTarget.dataset.action;
      if (action) handleAction(action, event.currentTarget);
    });
    if (el instanceof HTMLSelectElement) {
      el.addEventListener("change", () => handleAction(el.dataset.action ?? "", el));
    }
  });
  root.querySelectorAll("[data-open-target]").forEach((el) => el.addEventListener("click", () => openTarget(JSON.parse(decodeURIComponent(el.dataset.openTarget ?? "{}")))));
  root.querySelectorAll("[data-pin]").forEach((el) => el.addEventListener("click", () => togglePin(JSON.parse(decodeURIComponent(el.dataset.pin ?? "{}")))));
  root.querySelectorAll("[data-focus-tab]").forEach((el) => el.addEventListener("click", (event) => {
    if (event.target.matches("[data-close-tab]")) return;
    focusTab(el.dataset.focusTab ?? "");
  }));
  root.querySelectorAll("[data-close-tab]").forEach((el) => el.addEventListener("click", (event) => {
    event.stopPropagation();
    closeTab(el.dataset.closeTab ?? "");
  }));
  root.querySelectorAll("[data-focus-pane]").forEach((el) => el.addEventListener("click", () => {
    state.layout = { ...state.layout, focusedPaneId: el.dataset.focusPane ?? state.layout.focusedPaneId };
    saveAndRender("Focused pane.");
  }));
  root.querySelectorAll("[data-seed-pane]").forEach((el) => el.addEventListener("click", () => {
    const paneId = el.dataset.seedPane ?? state.layout.focusedPaneId;
    const target = { kind: "draft", draftId: `draft-${state.nextDraft++}`, setup: { provider: "default", cwd: WORKSPACE_DIR } };
    const tab = createWorkspaceTab(target);
    state.tabs = [...state.tabs, tab];
    state.layout = openTabInFocusedPane({ ...state.layout, focusedPaneId: paneId }, tab);
    saveAndRender("Seeded draft in empty pane.");
  }));
  root.querySelectorAll("[data-toggle-tool]").forEach((el) => el.addEventListener("click", () => {
    const rowId = el.dataset.toggleTool ?? "";
    const next = new Set(state.timeline.expandedToolIds);
    if (next.has(rowId)) next.delete(rowId);
    else next.add(rowId);
    state.timeline = { ...state.timeline, expandedToolIds: next };
    saveAndRender(`Toggled tool card ${rowId}`);
  }));
  root.querySelectorAll("[data-rewind-mode]").forEach((el) => el.addEventListener("click", () => {
    const mode = el.dataset.rewindMode;
    const rowId = el.dataset.rowId ?? "";
    state.timeline = { ...state.timeline, rewindState: startRewind(rowId, mode) };
    const actions = postRewindActions({ mode, agentId: "demo", rewoundMessageText: "Implement the workspace shell.", composerEmpty: !state.timeline.draftText });
    state.eventLog.push(`Rewind ${mode}: ${actions.map((a) => a.kind).join(", ")}`);
    if (actions.some((a) => a.kind === "restore-composer")) {
      draftStore.setText(DEMO_DRAFT_KEY, "Implement the workspace shell.");
      state.timeline = { ...state.timeline, draftText: "Implement the workspace shell.", rewindState: REWIND_IDLE };
    } else {
      state.timeline = { ...state.timeline, rewindState: REWIND_IDLE };
    }
    saveAndRender(`Rewound ${mode}`);
  }));
  const composerTextarea = root.querySelector('[data-action="composer-input"]');
  if (composerTextarea) {
    composerTextarea.addEventListener("input", () => {
      draftStore.setText(DEMO_DRAFT_KEY, composerTextarea.value);
      state.timeline = { ...state.timeline, draftText: composerTextarea.value };
    });
  }
}
function handleAction(action, el) {
  if (action === "toggle-sidebar") state.explorerOpen = !state.explorerOpen;
  else if (action === "toggle-focus") state.focusMode = !state.focusMode;
  else if (action === "new-agent") openTarget({ kind: "draft", draftId: `draft-${state.nextDraft++}`, setup: { provider: "default", cwd: WORKSPACE_DIR } });
  else if (action === "new-terminal") openTarget({ kind: "terminal", terminalId: `terminal-${state.nextTerminal++}` });
  else if (action === "new-browser") openTarget({ kind: "browser", browserId: `browser-${state.nextBrowser++}` });
  else if (action === "split-right") splitActive("right");
  else if (action === "split-down") splitActive("bottom");
  else if (action === "promote-draft") promoteDraft(el.dataset.tab ?? activeTabId() ?? "");
  else if (action === "bulk-close") state.eventLog.push(planBulkClose(state.tabs, []).confirmation);
  else if (action === "add-live-row") {
    const seq = (state.timeline.timeline.rows.at(-1)?.seqStart ?? 0) + 1;
    const row = { rowId: `live-${seq}`, kind: "activity_log", seqStart: seq, seqEnd: seq, source: "live", epochId: "e1", timestamp: Date.now(), payload: { activityType: "info", message: `Live row ${seq} added at ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}` } };
    const next = applyLiveRow(state.timeline.timeline, row);
    const scrollResult = onRowsAdded(state.timeline.autoscroll);
    state.timeline = { ...state.timeline, timeline: next, autoscroll: scrollResult };
  } else if (action === "clear-timeline") {
    state.timeline = { ...state.timeline, timeline: EMPTY_TIMELINE };
  } else if (action === "jump-to-bottom") {
    const { shouldScroll: _s, ...autoscroll } = onJumpToBottom(state.timeline.autoscroll);
    state.timeline = { ...state.timeline, autoscroll };
  } else if (action === "composer-input") {
    const text = el.value ?? "";
    draftStore.setText(DEMO_DRAFT_KEY, text);
    state.timeline = { ...state.timeline, draftText: text };
    return;
  } else if (action === "composer-submit") {
    const draft = draftStore.load(DEMO_DRAFT_KEY);
    if (draft.text.trim()) {
      const seq = (state.timeline.timeline.rows.at(-1)?.seqStart ?? 0) + 1;
      const row = { rowId: `user-${seq}`, kind: "user_message", seqStart: seq, seqEnd: seq, source: "live", epochId: "e1", timestamp: Date.now(), payload: { text: draft.text, canRewind: true } };
      state.timeline = { ...state.timeline, timeline: applyLiveRow(state.timeline.timeline, row) };
      draftStore.markSent(DEMO_DRAFT_KEY);
      state.timeline = { ...state.timeline, draftText: "" };
      state.eventLog.push(`Sent: "${draft.text.slice(0, 40)}"`);
    }
  } else if (action === "reset") {
    window.localStorage.removeItem(`${SERVER_ID}:${WORKSPACE_ID}`);
    state = createInitialState();
  } else if (action === "gate-select" && el instanceof HTMLSelectElement) {
    state.gateScenario = el.value;
  } else if (action === "mobile-tab-select" && el instanceof HTMLSelectElement) {
    focusTab(el.value);
    return;
  } else if (action.startsWith("header:")) {
    state.eventLog.push(`Header action: ${action.slice("header:".length)}`);
  }
  saveAndRender(`Action: ${action}`);
}
function openTarget(target) {
  const tab = createWorkspaceTab(target);
  if (!state.tabs.some((item) => item.tabId === tab.tabId)) state.tabs = [...state.tabs, tab];
  state.layout = openTabInFocusedPane(state.layout, tab);
  focusTab(tab.tabId, false);
  saveAndRender(`Opened ${target.kind} tab ${tab.tabId}.`);
}
function focusTab(tabId, rerender = true) {
  const pane = listPanes(state.layout.root).find((candidate) => candidate.tabIds.includes(tabId));
  if (!pane) return;
  state.layout = { ...state.layout, focusedPaneId: pane.id, root: focusTabInNode(state.layout.root, pane.id, tabId) };
  state.mountedLru = nextMountedTabLru(state.mountedLru, tabId);
  if (rerender) saveAndRender(`Focused ${tabId}.`);
}
function closeTab(tabId) {
  state.tabs = state.tabs.filter((tab) => tab.tabId !== tabId);
  state.layout = closeTabInLayout(state.layout, tabId);
  const active = activeTabId();
  if (active) state.mountedLru = nextMountedTabLru(state.mountedLru, active);
  saveAndRender(`Closed ${tabId}.`);
}
function splitActive(side) {
  const pane = findPane(state.layout.root, state.layout.focusedPaneId) ?? listPanes(state.layout.root)[0];
  const tabId = pane ? activeTabForPane(pane) : void 0;
  if (!pane || !tabId) {
    const result2 = splitEmptyToSide(state.layout, state.layout.focusedPaneId, side, `pane-${Date.now()}`, `draft-${state.nextDraft++}`);
    state.tabs = [...state.tabs, result2.tab];
    state.layout = result2.layout;
    saveAndRender(`Split empty pane ${side}.`);
    return;
  }
  const result = splitTabToSide(state.layout, pane.id, tabId, side, `pane-${Date.now()}`);
  state.layout = result.layout;
  saveAndRender(result.split ? `Split ${tabId} ${side}.` : `Split depth cap reached.`);
}
function promoteDraft(tabId) {
  const index = state.tabs.findIndex((tab2) => tab2.tabId === tabId);
  if (index < 0) return;
  const agentId = `agent-${state.nextAgent++}`;
  const tab = createWorkspaceTab({ kind: "agent", agentId });
  state.tabs = state.tabs.map((item) => item.tabId === tabId ? tab : item);
  state.layout = replaceTabIdInLayout(state.layout, tabId, tab.tabId);
  saveAndRender(`Retargeted draft ${tabId} to agent ${agentId}.`);
}
function togglePin(target) {
  const next = { version: 1, targets: togglePinnedTarget(pinnedStore.load().targets, target) };
  pinnedStore.save(next);
  saveAndRender(`Toggled pin ${target.kind}.`);
}
function gateState() {
  const base = { routeServerId: SERVER_ID, activeServerId: SERVER_ID, workspaceId: WORKSPACE_ID, knownWorkspaceIds: [WORKSPACE_ID], workspaceDirExists: true };
  switch (state.gateScenario) {
    case "ready":
      return resolveWorkspaceRouteGate({ ...base, hostOnline: true, workspacesHydrated: true, tabsHydrated: true });
    case "splash":
      return resolveWorkspaceRouteGate({ ...base, hostOnline: true, workspacesHydrated: true, tabsHydrated: false });
    case "foreign":
      return resolveWorkspaceRouteGate({ ...base, routeServerId: "other-host", hostOnline: true, workspacesHydrated: true, tabsHydrated: true });
    case "missing":
      return resolveWorkspaceRouteGate({ ...base, workspaceId: "missing", knownWorkspaceIds: [], hostOnline: true, workspacesHydrated: true, tabsHydrated: true });
    case "offline":
      return resolveWorkspaceRouteGate({ ...base, hostOnline: false, workspacesHydrated: false, tabsHydrated: false });
  }
}
function activeTabId() {
  const pane = findPane(state.layout.root, state.layout.focusedPaneId) ?? listPanes(state.layout.root)[0];
  return pane ? activeTabForPane(pane) : void 0;
}
function tabById(tabId) {
  return state.tabs.find((tab) => tab.tabId === tabId);
}
function nextIds() {
  return { nextDraftId: `draft-${state.nextDraft}`, nextTerminalId: `terminal-${state.nextTerminal}`, nextBrowserId: `browser-${state.nextBrowser}`, profileCwd: WORKSPACE_DIR };
}
function saveAndRender(message) {
  if (message) state.eventLog.push(message);
  layoutStore.save(SERVER_ID, WORKSPACE_ID, state.layout);
  render();
}
function focusTabInNode(node, paneId, tabId) {
  if (node.kind === "pane") return node.id === paneId ? { ...node, focusedTabId: tabId } : node;
  return { ...node, children: node.children.map((child) => focusTabInNode(child, paneId, tabId)) };
}
function replaceTabIdInLayout(layout, oldId, newId) {
  return { ...layout, root: replaceTabIdInNode(layout.root, oldId, newId) };
}
function replaceTabIdInNode(node, oldId, newId) {
  if (node.kind === "pane") {
    return {
      ...node,
      tabIds: node.tabIds.map((id) => id === oldId ? newId : id),
      focusedTabId: node.focusedTabId === oldId ? newId : node.focusedTabId
    };
  }
  return { ...node, children: node.children.map((child) => replaceTabIdInNode(child, oldId, newId)) };
}
function iconForAction(id) {
  if (id.includes("script")) return "\u25B6";
  if (id.includes("editor")) return "\u2318";
  if (id.includes("git")) return "\u2442";
  return "\u2022";
}
function visualIcon(name) {
  switch (name) {
    case "sparkles":
      return "\u2726";
    case "bot":
      return "\u{1F916}";
    case "terminal":
      return "\u2301";
    case "globe":
      return "\u25CE";
    case "file":
      return "\u25F0";
    case "wrench":
      return "\u2699";
    default:
      return name.length <= 2 ? name : "\u2022";
  }
}
function escapeHtml(value) {
  return value.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] ?? ch);
}
function injectStyles() {
  const style = document.createElement("style");
  style.textContent = `
    * { box-sizing: border-box; }
    html, body, #root { margin: 0; min-height: 100%; }
    body { background: var(--surface0); color: var(--fg); font: 13px/1.4 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    button, select, textarea { font: inherit; }
    button, select { color: var(--fg); background: var(--surface2); border: 1px solid var(--border); border-radius: 9px; padding: 7px 10px; cursor: pointer; }
    button:hover { background: var(--surface3); }
    button:disabled { opacity: .45; cursor: not-allowed; }
    textarea { width: 100%; min-height: 150px; resize: vertical; color: var(--fg); background: var(--surface0); border: 1px solid var(--border); border-radius: 14px; padding: 14px; }
    .app-shell { min-height: 100vh; display: flex; flex-direction: column; }
    .topbar { height: 58px; display: flex; align-items: center; gap: 12px; padding: 8px 14px; border-bottom: 1px solid var(--border); background: color-mix(in srgb, var(--surface1) 94%, transparent); position: sticky; top: 0; z-index: 5; backdrop-filter: blur(18px); }
    .title-block { display: flex; flex-direction: column; min-width: 0; }
    .title-block strong { font-size: 15px; }
    .title-block span, small, .muted, .path, dd { color: var(--muted); }
    .header-actions { margin-left: auto; display: flex; gap: 8px; align-items: center; }
    .header-actions b { margin-left: 5px; padding: 1px 5px; border-radius: 999px; background: var(--accent); color: white; font-size: 10px; }
    .workspace-shell { flex: 1; display: grid; grid-template-columns: 260px 1fr 300px; min-height: 0; }
    .sidebar, .inspect { background: var(--sidebar); border-right: 1px solid var(--border); padding: 16px; overflow: auto; }
    .inspect { border-right: 0; border-left: 1px solid var(--border); }
    .sidebar.hidden { display: none; }
    .workspace-main { min-width: 0; display: flex; flex-direction: column; background: var(--surface0); }
    .panel-title { font-weight: 700; margin: 0 0 8px; color: var(--accentBright); }
    .section-label { margin: 18px 0 8px; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
    .quick-actions, .pin-list, .desktop-strip, .mobile-switcher { display: flex; flex-wrap: wrap; gap: 8px; }
    .pin.active { border-color: var(--accent); color: var(--accentBright); }
    .gate { padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--surface1); }
    .gate span { margin-left: 8px; color: var(--muted); }
    .gate.ready { border-left: 4px solid var(--success); }
    .gate.splash, .gate.reconnecting, .gate.unreachable { border-left: 4px solid #d69e2e; }
    .gate.foreign, .gate.missing { border-left: 4px solid var(--danger); }
    .desktop-strip, .mobile-switcher { padding: 10px; border-bottom: 1px solid var(--border); background: var(--surface1); overflow-x: auto; flex-wrap: nowrap; }
    .desktop-strip.scroll { overflow-x: scroll; }
    .tab { display: inline-flex; align-items: center; gap: 7px; min-width: 44px; max-width: 200px; white-space: nowrap; overflow: hidden; position: relative; }
    .glyph { width: 18px; height: 18px; display: inline-grid; place-items: center; flex: 0 0 auto; color: var(--accentBright); }
    .tab.active { border-color: var(--accent); background: var(--surface3); }
    .tab span:nth-child(2) { overflow: hidden; text-overflow: ellipsis; }
    .tab small { margin-left: auto; font-size: 10px; }
    .tab i { font-style: normal; opacity: .7; padding-left: 4px; }
    .pane-area { flex: 1; min-height: 0; padding: 12px; }
    .split { display: flex; gap: 12px; width: 100%; height: 100%; min-height: 360px; }
    .split.column { flex-direction: column; }
    .split-child { min-width: 0; min-height: 180px; display: flex; }
    .pane, .single-mobile-pane { flex: 1; min-width: 0; min-height: 260px; border: 1px solid var(--border); border-radius: 18px; background: var(--surface1); overflow: hidden; display: flex; flex-direction: column; }
    .pane.focused { box-shadow: 0 0 0 1px var(--accent), 0 16px 42px rgba(0,0,0,.22); }
    .pane-head { display: flex; justify-content: space-between; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border); color: var(--muted); font-size: 12px; }
    .tab-panel { flex: 1; padding: 18px; overflow: auto; }
    .panel-heading { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
    .panel-heading .avatar { width: 38px; height: 38px; border-radius: 12px; display: grid; place-items: center; background: var(--surface3); }
    .panel-heading div { display: flex; flex-direction: column; }
    .pill { margin-left: auto; border: 1px solid var(--border); border-radius: 999px; padding: 3px 8px; color: var(--muted); }
    .composer, .timeline, .browser-mock, .setup-panel, .empty { display: grid; gap: 12px; }
    .bubble { border-left: 3px solid var(--accent); padding: 10px 12px; background: var(--surface2); border-radius: 10px; }
    .terminal, .file-preview { background: #080b0a; border: 1px solid var(--border); border-radius: 12px; padding: 16px; color: #a7f3d0; min-height: 180px; overflow: auto; }
    .browser-mock { min-height: 180px; border: 1px solid var(--border); border-radius: 14px; padding: 16px; background: linear-gradient(135deg, var(--surface2), var(--surface3)); }
    .empty { place-items: center; min-height: 220px; color: var(--muted); text-align: center; }
    dl { display: grid; grid-template-columns: 95px 1fr; gap: 8px; }
    dt { color: var(--muted); }
    dd { margin: 0; word-break: break-word; }
    .log { margin: 0; padding-left: 18px; color: var(--muted); }
    .mobile .workspace-shell { grid-template-columns: 1fr; }
    .mobile .sidebar, .mobile .inspect { display: none; }
    .mobile .topbar { height: auto; flex-wrap: wrap; }
    .mobile .header-actions { width: 100%; margin-left: 0; overflow-x: auto; }
    .mobile-switcher select { min-width: 180px; }
    .timeline-panel { display: flex; flex-direction: column; height: 100%; }
    .timeline-rows { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 0; }
    .row-wrapper { width: 100%; }
    .bubble { max-width: 820px; margin: 4px auto; padding: 12px 16px; border-radius: 14px; }
    .bubble.user { background: var(--surface3); align-self: flex-end; margin-left: auto; }
    .bubble.assistant { background: var(--surface1); }
    .bubble code, .bubble pre { background: var(--surface0); border-radius: 8px; padding: 2px 6px; font-family: monospace; }
    .code-block { background: var(--surface0); border: 1px solid var(--border); border-radius: 10px; padding: 12px; overflow-x: auto; white-space: pre; font-size: 12px; }
    .tool-card { background: var(--surface1); border: 1px solid var(--border); border-radius: 12px; padding: 10px 14px; display: flex; align-items: center; gap: 10px; cursor: pointer; }
    .tool-card:hover { background: var(--surface2); }
    .tool-card.alert .tool-name { color: var(--danger); }
    .tool-card .tool-summary { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
    .tool-card .tool-status { font-size: 11px; padding: 2px 7px; border-radius: 99px; border: 1px solid var(--border); }
    .tool-details { grid-column: 1/-1; margin-top: 8px; }
    .tool-card.shimmer .tool-name { background: linear-gradient(90deg, var(--surface2), var(--surface4), var(--surface2)); background-size: 200% 100%; animation: shimmer 1.4s infinite; border-radius: 6px; color: transparent; }
    @keyframes shimmer { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }
    .activity-pill { border-radius: 99px; padding: 4px 12px; font-size: 12px; display: inline-flex; align-items: center; margin: 2px auto; }
    .activity-pill.success { background: color-mix(in srgb, var(--success) 15%, transparent); color: var(--success); }
    .activity-pill.error { background: color-mix(in srgb, var(--danger) 15%, transparent); color: var(--danger); }
    .activity-pill.info { background: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accentBright); }
    .rewind-menu { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
    .rewind-menu button { font-size: 11px; padding: 3px 8px; }
    .diff-stat { font-family: monospace; font-size: 12px; color: var(--muted); }
    .jump-btn { text-align: center; padding: 8px; }
    .streaming { color: var(--accent); font-size: 11px; margin-left: 8px; }
    .composer-area { border-top: 1px solid var(--border); padding: 12px; }
    .composer-surface { display: flex; flex-direction: column; gap: 8px; }
    .composer-surface textarea { min-height: 70px; }
    .composer-controls { display: flex; align-items: center; justify-content: space-between; }
    .autocomplete { background: var(--surface2); border: 1px solid var(--border); border-radius: 10px; padding: 8px 12px; font-size: 12px; }
    .autocomplete ul { list-style: none; margin: 4px 0 0; padding: 0; }
    .autocomplete li { padding: 3px 0; }
    .syntax-keyword, [style*="--syntax-keyword"] { color: #c792ea; }
    :root { --syntax-keyword: #c792ea; --syntax-string: #a3e87e; --syntax-number: #f78c6c; --syntax-comment: #546e7a; --syntax-function: #82aaff; --syntax-type: #ffcb6b; }
    @media (max-width: 980px) { .workspace-shell { grid-template-columns: 220px 1fr; } .inspect { display: none; } }
    @media (max-width: 680px) { .workspace-shell { grid-template-columns: 1fr; } .sidebar { display: none; } .pane-area { padding: 8px; } }
  `;
  document.head.appendChild(style);
}
