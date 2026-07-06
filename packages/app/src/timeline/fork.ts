// Fork-context: create a new agent session forking from a point in an existing
// conversation.
//
// clean-room-scope/features/composer-ui.md § fork context,
// task-004 § Fork-context menu

export interface ForkRequestInput {
  /** The agent to fork from. */
  sourceAgentId: string;
  /** The message id to fork the context at. */
  messageId: string;
  /** cwd for the new session (inherited from the source workspace). */
  cwd?: string;
  provider?: string;
}

export interface ForkCreatePayload {
  provider?: string;
  cwd?: string;
  /** Fork marker consumed by the daemon's create handler. */
  forkFrom: { agentId: string; messageId: string };
}

/** Build the `create_agent_request` payload with a fork marker. */
export function buildForkRequest(input: ForkRequestInput): ForkCreatePayload {
  const payload: ForkCreatePayload = {
    forkFrom: { agentId: input.sourceAgentId, messageId: input.messageId },
  };
  if (input.provider !== undefined) payload.provider = input.provider;
  if (input.cwd !== undefined) payload.cwd = input.cwd;
  return payload;
}

/** Whether the fork-context affordance should be shown for a row. */
export function canFork(kind: string): boolean {
  return kind === "assistant_message";
}
