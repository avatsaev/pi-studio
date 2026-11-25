/**
 * The `agentId` an accepted `create_agent_request` answers with (`create_agent_response`
 * `payload.agentId`). Tests only; not part of the daemon runtime.
 */
export function createdAgentId(answer: Record<string, unknown>): string {
  const { payload } = answer;
  if (
    typeof payload === "object" &&
    payload !== null &&
    "agentId" in payload &&
    typeof payload.agentId === "string"
  ) {
    return payload.agentId;
  }
  throw new Error("the create_agent_response carries no agentId");
}
