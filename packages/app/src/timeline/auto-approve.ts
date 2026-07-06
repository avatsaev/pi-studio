// Auto-approve rule evaluation + permission-respond RPC payload.
// clean-room-scope/features/timeline-rendering.md § Permission request prompt
// clean-room-scope/features/agent-sessions.md § permissions
// task-002 § Permission RPC, § Auto-approve settings

/** A workspace auto-approve rule: match a tool by name/prefix, respond with an option. */
export interface AutoApproveRule {
  /** Exact tool name to match, or a prefix ending in "*". */
  tool: string;
  /** The option id to auto-respond with (e.g. "allow_once", "allow_always"). */
  respondWith: string;
}

export interface PermissionRequestLike {
  requestId: string;
  toolName?: string;
  responses?: string[];
}

/**
 * Evaluate auto-approve rules against a pending permission request. Returns the
 * option id to auto-respond with, or undefined when no rule matches (the prompt
 * must be shown to the user).
 */
export function evaluateAutoApprove(
  request: PermissionRequestLike,
  rules: readonly AutoApproveRule[],
): string | undefined {
  const toolName = request.toolName;
  if (!toolName) return undefined;
  for (const rule of rules) {
    if (!matchesTool(toolName, rule.tool)) continue;
    // Only auto-respond if the option is actually offered (when responses given).
    if (request.responses && !request.responses.includes(rule.respondWith)) continue;
    return rule.respondWith;
  }
  return undefined;
}

function matchesTool(toolName: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) return toolName.startsWith(pattern.slice(0, -1));
  return toolName === pattern;
}

// ─── Respond RPC ────────────────────────────────────────────────────────────

export const PERMISSION_RESPOND_RPC = "agent.permission.respond.request" as const;

export interface PermissionRespondPayload {
  agentId: string;
  permissionRequestId: string;
  response: string;
}

/** Build the payload for the permission-respond RPC (server expects these keys). */
export function buildRespondPayload(
  agentId: string,
  permissionRequestId: string,
  optionId: string,
): PermissionRespondPayload {
  return { agentId, permissionRequestId, response: optionId };
}
