import { describe, expect, it } from "vitest";
import { createFirstTurnGate } from "./agent-stream-events.js";

describe("createFirstTurnGate", () => {
  it("ignores frames from an unrelated agent already streaming on the same socket", () => {
    // Reproduces the reported bug: session A's agent is mid-turn (broadcasting on the shared
    // socket) while session B starts a brand-new turn. Session B's gate must never latch onto
    // A's agentId just because A's frame happens to arrive first.
    const gate = createFirstTurnGate("cm-b");

    expect(
      gate({ agentId: "agent-a", event: { kind: "assistant_message", text: "from session A" } }),
    ).toBe(false);
    expect(gate({ agentId: "agent-a", event: { kind: "reasoning", text: "still A" } })).toBe(false);
  });

  it("latches onto the agentId carried by its own user_message echo", () => {
    const gate = createFirstTurnGate("cm-b");

    // Unrelated interleaved traffic from session A, ignored.
    gate({ agentId: "agent-a", event: { kind: "assistant_message", text: "from session A" } });

    // Our own canonical echo (messageId === clientMessageId) latches agent-b.
    expect(
      gate({ agentId: "agent-b", event: { kind: "user_message", messageId: "cm-b", text: "hi" } }),
    ).toBe(true);

    // Session A keeps streaming concurrently — still rejected after latching.
    expect(gate({ agentId: "agent-a", event: { kind: "assistant_message", text: "more A" } })).toBe(
      false,
    );

    // Session B's own follow-up frames are accepted.
    expect(
      gate({ agentId: "agent-b", event: { kind: "assistant_message", text: "from session B" } }),
    ).toBe(true);
  });

  it("never latches onto a user_message echo carrying a different clientMessageId", () => {
    const gate = createFirstTurnGate("cm-b");

    // Session A's own user_message echo (its own clientMessageId) must not latch us onto A.
    expect(
      gate({ agentId: "agent-a", event: { kind: "user_message", messageId: "cm-a", text: "hi" } }),
    ).toBe(false);

    // Our real echo still latches correctly afterwards.
    expect(
      gate({ agentId: "agent-b", event: { kind: "user_message", messageId: "cm-b", text: "hi" } }),
    ).toBe(true);
  });
});
