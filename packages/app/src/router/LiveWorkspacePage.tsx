/**
 * LiveWorkspacePage — the real Workspace screen assembly: WorkspaceScreen
 * (route gating + composition) driving TabStrip + WorkspaceHeader +
 * PaneContentRouter, fed by the sprint-024 workspace hooks/store.
 *
 * clean-room-scope/features/workspace-ui.md
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { WorkspaceScreen } from "../components/screens/WorkspaceScreen.js";
import { TabStrip, type TabStripTab } from "../components/workspace/TabStrip.js";
import { WorkspaceHeader } from "../components/workspace/WorkspaceHeader.js";
import { PaneContentRouter } from "../components/workspace/PaneContentRouter.js";
import { Spinner } from "../components/primitives/Spinner.js";
import { useWorkspaceRouteState } from "../hooks/use-workspace-route.js";
import { useWorkspaceHeaderData, useWorkspaceShortcuts } from "../hooks/use-workspace-shell.js";
import { useConnectionStatus } from "../providers/ConnectionProvider.js";
import { useGitStatus } from "../hooks/use-explorer-hooks.js";
import { useClient } from "../hooks/client-context.js";
import {
  useWorkspaceLayoutStore,
  useWorkspaceTabState,
  useActiveTabId,
} from "../store/workspace-layout-store.js";
import { isCompactFormFactor } from "../platform/breakpoints.js";
import { getIsElectron } from "../platform/gating.js";
import { listPanes } from "../workspace/layout.js";
import { randomUUID } from "../util/uuid.js";
import { routes } from "../runtime/route-grammar.js";
import { LAST_WORKSPACE_KEY } from "./BootGate.js";
import { createWebKVStore } from "../providers/kv-store.js";
import { kvToLayoutStorage } from "../hooks/use-composer.js";
import { PinnedTargetsStore, type QuickLaunchButton } from "../workspace/pinned-targets.js";
import {
  TabLabelsStore,
  mergeTabLabels,
  clipboardPayloadFor,
  agentIdForTab,
  tabIdsToClose,
} from "../workspace/tab-actions.js";
import { useToast } from "../components/overlays/ToastContext.js";
import type { WorkspaceFormFactor } from "../workspace/composition.js";
import type { HeaderInput } from "../workspace/composition.js";

// Reused across renders — a stateless wrapper around localStorage.
const kvStore = createWebKVStore();
const layoutStorage = kvToLayoutStorage(kvStore);
const pinnedStore = new PinnedTargetsStore(layoutStorage);
const tabLabelsStore = new TabLabelsStore(layoutStorage);

function useViewportWidth(): number {
  const width = typeof window === "undefined" ? 1024 : window.innerWidth;
  return width;
}

export function LiveWorkspacePage() {
  const navigate = useNavigate();
  const params = useParams<{ serverId?: string; workspaceId?: string }>();
  const connection = useConnectionStatus();
  const client = useClient();
  const toast = useToast();

  const serverId = params.serverId ?? connection.serverId ?? undefined;
  const workspaceId = params.workspaceId;

  const routeState = useWorkspaceRouteState(serverId, workspaceId);
  const headerData = useWorkspaceHeaderData(serverId, workspaceId);
  const shortcuts = useWorkspaceShortcuts(serverId, workspaceId);
  const tabState = useWorkspaceTabState(serverId, workspaceId);

  // Workspace-scoped keyboard shortcuts (new terminal, close tab, focus-tab-N, …).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const parts: string[] = [];
      if (e.metaKey) parts.push("Meta");
      if (e.ctrlKey) parts.push("ctrl");
      parts.push(e.key.toLowerCase());
      const combo = parts.join("+");
      const action = shortcuts.resolve(combo);
      if (action) {
        e.preventDefault();
        shortcuts.execute(action);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shortcuts]);
  const activeTabId = useActiveTabId(serverId, workspaceId) ?? null;
  const { data: gitStatus } = useGitStatus(serverId, headerData.subtitle, client);

  const initWorkspace = useWorkspaceLayoutStore((s) => s.initWorkspace);
  const openTab = useWorkspaceLayoutStore((s) => s.openTab);
  const closeTab = useWorkspaceLayoutStore((s) => s.closeTab);
  const activateTab = useWorkspaceLayoutStore((s) => s.activateTab);
  const splitTab = useWorkspaceLayoutStore((s) => s.splitTab);

  // Initialize (seed) the workspace's tab layout. `resolveWorkspaceRouteGate`
  // returns "splash" precisely when every other condition (host online,
  // workspace known, directory present) has passed and only `tabsHydrated`
  // is missing — that's the correct signal to seed, NOT "ready" (which
  // requires tabsHydrated to already be true — gating on "ready" here would
  // deadlock, since only `initWorkspace` can set it).
  useEffect(() => {
    if (routeState.gate.state !== "splash" || !serverId || !workspaceId) return;
    if (tabState?.hydrated) return;
    // Dev-mode 1:1 synthesis: workspaceId === agentId (see dev-bootstrap.ts).
    initWorkspace(serverId, workspaceId, headerData.agentId ?? workspaceId);
  }, [routeState.gate.state, serverId, workspaceId, tabState?.hydrated, initWorkspace, headerData.agentId]);

  // Persist "last visited workspace" so BootGate can restore it on next boot.
  useEffect(() => {
    if (!serverId || !workspaceId) return;
    if (routeState.gate.state !== "ready" && routeState.gate.state !== "splash") return;
    kvStore.set(LAST_WORKSPACE_KEY, JSON.stringify({ serverId, workspaceId }));
  }, [serverId, workspaceId, routeState.gate.state]);

  const width = useViewportWidth();
  const formFactor: WorkspaceFormFactor = isCompactFormFactor(width) ? "mobile" : width < 992 ? "narrow" : "wide";

  const panes = useMemo(() => (tabState ? listPanes(tabState.layout.root) : []), [tabState]);
  const tabs = useMemo(
    () => (tabState ? tabState.tabOrder.map((id) => tabState.tabs[id]?.tab).filter((t): t is NonNullable<typeof t> => !!t) : []),
    [tabState],
  );

  // Pinned quick-launch targets (persisted) + custom tab labels (rename).
  const [pinnedTargets, setPinnedTargets] = useState(() => pinnedStore.load().targets);
  const [tabLabels, setTabLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    setPinnedTargets(pinnedStore.load().targets);
  }, []);
  useEffect(() => {
    if (serverId && workspaceId) setTabLabels(tabLabelsStore.load(serverId, workspaceId).labels);
  }, [serverId, workspaceId]);

  const tabStripTabs: TabStripTab[] = useMemo(() => mergeTabLabels(tabs, tabLabels), [tabs, tabLabels]);

  function handleGateAction(action: string) {
    if (action === "retry-host") connection.reconnect();
    else if (action.startsWith("redirect:")) navigate(action.slice("redirect:".length));
    else if (action === "dismiss-missing-workspace") navigate(routes.root());
  }

  function handleHeaderMenuAction(actionId: string) {
    if (!serverId || !workspaceId) return;
    switch (actionId) {
      case "new-agent":
        navigate(routes.newWorkspace());
        break;
      case "new-terminal":
        openTab(serverId, workspaceId, { kind: "terminal", terminalId: randomUUID() });
        break;
      case "new-browser":
        openTab(serverId, workspaceId, { kind: "browser", browserId: randomUUID() });
        break;
      default:
        break;
    }
  }

  function handleHeaderRightAction(actionId: string) {
    if (!serverId || !workspaceId) return;
    if (actionId === "explorer" || actionId === "git-explorer") {
      openTab(serverId, workspaceId, { kind: "file", path: headerData.subtitle ?? "" });
    }
  }

  function handleTabContextAction(tabId: string, actionId: string) {
    if (!serverId || !workspaceId) return;
    const tab = tabs.find((t) => t.tabId === tabId);
    const agentId = tab ? agentIdForTab(tab) : undefined;

    // Close family (close / close-others / close-left|right|above|below).
    const toClose = tabIdsToClose(actionId, tabState?.tabOrder ?? [], tabId);
    if (toClose.length > 0) {
      for (const id of toClose) closeTab(serverId, workspaceId, id);
      return;
    }

    // Clipboard copy actions (copy-resume / copy-agent-id).
    const payload = clipboardPayloadFor(actionId, { agentId });
    if (payload) {
      void navigator.clipboard
        ?.writeText(payload.text)
        .then(() => toast.copied(payload.toast))
        .catch(() => toast.error("Copy failed"));
      return;
    }

    if (actionId === "reload-agent" && agentId) {
      void client
        ?.agent(agentId)
        .resume()
        .then(() => toast.show("Agent reloaded"))
        .catch(() => toast.error("Reload failed"));
      return;
    }

    if (actionId === "rename") {
      const current = tabLabels[tabId] ?? "";
      const next = typeof window !== "undefined" ? window.prompt("Rename tab", current) : null;
      if (next === null) return;
      const state = tabLabelsStore.rename(serverId, workspaceId, tabId, next);
      setTabLabels(state.labels);
    }
  }

  function handlePinnedLaunch(button: QuickLaunchButton) {
    if (!serverId || !workspaceId) return;
    openTab(serverId, workspaceId, button.tabTarget);
  }

  function handleTrailingAction(actionId: string) {
    if (!serverId || !workspaceId) return;
    switch (actionId) {
      case "new-agent":
        navigate(routes.newWorkspace());
        break;
      case "new-terminal":
        openTab(serverId, workspaceId, { kind: "terminal", terminalId: randomUUID() });
        break;
      case "new-browser":
        openTab(serverId, workspaceId, { kind: "browser", browserId: randomUUID() });
        break;
      case "split-right":
      case "split-down":
        if (activeTabId) {
          const pane = panes.find((p) => p.tabIds.includes(activeTabId));
          if (pane) splitTab(serverId, workspaceId, pane.id, activeTabId, actionId === "split-right" ? "right" : "bottom");
        }
        break;
    }
  }

  const headerInput: HeaderInput = {
    loading: routeState.gate.state !== "ready",
    title: headerData.title,
    projectSubtitle: headerData.subtitle,
    branch: gitStatus?.branch,
    detachedHead: false,
    projectKind: gitStatus ? "git" : "non_git",
    formFactor,
    scriptsCount: 0,
    workspaceDir: headerData.subtitle,
    setupAvailable: false,
    terminalReady: true,
    isElectron: getIsElectron(),
  };

  return (
    <WorkspaceScreen
      gateInput={routeState.gateInput}
      formFactor={formFactor}
      platform="web"
      onGateAction={handleGateAction}
      headerSlot={
        <WorkspaceHeader
          input={headerInput}
          onMenuAction={handleHeaderMenuAction}
          onRightAction={handleHeaderRightAction}
        />
      }
      tabStripSlot={
        tabState ? (
          <TabStrip
            tabs={tabStripTabs}
            activeTabId={activeTabId}
            pinnedTargets={pinnedTargets}
            nextDraftId={randomUUID()}
            nextTerminalId={randomUUID()}
            nextBrowserId={randomUUID()}
            onTabSelect={(tabId) => serverId && workspaceId && activateTab(serverId, workspaceId, tabId)}
            onTabClose={(tabId) => serverId && workspaceId && closeTab(serverId, workspaceId, tabId)}
            onTabContextAction={handleTabContextAction}
            onTrailingAction={handleTrailingAction}
            onPinnedLaunch={handlePinnedLaunch}
          />
        ) : (
          <div style={{ padding: 8 }}>
            <Spinner size="sm" />
          </div>
        )
      }
      paneAreaSlot={
        tabState && serverId && workspaceId ? (
          <PaneContentRouter
            tabs={tabs}
            activeTabId={activeTabId ?? undefined}
            mountedLru={tabState.mountedLru}
            serverId={serverId}
            workspaceId={workspaceId}
          />
        ) : undefined
      }
    />
  );
}
