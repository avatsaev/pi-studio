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
 */

import { useEffect, useRef } from "react";
import type { AgentUpdateMessage } from "@av-pi-studio/client";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useSessionStore } from "@pi-studio-ui/stores/session-store.js";
import { useTabStore, tabIds } from "@pi-studio-ui/stores/tab-store.js";
import { useUiStore } from "@pi-studio-ui/stores/ui-store.js";
import { resolveHome } from "@pi-studio-ui/stores/explorer-store.js";
import { normalizeCwd } from "@pi-studio-ui/features/sessions/workspace-grouping.js";
import { EMPTY_TIMELINE, applyStreamEvent } from "@pi-studio-ui/timeline/reducer.js";
import { flattenTimelineItems } from "@pi-studio-ui/lib/protocol/events.js";
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

    void (async () => {
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
          const page = await client.agent(agent.agentId).timeline.fetch({
            direction: "after",
            limit: 200,
          });
          const events = flattenTimelineItems(page.items);
          timeline = events.reduce(applyStreamEvent, EMPTY_TIMELINE);
        } catch {
          // Best-effort: an unreadable timeline still gets an (empty) restored session.
        }

        sessionStore.hydrate({
          id: `s-${agent.agentId.slice(0, 12)}`,
          agentId: agent.agentId,
          title: agent.title || agent.cwd?.split("/").pop() || "Restored",
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
      const targetCwd = normalizeCwd(first.cwd || "~", homeDir);
      useSessionStore.getState().activate(first.id);
      useUiStore.getState().setCwd(first.cwd);
      useTabStore.getState().open({
        id: tabIds.chat(first.id),
        kind: "chat",
        label: first.title,
        closable: true,
        data: { sessionId: first.id },
        workspaceCwd: targetCwd,
      });
    })();
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
