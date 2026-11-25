/**
 * Sending a prompt from the composer (the Send path; steering stays in `Composer.tsx`).
 *
 * The daemon answers `send_agent_prompt` as soon as it has ACCEPTED the prompt: the agent exists,
 * its busy claim is taken, its status is `running`. The turn then runs on after the answer and
 * reports through the agent's stream (`turn_*` rows) and exactly one `agent_update` (`idle` or
 * `error`). So the request is short, and the composer's `sending` flag covers only it:
 *
 * - **Accepted:** the session is `running` from the answer until its turn ends
 *   (`lib/agent-status.ts`'s `accepted` signal). The end is the turn's one `agent_update`, not a
 *   `turn_*` row: the daemon refuses a send until that update has gone out. A running session
 *   offers Steer, not Send, so a second send cannot slip in between the answer and the turn's
 *   first event, or between the turn's last row and its end.
 * - **Refused** (`busy`, an unknown agent, a connection lost before the answer, or the draft could
 *   not be materialized): nothing was started. The optimistic row is marked failed and the reason
 *   is shown in a toast. The status is left as it was.
 *
 * A turn that fails after acceptance (Pi cannot start, no credential, the provider refuses the
 * prompt) is not a refusal: it ends as a `turn_failed` row carrying the reason, which the timeline
 * renders as an error row, and an `agent_update error`.
 *
 * Kept out of `Composer.tsx` so the flow runs against the stores and a fake client in a unit test
 * (this project does not render components under test).
 */

import type { PiStudioClient } from "@av-pi-studio/client";
import { useToastStore } from "@av-pi-studio/ui-library";
import { ensureMaterialized } from "../../stores/materialize.js";
import { useSessionStore } from "../../stores/session-store.js";

/** The toast text when a failure carries no readable message. */
export const SEND_FAILED_TOAST = "Couldn't send the message. Try again.";

/** `busy: agent <id> <reason>` — the daemon's refusal of a send while the agent is occupied. */
const BUSY_REFUSAL = /^busy: agent \S+ (.+)$/;

/**
 * The toast for a refused send. The daemon's own reason is shown: a busy refusal reads
 * "the agent is running" (or compacting, or changing its session) without the agent's id, any other
 * message is shown as it came (`unknown agent: …`, `socket closed: …`).
 */
export function sendFailureToast(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (!message) return SEND_FAILED_TOAST;
  const busy = BUSY_REFUSAL.exec(message);
  return busy ? `Couldn't send: the agent ${busy[1]}.` : `Couldn't send: ${message}`;
}

export interface SendPromptArgs {
  sessionId: string;
  prompt: string;
  /** Round-tripped to the daemon, which echoes it as the `user_message` event's `messageId`. */
  clientMessageId: string;
  images?: Array<{ mimeType: string; data: string }>;
}

/**
 * Materialize the session's draft if it has no agent yet, send the prompt, and record the outcome:
 * `running` when accepted, a failed row and a toast when refused. Never rejects.
 */
export async function sendPrompt(
  client: PiStudioClient,
  { sessionId, prompt, clientMessageId, images }: SendPromptArgs,
): Promise<void> {
  const session = useSessionStore.getState().sessions[sessionId];
  if (!session) return;
  try {
    if (!session.agentId) useSessionStore.getState().setCwd(sessionId, session.cwd || "~");
    // Retry path for a session whose eager materialize (`tab-store.ts` `openNewChat`) never ran or
    // failed — a no-op once already bound. `useAgentStream` attaches the instant `agentId` is
    // bound, before this turn's first event can arrive.
    const agentId = await ensureMaterialized(client, sessionId);
    await client.agent(agentId).send(prompt, { clientMessageId, images });
  } catch (error) {
    // A pending row only: one the daemon already confirmed (it accepted the prompt after all and
    // its `user_message` arrived) is not turned back into a failure.
    useSessionStore.getState().markUserMessageFailed(sessionId, clientMessageId);
    useToastStore.getState().error(sendFailureToast(error));
    return;
  }
  useSessionStore.getState().applyStatusSignal(sessionId, { source: "accepted" });
}
