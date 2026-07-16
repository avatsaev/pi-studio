/**
 * Session restore — on a fresh `open` connection, fetches known agents
 * (`list_agents_request`) and hydrates each into the session store from its authoritative
 * timeline (`fetch_agent_timeline_request`). Ports POC `restoreSessions()`/`onConnected()`
 * (POC_TO_APP_PLAN_UI.md §4.3 "Session restore"). Live agent-stream subscription for restored
 * sessions is wired by `ChatPanel`'s `useAgentStream` once its tab mounts, keyed off `agentId` —
 * no `expectingAgent` race, since `agentId` is always known before subscribing.
 */

import { useEffect, useRef } from "react";
import { useConnectionStore } from "../lib/connection/connection-store.js";
import { useSessionStore } from "../stores/session-store.js";
import { useTabStore, tabIds } from "../stores/tab-store.js";
import { useUiStore } from "../stores/ui-store.js";
import { resolveHome } from "../stores/explorer-store.js";
import { normalizeCwd } from "../features/sessions/workspace-grouping.js";
import { EMPTY_TIMELINE, applyStreamEvent } from "../timeline/reducer.js";
import { flattenTimelineItems } from "../lib/protocol/events.js";
import type { AgentStatus } from "@av-pi-studio/protocol";

interface RestoredAgent {
  agentId: string;
  status?: string;
  cwd?: string;
  title?: string;
  lastActivity?: number;
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
        });
      }

      const homeDir = await resolveHome(client).catch(() => null);
      const { order, sessions } = useSessionStore.getState();
      if (order.length > 0) {
        const first = sessions[order[0] ?? ""];
        if (first) {
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
        }
      } else {
        // No restored sessions — start one fresh, mirroring POC `if (sessions.length===0) createSession()`.
        const cwd = useUiStore.getState().cwd || "~";
        const targetCwd = normalizeCwd(cwd, homeDir);
        const id = useSessionStore.getState().createSession(cwd);
        useTabStore.getState().open({
          id: tabIds.chat(id),
          kind: "chat",
          label: "New chat",
          closable: true,
          data: { sessionId: id },
          workspaceCwd: targetCwd,
        });
      }
    })();
  }, [status, client]);
}
