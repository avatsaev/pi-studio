/**
 * Session restore — on a fresh `open` connection, fetches known agents
 * (`list_agents_request`) and hydrates each into the session store from its authoritative
 * timeline (`fetch_agent_timeline_request`). Ports POC `restoreSessions()`/`onConnected()`
 * (POC_TO_APP_PLAN_UI.md §4.3 "Session restore"). Live agent-stream subscription for restored
 * sessions is wired by `ChatPanel`'s `useAgentStream` once its tab mounts, keyed off `agentId` —
 * no `expectingAgent` race, since `agentId` is always known before subscribing.
 *
 * A daemon reporting zero agents restores nothing: `activeWorkspaceCwd` stays `null` and the UI
 * renders its no-workspace empty state (`TabPanelHost`) — this hook never auto-creates a session.
 * Every known agent restores, including an idle, never-used draft (eager materialization,
 * `materialize.ts`, `tab-store.ts`'s `openNewChat`) that survives to the next connect because its
 * tab was never explicitly closed — it is a real persisted session the instant it materializes,
 * not a phantom the UI should hide; only an explicit close (`closeTab`'s `discardIfEmpty`) or an
 * explicit delete removes it.
 */

import { useEffect, useRef } from "react";
import type { AgentUpdateMessage, PiStudioClient } from "@av-pi-studio/client";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useSessionStore } from "@pi-studio-ui/stores/session-store.js";
import { useUiStore } from "@pi-studio-ui/stores/ui-store.js";
import { useLayoutStore } from "@pi-studio-ui/stores/layout-store.js";
import { resolveHome } from "@pi-studio-ui/stores/explorer-store.js";
import {
  collapseInactiveWorkspaces,
  groupSessionsByWorkspace,
  normalizeCwd,
} from "@pi-studio-ui/features/sessions/workspace-grouping.js";
import { openChatTab } from "@pi-studio-ui/features/sessions/open-chat-tab.js";
import { EMPTY_TIMELINE, applyStreamEvent } from "@pi-studio-ui/timeline/reducer.js";
import { fetchTimelineEvents } from "@pi-studio-ui/lib/protocol/timeline-paging.js";
import type { AgentStatus } from "@av-pi-studio/protocol";

interface RestoredAgent {
  agentId: string;
  status?: string;
  cwd?: string;
  title?: string;
  lastActivity?: number;
  /** Live model (sprint-042), sourced server-side from the attached session's runtime info when
   * one exists, else the persisted `record.config?.model` (deferred draft or daemon restart —
   * see `list_agents_request` in `daemon/bootstrap.ts`/`dev-bootstrap.ts`). */
  model?: string;
  /** The model's OWN underlying LLM provider (e.g. `"anthropic"`) — always sourced from
   * `record.config?.modelProvider` (no live-session override exists for this field; a session's
   * `getRuntimeInfo().provider` is the pi-studio `AgentClient` id, a different namespace — see
   * `provider-contract.ts` `ProviderRuntimeInfo`). REQUIRED to call `setModel` again after a
   * restore without falling into `handleSelectModel`'s `if (!modelProvider) return` no-op. */
  modelProvider?: string;
  provider?: string;
}

/** Exported for direct unit testing — this project's vitest config runs `.test.ts` under a plain
 * Node environment (no DOM), so hooks with effects are verified by smoke test (task-007) rather
 * than rendered; this narrow type guard is the one piece of the listener worth a direct test. */
export function hasStringModel(
  msg: AgentUpdateMessage,
): msg is AgentUpdateMessage & { model: string } {
  return typeof msg.model === "string";
}

export function useSessionRestore(): void {
  const client = useConnectionStore((s) => s.client);
  const status = useConnectionStore((s) => s.status);
  const restoredRef = useRef(false);

  useEffect(() => {
    if (status !== "open" || !client) return;
    if (restoredRef.current) return; // one restore per connection lifetime
    restoredRef.current = true;

    void runSessionRestore(client);
  }, [status, client]);

  // Live model updates from an explicit `/model` set (sprint-042). `agent_update` is broadcast
  // by every RPC that changes agent state (create/status/model/…) and reaches `onSessionMessage`
  // because the daemon wraps every non-session-enveloped broadcast in `{type:"session", message}`
  // (`wrapSessionEnvelope`, `daemon/bootstrap.ts`) — this listener only reacts to the ones that
  // carry a `model`. Lives for the whole connection (not gated by `restoredRef`, unlike the
  // one-shot restore fetch above), so a model change on any session — active or not — is captured.
  useEffect(() => {
    if (status !== "open" || !client) return;
    return client.onAgentUpdate((msg) => {
      if (hasStringModel(msg)) {
        const modelProvider = typeof msg.modelProvider === "string" ? msg.modelProvider : undefined;
        useSessionStore.getState().setModelByAgentId(msg.agentId, msg.model, modelProvider);
      }
    });
  }, [status, client]);
}

/**
 * The one-shot restore body plus its hydration signal. Exported for direct unit testing — this
 * project's vitest config runs `.test.ts` under a plain Node environment (no DOM), so the hook
 * itself is verified by smoke test while this is driven directly.
 */
export async function runSessionRestore(client: PiStudioClient): Promise<void> {
  try {
    await restoreAgents(client);
  } finally {
    // Reported on every path — zero agents and a failed request included, or a persisted pane
    // would wait forever for a claim that never comes.
    useLayoutStore.getState().markHydrationSource("sessions");
  }
}

async function restoreAgents(client: PiStudioClient): Promise<void> {
  let agents: RestoredAgent[] = [];
  try {
    const result = await client.connection.request<{ agents?: RestoredAgent[] }>(
      "list_agents_request",
      { all: false },
    );
    agents = result.agents ?? [];
  } catch {
    agents = [];
  }

  agents.sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0));

  const sessionStore = useSessionStore.getState();
  for (const agent of agents) {
    if (sessionStore.findByAgentId(agent.agentId)) continue;

    let timeline = EMPTY_TIMELINE;
    try {
      // Page to completion: one fetch returns only the OLDEST `limit` items and the newest
      // messages of a long conversation would be missing from restored history.
      const events = await fetchTimelineEvents((cursor) =>
        client.agent(agent.agentId).timeline.fetch({
          direction: "after",
          cursor: cursor ?? undefined,
          limit: 200,
        }),
      );
      timeline = events.reduce(applyStreamEvent, EMPTY_TIMELINE);
    } catch {
      // Best-effort: an unreadable timeline still gets an (empty) restored session.
    }

    // A never-used draft (eager materialization, `materialize.ts`) has no server-persisted
    // title (only an explicit rename — `SessionContextMenu.tsx` — ever sets one) and no
    // messages to derive one from; default it to "New chat", matching a freshly
    // `createSession`-created entry, instead of falling through to the cwd basename.
    const isEmptyDraft = timeline.rows.length === 0;
    sessionStore.hydrate({
      id: `s-${agent.agentId.slice(0, 12)}`,
      agentId: agent.agentId,
      title: agent.title || (isEmptyDraft ? "New chat" : agent.cwd?.split("/").pop()) || "Restored",
      status: (agent.status as AgentStatus | undefined) ?? "idle",
      cwd: agent.cwd || "~",
      timeline,
      userMessageCount: timeline.rows.filter((r) => r.kind === "user").length,
      model: agent.model,
      modelProvider: agent.modelProvider,
    });
  }

  const { order, sessions } = useSessionStore.getState();
  const first = order.length > 0 ? sessions[order[0] ?? ""] : undefined;
  // Zero restored sessions: leave `tab-store.activeWorkspaceCwd` null and let `TabPanelHost`
  // render its "no workspace open" state. NEVER auto-create a session here — a workspace
  // exists only because the user opened a folder (or a restored agent carries a cwd).
  if (!first) return;

  const homeDir = await resolveHome(client).catch(() => null);
  const firstCwd = normalizeCwd(first.cwd || "~", homeDir);
  // Two different questions, conflated until sprint-049: which workspace was the user LOOKING at
  // (persisted since task-009, captured at boot as `pendingActiveWorkspace`), versus which agent was
  // most recently active *globally* (`first`, all this had before the layout record existed). The
  // sidebar's expanded group, the file explorer's root and the active conversation all follow the
  // former; only the fallback-tab rule below still keys off the latter. Restoring the panes of one
  // workspace while the sidebar sat expanded on another is exactly the reported "panes come back but
  // the wrong workspace is open" bug.
  const viewCwd = useLayoutStore.getState().pendingActiveWorkspace ?? firstCwd;
  const workspaceGroups = groupSessionsByWorkspace(order, sessions, homeDir);
  useUiStore
    .getState()
    .setCollapsedWorkspaces(collapseInactiveWorkspaces(workspaceGroups, viewCwd));
  // `order` is most-recent-first across EVERY workspace, so `first` is a global winner. Seed the
  // active conversation from the workspace coming into view instead; when its focused pane holds a
  // chat, `switchWorkspace` overwrites this at the settle point anyway, but when that pane holds a
  // terminal or a file `syncActiveSession` deliberately no-ops — and then this seed is what the
  // status bar keeps showing, so it must not be a conversation from somewhere else.
  const inView = order.find((id) => normalizeCwd(sessions[id]?.cwd || "~", homeDir) === viewCwd);
  useSessionStore.getState().activate(inView ?? first.id);
  useUiStore.getState().setCwd(viewCwd);

  // Every chat a persisted pane is still waiting for comes back, so a workspace split across two
  // conversations restores as two panes.
  const claimed = claimedChatIdentities();
  const reopened = new Set<string>();
  for (const id of order) {
    const entry = sessions[id];
    if (!entry?.agentId || !claimed.has(`agent:${entry.agentId}`)) continue;
    openChatTab(entry, homeDir);
    reopened.add(id);
  }
  // `first` — the globally most-recently-active agent, not necessarily anything the user had open —
  // is only force-opened as a fallback tab when its OWN workspace has no persisted pane-layout entry
  // to conflict with (never split, or a fresh install/cleared storage/version bump). A record for
  // some OTHER workspace must not suppress this: that workspace restores independently below, and
  // `firstCwd`'s having nothing persisted is exactly the pre-split default this falls back to.
  // Once `firstCwd` DOES have a record, this must stay claim-only: an unclaimed `first` used to
  // open unconditionally, landing in whatever pane was focused and — before `claimPaneFor`'s
  // restore-time guard existed — could silently replace a chat a claim had *just* placed there.
  //
  // Deliberately `firstCwd`, NOT `viewCwd`: this asks whether *`first`* has a record to conflict with.
  // Keying it on the workspace coming into view would silently change the question and stop opening
  // `first` whenever some other workspace had been split — the task-011 regression.
  const hasRecord = useLayoutStore.getState().layouts[firstCwd] !== undefined;
  if (!reopened.has(first.id) && !hasRecord) openChatTab(first, homeDir);
}

/**
 * The `agent:` identities persisted panes are still waiting for, across every workspace — a claim in
 * a background workspace restores its tab too, or that workspace would come back single-paned. Read
 * from the layout store's unconsumed claims, so it is empty when there was no record to install.
 */
function claimedChatIdentities(): Set<string> {
  const claimed = new Set<string>();
  for (const layout of Object.values(useLayoutStore.getState().layouts)) {
    for (const identity of Object.keys(layout.pendingPlacement)) {
      if (identity.startsWith("agent:")) claimed.add(identity);
    }
  }
  return claimed;
}
