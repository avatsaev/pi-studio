// Subagent client-side tab/track policy.
// clean-room-scope/features/subagents.md

export type AgentForSubagentPolicy = {
  agentId: string;
  parentAgentId?: string;
  archivedAt?: string;
  status?: "idle" | "running" | "waiting" | "failed" | "archived";
};

export type CloseAgentTabDecision =
  | { action: "layout-close"; archive: false; reason: "subagent" }
  | { action: "archive-agent"; archive: true; reason: "root-agent" };

export function closeAgentTabDecision(agent: AgentForSubagentPolicy): CloseAgentTabDecision {
  if (agent.parentAgentId) return { action: "layout-close", archive: false, reason: "subagent" };
  return { action: "archive-agent", archive: true, reason: "root-agent" };
}

export function subagentsForParent(agents: readonly AgentForSubagentPolicy[], parentAgentId: string): AgentForSubagentPolicy[] {
  return agents.filter((agent) => agent.parentAgentId === parentAgentId && !agent.archivedAt);
}

export function archiveSubagentAction(agent: AgentForSubagentPolicy): { action: "archive-agent"; agentId: string } {
  return { action: "archive-agent", agentId: agent.agentId };
}

export function rootWorkspaceBucketFromSubagents(
  root: AgentForSubagentPolicy,
  agents: readonly AgentForSubagentPolicy[],
): "running" | "idle" {
  return subagentsForParent(agents, root.agentId).some((agent) => agent.status === "running") ? "running" : "idle";
}
