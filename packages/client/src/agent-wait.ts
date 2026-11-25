import type { SessionMessage } from "@av-pi-studio/protocol";

import type { DaemonClient } from "./daemon-client.js";

/**
 * Waiting for an agent's turn to end (`AgentHandle.waitForIdle`). A turn ends with one
 * `agent_update` whose status is `idle` or `error`; an agent that is archived or deleted meanwhile
 * ends the wait as `closed`. The decisions are pure functions below; `waitForAgentIdle` wires them
 * to a connection.
 */

/** How a wait ended: the turn settled (`idle` | `error`), or the agent is gone (`closed`). */
export type AgentSettledStatus = "idle" | "error" | "closed";

export interface WaitForIdleOptions {
  /** Reject with `WaitForIdleTimeoutError` after this many ms. Omitted or 0: no limit. */
  timeoutMs?: number;
  /** Aborting rejects with a `DOMException` named `AbortError`. */
  signal?: AbortSignal;
}

export interface WaitForIdleResult {
  status: AgentSettledStatus;
}

/** `waitForIdle` ran out of time. The agent is still working; nothing was cancelled. */
export class WaitForIdleTimeoutError extends Error {
  constructor(
    readonly agentId: string,
    readonly timeoutMs: number,
  ) {
    super(`agent ${agentId} did not settle within ${timeoutMs} ms`);
    this.name = "WaitForIdleTimeoutError";
  }
}

/** The connection closed before the agent settled; whether it settled is unknown. */
export class WaitForIdleConnectionClosedError extends Error {
  constructor(readonly agentId: string) {
    super(`the connection closed while waiting for agent ${agentId}`);
    this.name = "WaitForIdleConnectionClosedError";
  }
}

/** One entry of a `list_agents_response` (an untyped RPC: the wire has no schema for it). */
interface ListedAgent {
  agentId?: string;
  status?: string;
}

interface ListAgentsAnswer {
  agents?: readonly ListedAgent[];
}

/** A status that ends a wait (`idle`, `error`, `closed`); `running`, `initializing` and anything
 *  else does not. */
export function settledStatusOf(status: string | undefined): AgentSettledStatus | null {
  return status === "idle" || status === "error" || status === "closed" ? status : null;
}

/** What one inbound session message says about a wait on `agentId`: its turn's `agent_update`, or
 *  its archive or delete notice. Everything else, and every other agent's messages, say nothing. */
export function settledByMessage(
  agentId: string,
  message: SessionMessage,
): AgentSettledStatus | null {
  switch (message.type) {
    case "agent_update":
      return message.agentId === agentId ? settledStatusOf(message.status) : null;
    case "agent_archived":
    case "agent_deleted":
      return message.agentId === agentId ? "closed" : null;
    default:
      return null;
  }
}

/** What the daemon's agent listing says about a wait on `agentId`. The listing leaves out archived
 *  agents, so an agent that is not in it is gone (`closed`). */
export function settledByListing(
  agentId: string,
  agents: readonly ListedAgent[],
): AgentSettledStatus | null {
  const listed = agents.find((agent) => agent.agentId === agentId);
  return listed ? settledStatusOf(listed.status) : "closed";
}

function abortError(): DOMException {
  return new DOMException("The wait for the agent was aborted", "AbortError");
}

/**
 * Resolves when `agentId` is not `running` or `initializing` (now, or when its next
 * `agent_update` says so). Subscribes to the session stream BEFORE it reads the agent's current
 * status, so a settle that lands while the read is in flight is not missed; whichever of the two
 * says "settled" first wins, and the other is ignored. Rejects on timeout, abort, and a closed
 * connection; every listener and the timer are gone once it settles.
 */
export function waitForAgentIdle(
  daemon: DaemonClient,
  agentId: string,
  opts: WaitForIdleOptions = {},
): Promise<WaitForIdleResult> {
  const { timeoutMs, signal } = opts;
  if (signal?.aborted) return Promise.reject(abortError());
  if (daemon.state === "closed") {
    return Promise.reject(new WaitForIdleConnectionClosedError(agentId));
  }

  return new Promise<WaitForIdleResult>((resolve, reject) => {
    const cleanups: Array<() => void> = [];
    let done = false;
    const settle = (outcome: () => void): void => {
      if (done) return;
      done = true;
      for (const cleanup of cleanups) cleanup();
      outcome();
    };

    cleanups.push(
      daemon.onSessionMessage((message) => {
        const status = settledByMessage(agentId, message);
        if (status) settle(() => resolve({ status }));
      }),
      daemon.onStateChange((state) => {
        if (state === "closed") {
          settle(() => reject(new WaitForIdleConnectionClosedError(agentId)));
        }
      }),
    );
    if (signal) {
      const onAbort = (): void => settle(() => reject(abortError()));
      signal.addEventListener("abort", onAbort, { once: true });
      cleanups.push(() => signal.removeEventListener("abort", onAbort));
    }
    if (timeoutMs !== undefined && timeoutMs > 0) {
      const timer = setTimeout(
        () => settle(() => reject(new WaitForIdleTimeoutError(agentId, timeoutMs))),
        timeoutMs,
      );
      cleanups.push(() => clearTimeout(timer));
    }

    daemon.request<ListAgentsAnswer>("list_agents_request").then(
      (answer) => {
        const status = settledByListing(agentId, answer.agents ?? []);
        if (status) settle(() => resolve({ status }));
      },
      (error: unknown) => settle(() => reject(error)),
    );
  });
}
