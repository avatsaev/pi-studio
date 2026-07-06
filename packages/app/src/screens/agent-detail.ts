/**
 * agent-detail — pure view-model logic for the standalone Agent detail screen
 * mounted at `/h/:serverId/agent/:agentId`.
 *
 * Keeps the React component (AgentDetailScreen / LiveAgentPage) thin: gate
 * resolution and header-action availability are computed here so they can be
 * unit-tested without a DOM.
 *
 * clean-room-scope/features/app-navigation-screens.md § Sessions / agent routing
 * clean-room-scope/features/agent-sessions.md § interrupt / resume / archive
 */

import type { AgentStatus } from "@av-pi-studio/protocol";

/** Header actions available on the standalone agent view. */
export type AgentDetailAction = "open-in-workspace" | "interrupt" | "resume" | "archive";

/** Route gate: what the screen should render. */
export type AgentDetailGate = "loading" | "not-found" | "ready";

export interface AgentDetailGateInput {
  /** The agent is present in the session directory/store. */
  exists: boolean;
  /** The session directory is still being populated (initial load / reconnect). */
  loading: boolean;
}

/**
 * Resolve the render gate. An agent that is present renders immediately; an
 * absent agent is "loading" only while the directory is still hydrating, and
 * "not-found" once hydration has settled without producing it.
 */
export function resolveAgentDetailGate(input: AgentDetailGateInput): AgentDetailGate {
  if (input.exists) return "ready";
  if (input.loading) return "loading";
  return "not-found";
}

/**
 * Which header actions are enabled for a given agent status.
 *
 * - open-in-workspace: always available for an existing agent.
 * - interrupt: only while a turn is running.
 * - resume: when the agent is stopped/idle/errored/closed (i.e. not running).
 * - archive: always available for an existing agent.
 *
 * When `status` is undefined (not yet known) only the always-available actions
 * are enabled.
 */
export function resolveAgentDetailActions(status: AgentStatus | undefined): Record<AgentDetailAction, boolean> {
  const running = status === "running";
  const resumable = status === "idle" || status === "error" || status === "closed";
  return {
    "open-in-workspace": true,
    interrupt: running,
    resume: resumable,
    archive: true,
  };
}

/** Ordered list of actions to render, filtered to the enabled ones. */
export function enabledAgentDetailActions(status: AgentStatus | undefined): AgentDetailAction[] {
  const map = resolveAgentDetailActions(status);
  const order: AgentDetailAction[] = ["open-in-workspace", "interrupt", "resume", "archive"];
  return order.filter((a) => map[a]);
}

/** Map an agent status to a StatusBadge variant (success | error | muted). */
export function agentStatusBadgeVariant(status: AgentStatus | undefined): "success" | "error" | "muted" {
  switch (status) {
    case "running":
    case "idle":
      return "success";
    case "error":
      return "error";
    default:
      return "muted";
  }
}

/** Human-readable status label. */
export function agentStatusLabel(status: AgentStatus | undefined): string {
  switch (status) {
    case "initializing":
      return "Initializing";
    case "idle":
      return "Idle";
    case "running":
      return "Running";
    case "error":
      return "Error";
    case "closed":
      return "Closed";
    default:
      return "Unknown";
  }
}

/** Human-readable label per action (used by the header buttons). */
export function agentDetailActionLabel(action: AgentDetailAction): string {
  switch (action) {
    case "open-in-workspace":
      return "Open in workspace";
    case "interrupt":
      return "Interrupt";
    case "resume":
      return "Resume";
    case "archive":
      return "Archive";
  }
}
