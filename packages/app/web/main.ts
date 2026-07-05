import {
  activeTabForPane,
  buildMobileSwitcher,
  closeTabInLayout,
  compactVisibleTabs,
  composeWorkspaceScreen,
  createWorkspaceTab,
  defaultWorkspaceLayout,
  descriptorForTab,
  distributeTabWidths,
  findPane,
  listPanes,
  mountedTabState,
  nextMountedTabLru,
  openTabInFocusedPane,
  PinnedTargetsStore,
  planBulkClose,
  quickLaunchButtons,
  resolveWorkspaceEntry,
  resolveWorkspaceRouteGate,
  splitEmptyToSide,
  splitTabToSide,
  supportsPaneSplits,
  tabContextMenu,
  tabTooltip,
  togglePinnedTarget,
  workspaceHeaderModel,
  WorkspaceLayoutStore,
  type PinnedTabTarget,
  type SplitNode,
  type SplitPane,
  type WorkspaceLayout,
  type WorkspaceTab,
  type WorkspaceTabTarget,
} from "../src/workspace/index.js";
import { getTheme } from "../src/theme/index.js";
import {
  EMPTY_TIMELINE,
  applyLiveRow,
  mergePageRows,
  buildRenderItems,
  dispatchRow,
  resolveRowGap,
  onRowsAdded,
  onScroll,
  onJumpToBottom,
  INITIAL_AUTOSCROLL_STATE,
  buildUserMessageModel,
  buildAssistantMessageModel,
  buildCompactionModel,
  segmentIntoTurns,
  buildTurnFooter,
  formatTurnFooterLabel,
  buildToolCardPresentation,
  resolveStatusVisual,
  buildExpandedDetail,
  parseDiff,
  diffStatLabel,
  buildPermissionPrompt,
  parseMarkdownBlocks,
  highlightCode,
  rewindMenuItems,
  postRewindActions,
  REWIND_IDLE,
  startRewind,
  type TimelineState,
  type TimelineRow,
} from "../src/timeline/index.js";
import {
  DraftStore,
  CreateAgentPrefsStore,
  resolveSubmitDecision,
  detectActiveToken,
  CLIENT_SLASH_COMMANDS,
  INITIAL_DICTATION_STATE,
  INITIAL_VOICE_STATE,
  activeInputMode,
} from "../src/composer/index.js";

type FormFactor = "mobile" | "narrow" | "wide";
type GateScenario = "ready" | "splash" | "foreign" | "missing" | "offline";

type TimelinePreviewState = {
  timeline: TimelineState;
  autoscroll: typeof INITIAL_AUTOSCROLL_STATE;
  expandedToolIds: Set<string>;
  rewindState: typeof REWIND_IDLE;
  draftText: string;
};

type PreviewState = {
  tabs: WorkspaceTab[];
  layout: WorkspaceLayout;
  mountedLru: string[];
  formFactor: FormFactor;
  focusMode: boolean;
  explorerOpen: boolean;
  gateScenario: GateScenario;
  eventLog: string[];
  nextDraft: number;
  nextTerminal: number;
  nextBrowser: number;
  nextAgent: number;
  timeline: TimelinePreviewState;
};

const SERVER_ID = "local-preview";
const WORKSPACE_ID = "pi-studio";
const WORKSPACE_DIR = "/home/avatsaev/DEV/avatsaev/pi-studio";
const layoutStore = new WorkspaceLayoutStore(window.localStorage);
const pinnedStore = new PinnedTargetsStore(window.localStorage);
const draftStore = new DraftStore(window.localStorage);
const prefsStore = new CreateAgentPrefsStore(window.localStorage);
const DEMO_DRAFT_KEY = `${SERVER_ID}:demo-draft`;

let state = createInitialState();
const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("#root missing");
const root: HTMLElement = rootElement;

injectStyles();
render();

function createInitialState(): PreviewState {
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
      tabs: [],
    },
    openIntent: null,
    nextDraftId: "draft-1",
    now: Date.now(),
  });
  const tabs = seeded.action === "seed-draft" ? [seeded.tab] : [createWorkspaceTab({ kind: "draft", draftId: "draft-1", setup: { provider: "default", cwd: WORKSPACE_DIR } })];
  const persisted = layoutStore.load(SERVER_ID, WORKSPACE_ID);
  const layout = listPanes(persisted.root).some((pane) => pane.tabIds.length > 0) ? persisted : defaultWorkspaceLayout(tabs.map((tab) => tab.tabId));
  const activeId = activeTabForPane(findPane(layout.root, layout.focusedPaneId) ?? listPanes(layout.root)[0]!);
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
    timeline: createTimelinePreview(),
  };
}

function render(): void {
  const theme = getTheme("dark");
  const panes = listPanes(state.layout.root);
  const composition = composeWorkspaceScreen({
    focusMode: state.focusMode,
    formFactor: state.formFactor,
    platform: "web",
    explorerOpen: state.explorerOpen,
    workspaceDirPresent: true,
    panes,
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
    isElectron: false,
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

function renderHeader(header: ReturnType<typeof workspaceHeaderModel>): string {
  return `
    <header class="topbar">
      <button data-action="toggle-sidebar" title="Toggle explorer">☰</button>
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

function renderSidebar(pinned: readonly PinnedTabTarget[]): string {
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

function renderPinToggle(target: PinnedTabTarget, pinned: readonly PinnedTabTarget[]): string {
  const active = pinned.some((item) => JSON.stringify(item) === JSON.stringify(target));
  const label = target.kind === "profile" ? `profile:${target.profileId}` : target.kind;
  return `<button class="pin ${active ? "active" : ""}" data-pin="${encodeURIComponent(JSON.stringify(target))}">${active ? "Unpin" : "Pin"} ${escapeHtml(label)}</button>`;
}

function renderGateBanner(gate: ReturnType<typeof resolveWorkspaceRouteGate>): string {
  const detail = gate.state === "foreign" ? `redirect → ${gate.redirect}` : "actions" in gate ? gate.actions.join(", ") : "";
  return `<div class="gate ${gate.state}"><strong>Route gate:</strong> ${escapeHtml(gate.state)} ${detail ? `<span>${escapeHtml(detail)}</span>` : ""}</div>`;
}

function renderDesktopTabStrip(panes: readonly SplitPane[]): string {
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

function renderTabButton(tab: WorkspaceTab | undefined, tabId: string, width: number): string {
  if (!tab) return "";
  const descriptor = descriptorForTab(tab);
  const active = tabId === activeTabId();
  const menu = tabContextMenu({ tab, tabs: state.tabs, index: state.tabs.findIndex((item) => item.tabId === tabId), formFactor: "desktop" });
  return `
    <button class="tab ${active ? "active" : ""}" style="width:${width}px" title="${escapeHtml(tabTooltip(tab, descriptor.label))}" data-focus-tab="${escapeHtml(tabId)}">
      <span class="glyph">${escapeHtml(visualIcon(descriptor.icon))}</span><span>${escapeHtml(descriptor.label)}</span>
      <small>${menu.filter((item) => !item.disabled).length}</small>
      <i data-close-tab="${escapeHtml(tabId)}">×</i>
    </button>
  `;
}

function renderMobileSwitcher(pinned: readonly PinnedTabTarget[]): string {
  const model = buildMobileSwitcher({ tabs: state.tabs, activeTabId: activeTabId(), pinnedTargets: pinned, ...nextIds() });
  return `
    <div class="mobile-switcher">
      <select data-action="mobile-tab-select">
        ${model.entries.map((entry) => `<option value="${escapeHtml(entry.tabId)}" ${entry.active ? "selected" : ""}>${escapeHtml(visualIcon(entry.icon))} ${escapeHtml(entry.label)} · ${escapeHtml(entry.statusBucket ?? "idle")}</option>`).join("")}
      </select>
      ${model.newTabActions.map((button) => `<button data-open-target="${encodeURIComponent(JSON.stringify(button.tabTarget))}">+ ${escapeHtml(button.label)}</button>`).join("")}
    </div>
  `;
}

function renderMobilePane(): string {
  const visible = compactVisibleTabs(state.tabs, activeTabId());
  const tab = visible[0];
  return tab ? `<div class="single-mobile-pane">${renderTabContent(tab)}</div>` : `<div class="empty">No tab</div>`;
}

function renderSplitNode(node: SplitNode): string {
  if (node.kind === "pane") return renderPane(node);
  return `<div class="split ${node.direction}" style="--children:${node.children.length}">${node.children.map((child, index) => `<div class="split-child" style="flex:${node.sizes[index] ?? 1}">${renderSplitNode(child)}</div>`).join("")}</div>`;
}

function renderPane(pane: SplitPane): string {
  const activeId = activeTabForPane(pane);
  const tab = activeId ? tabById(activeId) : undefined;
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

function renderEmptyPane(paneId: string): string {
  return `<div class="empty"><strong>Empty pane</strong><p>Seed a draft composer in this pane.</p><button data-seed-pane="${escapeHtml(paneId)}">Seed draft</button></div>`;
}

function renderTabContent(tab: WorkspaceTab): string {
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

function panelBody(tab: WorkspaceTab): string {
  switch (tab.target.kind) {
    case "draft":
      return `<div class="composer">${renderComposer()}<div><button data-action="promote-draft" data-tab="${escapeHtml(tab.tabId)}">Create demo agent from draft</button></div></div>`;
    case "agent":
      return renderTimelinePanel();
    case "terminal":
      return `<pre class="terminal">$ npm run dev\nterminal ${escapeHtml(tab.target.terminalId)}\nPTY rendering arrives in later panel sprint.</pre>`;
    case "browser":
      return `<div class="browser-mock"><div>https://localhost:${8080 + state.nextBrowser}/</div><p>Browser panel placeholder from workspace tab registry.</p></div>`;
    case "file":
      return `<pre class="file-preview">// ${escapeHtml(tab.target.path)}\nexport const preview = true;</pre>`;
    case "setup":
      return `<div class="setup-panel">Workspace setup for ${escapeHtml(tab.target.workspaceId)}</div>`;
  }
}

function renderInspector(tabStripMode: string, gateState: string): string {
  const closePlan = planBulkClose(state.tabs, state.tabs.filter((tab) => tab.target.kind === "agent").map((tab) => ({ agentId: tab.target.kind === "agent" ? tab.target.agentId : "" })));
  return `
    <div class="panel-title">Current implementation state</div>
    <dl>
      <dt>Tabs</dt><dd>${state.tabs.length}</dd>
      <dt>Panes</dt><dd>${listPanes(state.layout.root).length}</dd>
      <dt>Tab strip</dt><dd>${escapeHtml(tabStripMode)}</dd>
      <dt>Route gate</dt><dd>${escapeHtml(gateState)}</dd>
      <dt>Mounted LRU</dt><dd>${escapeHtml(state.mountedLru.join(" → ") || "none")}</dd>
    </dl>
    <button data-action="bulk-close">Plan bulk close</button>
    <button data-action="reset">Reset preview state</button>
    <div class="section-label">Bulk close wording</div>
    <p class="muted">${escapeHtml(closePlan.confirmation)}</p>
    <div class="section-label">Event log</div>
    <ol class="log">${state.eventLog.slice(-8).reverse().map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ol>
  `;
}

function createTimelinePreview(): TimelinePreviewState {
  const now = Date.now();
  const rows: TimelineRow[] = [
    { rowId: "r1", kind: "user_message", seqStart: 1, seqEnd: 1, source: "page", epochId: "e1", timestamp: now - 30000, payload: { text: "Implement the workspace shell.", canRewind: true } },
    { rowId: "r2", kind: "tool_call", seqStart: 2, seqEnd: 2, source: "page", epochId: "e1", timestamp: now - 29000, payload: { callId: "c1", name: "read_file", status: "completed", detail: { type: "read", filePath: "packages/app/src/workspace/tabs.ts", content: "export type WorkspaceTab = ..." } } },
    { rowId: "r3", kind: "tool_call", seqStart: 3, seqEnd: 3, source: "page", epochId: "e1", timestamp: now - 28000, payload: { callId: "c2", name: "bash", status: "completed", detail: { type: "shell", command: "npm run build", output: "Build succeeded" } } },
    { rowId: "r4", kind: "assistant_message", seqStart: 4, seqEnd: 4, source: "page", epochId: "e1", timestamp: now - 5000, payload: { text: "I've implemented the workspace shell with **tabs**, pane splits, and seeding. Here's a summary:\n\n```typescript\nexport type WorkspaceTab = {\n  tabId: string;\n  target: WorkspaceTabTarget;\n};\n```", blockGroupId: "bg1", blockIndex: 0 } },
    { rowId: "r5", kind: "activity_log", seqStart: 5, seqEnd: 5, source: "live", epochId: "e1", timestamp: now - 1000, payload: { activityType: "success", message: "Build passed — 929 tests" } },
  ];
  let timeline = EMPTY_TIMELINE;
  for (const row of rows) timeline = applyLiveRow(timeline, row);
  return { timeline, autoscroll: INITIAL_AUTOSCROLL_STATE, expandedToolIds: new Set(), rewindState: REWIND_IDLE, draftText: draftStore.load(DEMO_DRAFT_KEY).text };
}

function renderTimelinePanel(): string {
  const tl = state.timeline;
  const items = buildRenderItems(tl.timeline.rows);
  const turns = segmentIntoTurns(tl.timeline.rows);
  return `
    <div class="timeline-panel">
      <div class="panel-heading">
        <span class="avatar">${escapeHtml(visualIcon("bot"))}</span>
        <div><strong>Agent Timeline</strong><small>${items.length} rows · sprint-015</small></div>
        <button data-action="add-live-row">+ Live row</button>
        <button data-action="clear-timeline">Clear</button>
      </div>
      <div class="timeline-rows">
        ${items.map((item) => renderTimelineRow(item.row, tl)).join("")}
        ${tl.autoscroll.showJumpButton ? `<div class="jump-btn"><button data-action="jump-to-bottom">↓ Jump to latest</button></div>` : ""}
      </div>
      <div class="composer-area">
        ${renderComposer()}
      </div>
    </div>
  `;
}

function renderTimelineRow(row: TimelineRow, tl: TimelinePreviewState): string {
  const renderer = dispatchRow(row.kind);
  const payload = row.payload as Record<string, unknown>;
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
        const lines = highlightCode((block as { code: string }).code, (block as { language: string }).language);
        return `<pre class="code-block"><code>${lines.map((l) => l.spans.map((s) => `<span style="color:${escapeHtml(tokenColorVar(s.type))}">${escapeHtml(s.value)}</span>`).join("")).join("\n")}</code></pre>`;
      }
      if (block.kind === "heading") return `<h${(block as {level:number}).level}>${escapeHtml((block as {text:string}).text)}</h${(block as {level:number}).level}>`;
      if (block.kind === "bullet_list") return `<ul>${(block as {items:string[]}).items.map((i)=>`<li>${escapeHtml(i)}</li>`).join("")}</ul>`;
      return `<p>${escapeHtml((block as {text?: string}).text ?? "")}</p>`;
    }).join("");
    body = `<div class="bubble assistant">${mdHtml}${streamingFenceOpen ? `<span class="streaming">● streaming</span>` : ""}</div>`;
  } else if (row.kind === "tool_call") {
    const card = buildToolCardPresentation(payload as Parameters<typeof buildToolCardPresentation>[0]);
    const visual = resolveStatusVisual(card.status);
    const expanded = tl.expandedToolIds.has(row.rowId);
    const details = expanded ? buildExpandedDetail(payload as Parameters<typeof buildExpandedDetail>[0]).map(renderDetailSection).join("") : "";
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
  const gap = resolveRowGap(row.kind, undefined);
  return `<div class="row-wrapper" style="margin-bottom:${gap}px">${body}</div>`;
}

function renderDetailSection(section: ReturnType<typeof buildExpandedDetail>[number]): string {
  if (section.kind === "code") return `<pre class="terminal">${escapeHtml((section as {content:string}).content)}</pre>`;
  if (section.kind === "text") return `<p>${escapeHtml((section as {content:string}).content)}</p>`;
  if (section.kind === "error") return `<p class="error">${escapeHtml((section as {errorText:string}).errorText)}</p>`;
  if (section.kind === "diff") {
    const parsed = parseDiff((section as {diff:string}).diff, (section as {filePath:string}).filePath);
    return `<div class="diff-stat">${escapeHtml(diffStatLabel(parsed.stat))}</div>`;
  }
  return `<p class="muted">[${escapeHtml(section.kind)}]</p>`;
}

function renderComposer(): string {
  const draft = draftStore.load(DEMO_DRAFT_KEY);
  const token = detectActiveToken(draft.text, draft.text.length);
  const decision = resolveSubmitDecision({ text: draft.text, attachments: draft.attachments, agentRunning: false, forceSubmit: false, canSubmit: true });
  const inputMode = activeInputMode(INITIAL_DICTATION_STATE, INITIAL_VOICE_STATE);
  const suggestions = token.mode === "command" ? CLIENT_SLASH_COMMANDS.map((cmd) => `<li><b>/${escapeHtml(cmd.name)}</b> — ${escapeHtml(cmd.description)}</li>`).join("") : "";
  return `
    <div class="composer-surface">
      ${token.mode !== "none" ? `<div class="autocomplete">${token.mode}: <em>${escapeHtml(token.token)}</em><ul>${suggestions}</ul></div>` : ""}
      <textarea data-action="composer-input" placeholder="Message the agent, tag @files, or use /commands…" rows="3">${escapeHtml(draft.text)}</textarea>
      <div class="composer-controls">
        <span class="muted">Submit: <b>${escapeHtml(decision)}</b> · Input mode: <b>${escapeHtml(inputMode)}</b></span>
        <button data-action="composer-submit" ${decision === "noop" ? "disabled" : ""}>Send</button>
      </div>
    </div>
  `;
}

function tokenColorVar(type: string): string {
  const known = new Set(["keyword","string","number","boolean","comment","function","variable","type","class","constant","operator","punctuation"]);
  if (known.has(type)) return `var(--syntax-${type}, inherit)`;
  return "inherit";
}

function toolIconName(icon: string): string {
  return { terminal: "terminal", eye: "file", pencil: "file", search: "search", bot: "bot", brain: "bot", mic: "mic", wrench: "wrench" }[icon] ?? icon;
}

function bindActions(): void {
  root.querySelectorAll<HTMLElement>("[data-action]").forEach((el) => {
    el.addEventListener("click", (event) => {
      const action = (event.currentTarget as HTMLElement).dataset.action;
      if (action) handleAction(action, event.currentTarget as HTMLElement);
    });
    if (el instanceof HTMLSelectElement) {
      el.addEventListener("change", () => handleAction(el.dataset.action ?? "", el));
    }
  });
  root.querySelectorAll<HTMLElement>("[data-open-target]").forEach((el) => el.addEventListener("click", () => openTarget(JSON.parse(decodeURIComponent(el.dataset.openTarget ?? "{}")) as WorkspaceTabTarget)));
  root.querySelectorAll<HTMLElement>("[data-pin]").forEach((el) => el.addEventListener("click", () => togglePin(JSON.parse(decodeURIComponent(el.dataset.pin ?? "{}")) as PinnedTabTarget)));
  root.querySelectorAll<HTMLElement>("[data-focus-tab]").forEach((el) => el.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).matches("[data-close-tab]")) return;
    focusTab(el.dataset.focusTab ?? "");
  }));
  root.querySelectorAll<HTMLElement>("[data-close-tab]").forEach((el) => el.addEventListener("click", (event) => {
    event.stopPropagation();
    closeTab(el.dataset.closeTab ?? "");
  }));
  root.querySelectorAll<HTMLElement>("[data-focus-pane]").forEach((el) => el.addEventListener("click", () => {
    state.layout = { ...state.layout, focusedPaneId: el.dataset.focusPane ?? state.layout.focusedPaneId };
    saveAndRender("Focused pane.");
  }));
  root.querySelectorAll<HTMLElement>("[data-seed-pane]").forEach((el) => el.addEventListener("click", () => {
    const paneId = el.dataset.seedPane ?? state.layout.focusedPaneId;
    const target: WorkspaceTabTarget = { kind: "draft", draftId: `draft-${state.nextDraft++}`, setup: { provider: "default", cwd: WORKSPACE_DIR } };
    const tab = createWorkspaceTab(target);
    state.tabs = [...state.tabs, tab];
    state.layout = openTabInFocusedPane({ ...state.layout, focusedPaneId: paneId }, tab);
    saveAndRender("Seeded draft in empty pane.");
  }));
  root.querySelectorAll<HTMLElement>("[data-toggle-tool]").forEach((el) => el.addEventListener("click", () => {
    const rowId = el.dataset.toggleTool ?? "";
    const next = new Set(state.timeline.expandedToolIds);
    if (next.has(rowId)) next.delete(rowId); else next.add(rowId);
    state.timeline = { ...state.timeline, expandedToolIds: next };
    saveAndRender(`Toggled tool card ${rowId}`);
  }));
  root.querySelectorAll<HTMLElement>("[data-rewind-mode]").forEach((el) => el.addEventListener("click", () => {
    const mode = el.dataset.rewindMode as "conversation" | "files" | "both";
    const rowId = el.dataset.rowId ?? "";
    state.timeline = { ...state.timeline, rewindState: startRewind(rowId, mode) };
    const actions = postRewindActions({ mode, agentId: "demo", rewoundMessageText: "Implement the workspace shell.", composerEmpty: !state.timeline.draftText });
    state.eventLog.push(`Rewind ${mode}: ${actions.map((a) => a.kind).join(", ")}`);
    if (actions.some((a) => a.kind === "restore-composer")) {
      draftStore.setText(DEMO_DRAFT_KEY, "Implement the workspace shell.");
      state.timeline = { ...state.timeline, draftText: "Implement the workspace shell.", rewindState: REWIND_IDLE };
    } else { state.timeline = { ...state.timeline, rewindState: REWIND_IDLE }; }
    saveAndRender(`Rewound ${mode}`);
  }));
  const composerTextarea = root.querySelector<HTMLTextAreaElement>("[data-action=\"composer-input\"]");
  if (composerTextarea) {
    composerTextarea.addEventListener("input", () => {
      draftStore.setText(DEMO_DRAFT_KEY, composerTextarea.value);
      state.timeline = { ...state.timeline, draftText: composerTextarea.value };
    });
  }
}

function handleAction(action: string, el: HTMLElement): void {
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
    const row: TimelineRow = { rowId: `live-${seq}`, kind: "activity_log", seqStart: seq, seqEnd: seq, source: "live", epochId: "e1", timestamp: Date.now(), payload: { activityType: "info", message: `Live row ${seq} added at ${new Date().toLocaleTimeString()}` } };
    const next = applyLiveRow(state.timeline.timeline, row);
    const scrollResult = onRowsAdded(state.timeline.autoscroll);
    state.timeline = { ...state.timeline, timeline: next, autoscroll: scrollResult };
  } else if (action === "clear-timeline") {
    state.timeline = { ...state.timeline, timeline: EMPTY_TIMELINE };
  } else if (action === "jump-to-bottom") {
    const { shouldScroll: _s, ...autoscroll } = onJumpToBottom(state.timeline.autoscroll);
    state.timeline = { ...state.timeline, autoscroll };
  } else if (action === "composer-input") {
    const text = (el as HTMLTextAreaElement).value ?? "";
    draftStore.setText(DEMO_DRAFT_KEY, text);
    state.timeline = { ...state.timeline, draftText: text };
    return; // don't re-render on every keystroke — let textarea handle it naturally
  } else if (action === "composer-submit") {
    const draft = draftStore.load(DEMO_DRAFT_KEY);
    if (draft.text.trim()) {
      const seq = (state.timeline.timeline.rows.at(-1)?.seqStart ?? 0) + 1;
      const row: TimelineRow = { rowId: `user-${seq}`, kind: "user_message", seqStart: seq, seqEnd: seq, source: "live", epochId: "e1", timestamp: Date.now(), payload: { text: draft.text, canRewind: true } };
      state.timeline = { ...state.timeline, timeline: applyLiveRow(state.timeline.timeline, row) };
      draftStore.markSent(DEMO_DRAFT_KEY);
      state.timeline = { ...state.timeline, draftText: "" };
      state.eventLog.push(`Sent: "${draft.text.slice(0, 40)}"`);
    }
  } else if (action === "reset") {
    window.localStorage.removeItem(`${SERVER_ID}:${WORKSPACE_ID}`);
    state = createInitialState();
  } else if (action === "gate-select" && el instanceof HTMLSelectElement) {
    state.gateScenario = el.value as GateScenario;
  } else if (action === "mobile-tab-select" && el instanceof HTMLSelectElement) {
    focusTab(el.value);
    return;
  } else if (action.startsWith("header:")) {
    state.eventLog.push(`Header action: ${action.slice("header:".length)}`);
  }
  saveAndRender(`Action: ${action}`);
}

function openTarget(target: WorkspaceTabTarget): void {
  const tab = createWorkspaceTab(target);
  if (!state.tabs.some((item) => item.tabId === tab.tabId)) state.tabs = [...state.tabs, tab];
  state.layout = openTabInFocusedPane(state.layout, tab);
  focusTab(tab.tabId, false);
  saveAndRender(`Opened ${target.kind} tab ${tab.tabId}.`);
}

function focusTab(tabId: string, rerender = true): void {
  const pane = listPanes(state.layout.root).find((candidate) => candidate.tabIds.includes(tabId));
  if (!pane) return;
  state.layout = { ...state.layout, focusedPaneId: pane.id, root: focusTabInNode(state.layout.root, pane.id, tabId) };
  state.mountedLru = nextMountedTabLru(state.mountedLru, tabId);
  if (rerender) saveAndRender(`Focused ${tabId}.`);
}

function closeTab(tabId: string): void {
  state.tabs = state.tabs.filter((tab) => tab.tabId !== tabId);
  state.layout = closeTabInLayout(state.layout, tabId);
  const active = activeTabId();
  if (active) state.mountedLru = nextMountedTabLru(state.mountedLru, active);
  saveAndRender(`Closed ${tabId}.`);
}

function splitActive(side: "right" | "bottom"): void {
  const pane = findPane(state.layout.root, state.layout.focusedPaneId) ?? listPanes(state.layout.root)[0];
  const tabId = pane ? activeTabForPane(pane) : undefined;
  if (!pane || !tabId) {
    const result = splitEmptyToSide(state.layout, state.layout.focusedPaneId, side, `pane-${Date.now()}`, `draft-${state.nextDraft++}`);
    state.tabs = [...state.tabs, result.tab];
    state.layout = result.layout;
    saveAndRender(`Split empty pane ${side}.`);
    return;
  }
  const result = splitTabToSide(state.layout, pane.id, tabId, side, `pane-${Date.now()}`);
  state.layout = result.layout;
  saveAndRender(result.split ? `Split ${tabId} ${side}.` : `Split depth cap reached.`);
}

function promoteDraft(tabId: string): void {
  const index = state.tabs.findIndex((tab) => tab.tabId === tabId);
  if (index < 0) return;
  const agentId = `agent-${state.nextAgent++}`;
  const tab = createWorkspaceTab({ kind: "agent", agentId });
  state.tabs = state.tabs.map((item) => item.tabId === tabId ? tab : item);
  state.layout = replaceTabIdInLayout(state.layout, tabId, tab.tabId);
  saveAndRender(`Retargeted draft ${tabId} to agent ${agentId}.`);
}

function togglePin(target: PinnedTabTarget): void {
  const next = { version: 1 as const, targets: togglePinnedTarget(pinnedStore.load().targets, target) };
  pinnedStore.save(next);
  saveAndRender(`Toggled pin ${target.kind}.`);
}

function gateState(): ReturnType<typeof resolveWorkspaceRouteGate> {
  const base = { routeServerId: SERVER_ID, activeServerId: SERVER_ID, workspaceId: WORKSPACE_ID, knownWorkspaceIds: [WORKSPACE_ID], workspaceDirExists: true };
  switch (state.gateScenario) {
    case "ready": return resolveWorkspaceRouteGate({ ...base, hostOnline: true, workspacesHydrated: true, tabsHydrated: true });
    case "splash": return resolveWorkspaceRouteGate({ ...base, hostOnline: true, workspacesHydrated: true, tabsHydrated: false });
    case "foreign": return resolveWorkspaceRouteGate({ ...base, routeServerId: "other-host", hostOnline: true, workspacesHydrated: true, tabsHydrated: true });
    case "missing": return resolveWorkspaceRouteGate({ ...base, workspaceId: "missing", knownWorkspaceIds: [], hostOnline: true, workspacesHydrated: true, tabsHydrated: true });
    case "offline": return resolveWorkspaceRouteGate({ ...base, hostOnline: false, workspacesHydrated: false, tabsHydrated: false });
  }
}

function activeTabId(): string | undefined {
  const pane = findPane(state.layout.root, state.layout.focusedPaneId) ?? listPanes(state.layout.root)[0];
  return pane ? activeTabForPane(pane) : undefined;
}

function tabById(tabId: string): WorkspaceTab | undefined {
  return state.tabs.find((tab) => tab.tabId === tabId);
}

function nextIds(): { nextDraftId: string; nextTerminalId: string; nextBrowserId: string; profileCwd: string } {
  return { nextDraftId: `draft-${state.nextDraft}`, nextTerminalId: `terminal-${state.nextTerminal}`, nextBrowserId: `browser-${state.nextBrowser}`, profileCwd: WORKSPACE_DIR };
}

function saveAndRender(message: string): void {
  if (message) state.eventLog.push(message);
  layoutStore.save(SERVER_ID, WORKSPACE_ID, state.layout);
  render();
}

function focusTabInNode(node: SplitNode, paneId: string, tabId: string): SplitNode {
  if (node.kind === "pane") return node.id === paneId ? { ...node, focusedTabId: tabId } : node;
  return { ...node, children: node.children.map((child) => focusTabInNode(child, paneId, tabId)) };
}

function replaceTabIdInLayout(layout: WorkspaceLayout, oldId: string, newId: string): WorkspaceLayout {
  return { ...layout, root: replaceTabIdInNode(layout.root, oldId, newId) };
}

function replaceTabIdInNode(node: SplitNode, oldId: string, newId: string): SplitNode {
  if (node.kind === "pane") {
    return {
      ...node,
      tabIds: node.tabIds.map((id) => id === oldId ? newId : id),
      focusedTabId: node.focusedTabId === oldId ? newId : node.focusedTabId,
    };
  }
  return { ...node, children: node.children.map((child) => replaceTabIdInNode(child, oldId, newId)) };
}

function iconForAction(id: string): string {
  if (id.includes("script")) return "▶";
  if (id.includes("editor")) return "⌘";
  if (id.includes("git")) return "⑂";
  return "•";
}

function visualIcon(name: string): string {
  switch (name) {
    case "sparkles": return "✦";
    case "bot": return "🤖";
    case "terminal": return "⌁";
    case "globe": return "◎";
    case "file": return "◰";
    case "wrench": return "⚙";
    default: return name.length <= 2 ? name : "•";
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[ch] ?? ch);
}

function injectStyles(): void {
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
