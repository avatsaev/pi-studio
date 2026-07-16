/**
 * Protocol `AgentStatus` (initializing/idle/running/error/closed) → design-system
 * `StatusDotInput.status` (idle/running/waiting/finished/error/queued/archived). The two enums
 * differ because the design system's dot vocabulary predates this protocol; this is the single
 * translation point.
 */

import type { AgentStatus as ProtocolAgentStatus } from "@av-pi-studio/protocol";
import type { AgentStatus as DotAgentStatus } from "../../ui/status-dot.js";

const MAP: Record<ProtocolAgentStatus, DotAgentStatus> = {
  initializing: "queued",
  idle: "idle",
  running: "running",
  error: "error",
  closed: "finished",
};

export function toDotStatus(status: ProtocolAgentStatus | "idle"): DotAgentStatus {
  return MAP[status] ?? "idle";
}
