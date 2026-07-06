/**
 * PaneContentRouter — maps WorkspaceTab → panel component.
 *
 * Wraps each pane in Suspense + ErrorBoundary for isolation.
 * Keepalive: backgrounded panes are hidden via CSS but stay mounted to
 * preserve DOM state (terminal scrollback, scroll position, etc).
 *
 * See: clean-room-scope/features/workspace-ui.md § pane content, § keepalive
 */

import {
  Component,
  Suspense,
  lazy,
  type ReactNode,
  type ErrorInfo,
} from "react";
import { Spinner } from "../primitives/index.js";
import { Timeline, Composer } from "../timeline/index.js";
import { AgentConversation } from "../timeline/AgentConversation.js";
import { LiveExplorerPane } from "../panels/LiveExplorerPane.js";
import { useSessionStore } from "../../store/session-store.js";
import { useWorkspaceLayoutStore } from "../../store/workspace-layout-store.js";

// Heavy panes are code-split so they only load when a workspace actually opens
// that pane kind. Each is already rendered under a <Suspense> fallback in
// KeepalivePaneWrapper. (sprint-030 task-005)
const LiveTerminalPane = lazy(() => import("../panels/LiveTerminalPane.js").then((m) => ({ default: m.LiveTerminalPane })));
const LiveFilePreviewPane = lazy(() => import("../panels/LiveFilePreviewPane.js").then((m) => ({ default: m.LiveFilePreviewPane })));
const LiveGitPane = lazy(() => import("../panels/LiveGitPane.js").then((m) => ({ default: m.LiveGitPane })));
const BrowserPane = lazy(() => import("../panels/BrowserPane.js").then((m) => ({ default: m.BrowserPane })));
import { mountedTabState } from "../../workspace/keepalive.js";
import type { WorkspaceTab } from "../../workspace/tabs.js";

import type { TimelineRow } from "../../timeline/reducer.js";
import { useDraft } from "../../hooks/use-composer.js";

// ─── Error boundary ───────────────────────────────────────────────────────────

interface ErrorBoundaryState { error: Error | null }

export class PaneErrorBoundary extends Component<
  { children: ReactNode; tabId: string },
  ErrorBoundaryState
> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[PaneContentRouter] pane ${this.props.tabId}:`, error, info);
  }

  override render() {
    if (this.state.error) {
      return (
        <div style={{ padding: "24px", color: "var(--pi-color-statusDanger)" }}>
          <strong>Something went wrong in this pane.</strong>
          <pre style={{ marginTop: 8, fontSize: 12, opacity: 0.7, whiteSpace: "pre-wrap" }}>
            {this.state.error.message}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: 12, padding: "4px 12px", cursor: "pointer" }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Pane context ─────────────────────────────────────────────────────────────

export interface PaneContext {
  serverId: string;
  workspaceId: string;
  isActive: boolean;
}

// ─── Empty states for panels that need real data ──────────────────────────────

const EMPTY_ROWS: readonly TimelineRow[] = [];

/** Resolve the workspace's root directory (dev: workspaceId === agentId). */
function useWorkspaceCwd(workspaceId: string): string | undefined {
  return useSessionStore(
    (s) => s.agents[workspaceId]?.cwd ?? s.workspaces[workspaceId]?.cwd,
  );
}

// ─── Per-kind pane renderers ──────────────────────────────────────────────────

function AgentPane({ agentId, ctx }: { agentId: string; ctx: PaneContext }) {
  return <AgentConversation serverId={ctx.serverId} agentId={agentId} />;
}

function DraftPane({ ctx }: { ctx: PaneContext }) {
  const draftKey = `draft:${ctx.workspaceId}`;
  const draft = useDraft(draftKey);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ flex: 1, overflow: "hidden" }}>
        <Timeline rows={EMPTY_ROWS} onLoadOlder={async () => {}} loadingOlder={false} />
      </div>
      <Composer
        key={draftKey}
        agentRunning={false}
        initialDraft={draft.text}
        initialAttachments={draft.attachments}
        onDraftChange={draft.setText}
        onAttachmentsChange={draft.setAttachments}
        onSubmit={() => {}}
      />
    </div>
  );
}

function TerminalPaneWrapper({ terminalId, ctx }: { terminalId: string; ctx: PaneContext }) {
  const cwd = useWorkspaceCwd(ctx.workspaceId);
  // Live terminal wired to the daemon PTY stream (create/subscribe + binary I/O).
  return (
    <LiveTerminalPane
      serverId={ctx.serverId}
      workspaceId={ctx.workspaceId}
      terminalId={terminalId}
      cwd={cwd}
      isActive={ctx.isActive}
    />
  );
}

function ExplorerPaneWrapper({ ctx }: { ctx: PaneContext }) {
  const cwd = useWorkspaceCwd(ctx.workspaceId);
  const openTab = useWorkspaceLayoutStore((s) => s.openTab);
  return (
    <LiveExplorerPane
      serverId={ctx.serverId}
      workspaceId={ctx.workspaceId}
      cwd={cwd}
      onOpenFile={(path) => openTab(ctx.serverId, ctx.workspaceId, { kind: "file", path })}
    />
  );
}

function FilePaneWrapper({ path, ctx }: { path: string; ctx: PaneContext }) {
  return <LiveFilePreviewPane serverId={ctx.serverId} path={path} />;
}

function GitPaneWrapper({ ctx }: { ctx: PaneContext }) {
  const cwd = useWorkspaceCwd(ctx.workspaceId);
  return <LiveGitPane serverId={ctx.serverId} cwd={cwd} />;
}

function BrowserPaneWrapper({ ctx }: { ctx: PaneContext }) {
  return <BrowserPane isElectron={false} />;
}

// ─── Tab → content dispatcher ─────────────────────────────────────────────────

function PaneContent({ tab, ctx }: { tab: WorkspaceTab; ctx: PaneContext }) {
  const { target } = tab;
  switch (target.kind) {
    case "agent":
      return <AgentPane agentId={target.agentId} ctx={ctx} />;
    case "draft":
      return <DraftPane ctx={ctx} />;
    case "terminal":
      return <TerminalPaneWrapper terminalId={target.terminalId} ctx={ctx} />;
    case "file":
      return <FilePaneWrapper path={target.path} ctx={ctx} />;
    case "browser":
      return <BrowserPaneWrapper ctx={ctx} />;
    case "setup":
      return (
        <div style={{ padding: 24, display: "flex", justifyContent: "center" }}>
          <Spinner />
        </div>
      );
    default: {
      // Exhaustiveness — should never happen
      return <div style={{ padding: 24, opacity: 0.5 }}>Unknown pane</div>;
    }
  }
}

// ─── Keepalive wrapper ────────────────────────────────────────────────────────

function KeepalivePaneWrapper({
  tab,
  activeTabId,
  mountedLru,
  ctx,
}: {
  tab: WorkspaceTab;
  activeTabId: string | undefined;
  mountedLru: readonly string[];
  ctx: Omit<PaneContext, "isActive">;
}) {
  const state = mountedTabState(tab.tabId, activeTabId, mountedLru);

  // Fully unmounted — don't render at all
  if (state === "unmounted") return null;

  const isActive = state === "active";
  // hidden: display:none, visible: position absolute inset 0
  const hidden = state === "mounted-hidden";

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: hidden ? "none" : "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
      aria-hidden={!isActive}
      data-pane-tab={tab.tabId}
      data-pane-state={state}
    >
      <PaneErrorBoundary tabId={tab.tabId}>
        <Suspense
          fallback={
            <div style={{ padding: 24, display: "flex", justifyContent: "center" }}>
              <Spinner />
            </div>
          }
        >
          <PaneContent tab={tab} ctx={{ ...ctx, isActive }} />
        </Suspense>
      </PaneErrorBoundary>
    </div>
  );
}

// ─── Main router ──────────────────────────────────────────────────────────────

export interface PaneContentRouterProps {
  /** All tabs for this pane (from the tab registry). */
  tabs: WorkspaceTab[];
  /** The currently active tab id. */
  activeTabId: string | undefined;
  /** LRU list of mounted (keepalive) tab ids (cap 3). */
  mountedLru: readonly string[];
  serverId: string;
  workspaceId: string;
}

export function PaneContentRouter({
  tabs,
  activeTabId,
  mountedLru,
  serverId,
  workspaceId,
}: PaneContentRouterProps) {
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", background: "var(--pi-color-surfaceWorkspace)" }}>
      {tabs.map((tab) => (
        <KeepalivePaneWrapper
          key={tab.tabId}
          tab={tab}
          activeTabId={activeTabId}
          mountedLru={mountedLru}
          ctx={{ serverId, workspaceId }}
        />
      ))}
    </div>
  );
}
