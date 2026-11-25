/**
 * The one rule that decides an agent's status in the workbench. Three things report on it, and the
 * answer is whichever reported last:
 *
 * - **`update`**: the `status` of an `agent_update` broadcast. Only `running`, `idle` and `error`
 *   count: `initializing` and `closed` describe the agent's life, not a turn, and an `agent_update`
 *   without a status (a title or model change) leaves it alone. This is the ONLY thing that ends a
 *   turn. The daemon sends `agent_update running` when it accepts a prompt and exactly one
 *   `idle` or `error` after the turn's last row, on the same socket, so it always comes after
 *   every event of the turn and carries every kind of ending: a completed or canceled turn
 *   (`idle`), a turn that failed (`turn_failed` row, then `error`), a failure before the turn
 *   started, and a prompt an extension handled inline, which leaves no `turn_*` row at all.
 * - **`stream`**: an event on the agent's timeline stream. Only `turn_started` speaks of status
 *   (`running`). `turn_completed`, `turn_canceled` and `turn_failed` do NOT end the turn here: the
 *   daemon still holds the agent's busy claim until its `agent_update` goes out, so a session shown
 *   idle in that gap would offer a Send that is refused as busy. `turn_failed` still draws its
 *   reason as an error row in the timeline (`timeline/reducer.ts`).
 * - **`accepted`**: the daemon answered a `send_agent_prompt`. From that answer on the agent is
 *   `running` until its turn ends, even before the first event arrives. The daemon sends nothing of
 *   a turn before the answer to the prompt that started it, so applying this on arrival can never
 *   override that turn's own end.
 *
 * `stream` and `update` arrive in order on the one socket, so applying them in arrival order is
 * correct and needs no sequence numbers. A reconnect does not use this rule: the status comes from
 * the daemon's agent list (`use-session-resync.ts`).
 */

import type { AgentStatus, AgentStreamEvent } from "@av-pi-studio/protocol";

export type StatusSignal =
  | { source: "stream"; event: AgentStreamEvent }
  | { source: "update"; status: string | undefined }
  | { source: "accepted" };

/** The status after `signal`; `current` when the signal does not speak of a turn. */
export function nextAgentStatus(current: AgentStatus, signal: StatusSignal): AgentStatus {
  switch (signal.source) {
    case "accepted":
      return "running";
    case "update":
      return signal.status === "running" || signal.status === "idle" || signal.status === "error"
        ? signal.status
        : current;
    case "stream":
      return signal.event.kind === "turn_started" ? "running" : current;
  }
}
