// Bulk close planning.
// clean-room-scope/features/workspace-ui.md § Bulk close

import { closeAgentTabDecision, type AgentForSubagentPolicy } from "./subagents.js";
import type { WorkspaceTab } from "./tabs.js";

export type BulkCloseClassification = {
  archiveAgentIds: string[];
  layoutOnlyAgentIds: string[];
  closeTerminalIds: string[];
  localOnlyTabIds: string[];
};

export function classifyBulkClose(tabs: readonly WorkspaceTab[], agents: readonly AgentForSubagentPolicy[]): BulkCloseClassification {
  const agentById = new Map(agents.map((agent) => [agent.agentId, agent]));
  const result: BulkCloseClassification = { archiveAgentIds: [], layoutOnlyAgentIds: [], closeTerminalIds: [], localOnlyTabIds: [] };
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

export function bulkCloseConfirmation(classification: BulkCloseClassification): string {
  const parts: string[] = [];
  if (classification.archiveAgentIds.length > 0) parts.push(`archive ${classification.archiveAgentIds.length} agent${plural(classification.archiveAgentIds.length)}`);
  if (classification.closeTerminalIds.length > 0) parts.push(`close ${classification.closeTerminalIds.length} terminal${plural(classification.closeTerminalIds.length)} and stop running processes`);
  if (classification.layoutOnlyAgentIds.length > 0) parts.push(`close ${classification.layoutOnlyAgentIds.length} subagent tab${plural(classification.layoutOnlyAgentIds.length)} locally`);
  if (classification.localOnlyTabIds.length > 0) parts.push(`close ${classification.localOnlyTabIds.length} local tab${plural(classification.localOnlyTabIds.length)}`);
  return parts.length === 0 ? "No tabs to close." : `This will ${joinParts(parts)}.`;
}

export type BulkClosePlan = BulkCloseClassification & { confirmation: string; closingTabIds: string[] };

export function planBulkClose(tabs: readonly WorkspaceTab[], agents: readonly AgentForSubagentPolicy[]): BulkClosePlan {
  const classification = classifyBulkClose(tabs, agents);
  return { ...classification, confirmation: bulkCloseConfirmation(classification), closingTabIds: tabs.map((tab) => tab.tabId) };
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}

function joinParts(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}
