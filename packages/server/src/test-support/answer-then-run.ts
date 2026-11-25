import type {
  AfterReply,
  AgentService,
  CreateAgentAnswer,
  SendPromptAnswer,
} from "../agent/agent-service.js";
import type { Session } from "../ws/session.js";

/**
 * Call an RPC handler the way `routeTextFrame` does: the hooks it hands to `afterReply` run once
 * its answer is back, so work a handler detaches (a turn) starts after the answer. `onAnswer` sees
 * the answer first, which lets a test note where it falls among the frames the work sends. Tests
 * only; not part of the daemon runtime.
 */
export async function answerThenRun<T>(
  call: (afterReply: AfterReply) => Promise<T>,
  onAnswer?: (answer: T) => void,
): Promise<T> {
  const hooks: Array<() => void> = [];
  const answer = await call((hook) => {
    hooks.push(hook);
  });
  onAnswer?.(answer);
  for (const hook of hooks) hook();
  return answer;
}

/** `AgentService`'s two prompt-taking RPCs, called as the router calls them. */
export interface AgentCalls {
  /**
   * `create_agent_request`: resolves with the answer; a prompt's turn runs on after it.
   * `connection` is the creating connection, whose capabilities shape the system prompt.
   */
  create(
    msg: Record<string, unknown>,
    connection?: Pick<Session, "supports">,
  ): Promise<CreateAgentAnswer>;
  /** `send_agent_prompt`: resolves with the answer; the turn runs on after it. */
  send(msg: Record<string, unknown>): Promise<SendPromptAnswer>;
  /** `create`, then waits for the turn it accepted to settle (`AgentService.turnSettled`). */
  createSettled(msg: Record<string, unknown>): Promise<CreateAgentAnswer>;
  /** `send`, then waits for the turn it accepted to settle. */
  sendSettled(msg: Record<string, unknown>): Promise<SendPromptAnswer>;
}

export function agentCalls(
  service: AgentService,
  getSessions: () => Iterable<Session> = () => [],
): AgentCalls {
  const create: AgentCalls["create"] = (msg, connection) =>
    answerThenRun((afterReply) => service.handleCreate(msg, getSessions, afterReply, connection));
  const send: AgentCalls["send"] = (msg) =>
    answerThenRun((afterReply) => service.handleSendPrompt(msg, getSessions, afterReply));
  return {
    create,
    send,
    createSettled: async (msg) => {
      const answer = await create(msg);
      await service.turnSettled(answer.payload.agentId);
      return answer;
    },
    sendSettled: async (msg) => {
      const answer = await send(msg);
      await service.turnSettled(answer.payload.agentId);
      return answer;
    },
  };
}
