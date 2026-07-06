/**
 * LiveAgentPage — the standalone Agent detail screen mounted at
 * `/h/:serverId/agent/:agentId`. Replaces the sprint-029 PlaceholderScreen.
 *
 * Renders the shared AgentConversation (timeline + composer) beneath a header
 * with live status + actions (open-in-workspace / interrupt / resume / archive).
 *
 * clean-room-scope/sprints/sprint-030-integration-gap-closure/task-001
 * clean-room-scope/features/app-navigation-screens.md
 */

import { useNavigate, useParams } from "react-router";
import { AgentDetailScreen } from "../components/screens/AgentDetailScreen.js";
import { AgentConversation } from "../components/timeline/AgentConversation.js";
import { useConnectionStatus } from "../providers/ConnectionProvider.js";
import { useClient } from "../hooks/client-context.js";
import { useAgentEntry, useAgentStatus } from "../hooks/use-session-hooks.js";
import { resolveAgentDetailGate, type AgentDetailAction } from "../screens/agent-detail.js";
import { routes } from "../runtime/route-grammar.js";

export function LiveAgentPage() {
  const navigate = useNavigate();
  const params = useParams<{ serverId?: string; agentId?: string }>();
  const connection = useConnectionStatus();
  const client = useClient();

  const serverId = params.serverId ?? connection.serverId ?? undefined;
  const agentId = params.agentId;

  const entry = useAgentEntry(agentId);
  const status = useAgentStatus(agentId);

  const gate = resolveAgentDetailGate({
    exists: !!entry,
    // The session store is populated once the connection reaches "connected";
    // treat the initial-connect window as loading so we don't flash not-found.
    loading: connection.status === "connecting",
  });

  function handleAction(action: AgentDetailAction) {
    if (!agentId) return;
    switch (action) {
      case "open-in-workspace": {
        if (!serverId) return;
        const workspaceId = entry?.workspaceId ?? agentId;
        navigate(routes.workspace(serverId, workspaceId, { kind: "agent", id: agentId }));
        break;
      }
      case "interrupt":
        void client?.agent(agentId).interrupt();
        break;
      case "resume":
        void client?.agent(agentId).resume();
        break;
      case "archive":
        void (async () => {
          await client?.agent(agentId).archive();
          navigate(routes.sessions());
        })();
        break;
    }
  }

  return (
    <AgentDetailScreen
      gate={gate}
      title={entry?.title ?? agentId ?? "Agent"}
      provider={entry?.provider}
      status={status}
      onAction={handleAction}
      onBack={() => navigate(routes.sessions())}
    >
      {gate === "ready" && serverId && agentId ? (
        <AgentConversation serverId={serverId} agentId={agentId} />
      ) : null}
    </AgentDetailScreen>
  );
}
