import { describe, expect, it } from "vitest";
import type { AgentStatus, AgentStreamEvent } from "@av-pi-studio/protocol";
import { nextAgentStatus, type StatusSignal } from "./agent-status.js";

const stream = (event: AgentStreamEvent): StatusSignal => ({ source: "stream", event });
const update = (status: string | undefined): StatusSignal => ({ source: "update", status });
const accepted: StatusSignal = { source: "accepted" };

/** The status after each signal in turn, starting from `idle` (an agent between turns). */
function trace(signals: StatusSignal[], start: AgentStatus = "idle"): AgentStatus[] {
  const seen: AgentStatus[] = [];
  let status = start;
  for (const signal of signals) {
    status = nextAgentStatus(status, signal);
    seen.push(status);
  }
  return seen;
}

describe("nextAgentStatus — a normal turn", () => {
  it("is running from the accepted send and idle only on the agent_update that ends the turn", () => {
    expect(
      trace([
        accepted,
        update("running"),
        stream({ kind: "user_message", text: "hi" }),
        stream({ kind: "turn_started" }),
        stream({ kind: "assistant_message", text: "hello" }),
        stream({ kind: "turn_completed" }),
        update("idle"),
      ]),
    ).toEqual(["running", "running", "running", "running", "running", "running", "idle"]);
  });

  it("stays running after turn_completed until the agent_update idle", () => {
    // The daemon still holds the agent's busy claim between the last row and its agent_update:
    // idle here would offer a Send that is refused as busy.
    expect(nextAgentStatus("running", stream({ kind: "turn_completed" }))).toBe("running");
    expect(nextAgentStatus("running", update("idle"))).toBe("idle");
  });

  it("stays running through events that say nothing about status", () => {
    const quiet: AgentStreamEvent[] = [
      { kind: "assistant_message", text: "x" },
      { kind: "reasoning", text: "y" },
      { kind: "queue_update", steering: ["more"] },
      { kind: "error", message: "a tool failed" },
      { kind: "compaction", compactionId: "c1", phase: "failed", error: "no" },
    ];
    for (const event of quiet) expect(nextAgentStatus("running", stream(event))).toBe("running");
  });

  it("a turn_started marks a running turn a client missed the update for", () => {
    expect(nextAgentStatus("idle", stream({ kind: "turn_started" }))).toBe("running");
  });
});

describe("nextAgentStatus — a slash command an extension handles inline", () => {
  it("goes running then idle on the agent_update pair alone, with no turn_* row", () => {
    expect(
      trace([
        accepted,
        update("running"),
        stream({ kind: "user_message", text: "/ext-command" }),
        update("idle"),
      ]),
    ).toEqual(["running", "running", "running", "idle"]);
  });
});

describe("nextAgentStatus — a failure before the turn starts", () => {
  it("stays running through turn_failed and ends error on the agent_update after it", () => {
    expect(
      trace([
        accepted,
        update("running"),
        stream({ kind: "user_message", text: "hi" }),
        stream({ kind: "turn_failed", error: "401 no credential" }),
        update("error"),
      ]),
    ).toEqual(["running", "running", "running", "running", "error"]);
  });

  it("ends error on the agent_update alone when no turn_failed row was written", () => {
    expect(trace([accepted, update("running"), update("error")])).toEqual([
      "running",
      "running",
      "error",
    ]);
  });

  it("leaves error for running on the next accepted send", () => {
    expect(nextAgentStatus("error", accepted)).toBe("running");
  });
});

describe("nextAgentStatus — a cancel", () => {
  it("stays running through turn_canceled and ends idle on the agent_update after it", () => {
    expect(
      trace([
        accepted,
        update("running"),
        stream({ kind: "turn_started" }),
        stream({ kind: "turn_canceled" }),
        update("idle"),
      ]),
    ).toEqual(["running", "running", "running", "running", "idle"]);
  });
});

describe("nextAgentStatus — what an agent_update does not say", () => {
  it("ignores initializing, closed, an unknown word and an absent status", () => {
    for (const status of ["initializing", "closed", "paused", undefined]) {
      expect(nextAgentStatus("running", update(status))).toBe("running");
      expect(nextAgentStatus("idle", update(status))).toBe("idle");
    }
  });

  it("applies a settle from another window's turn the same way", () => {
    expect(trace([update("running"), update("idle")])).toEqual(["running", "idle"]);
  });
});
