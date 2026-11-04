import type { AgentStreamEvent } from "@av-pi-studio/protocol";
import { describe, expect, it } from "vitest";

import {
  PARTIAL_MIN_INTERVAL_MS,
  PARTIAL_OUTPUT_CAP_BYTES,
  createToolOutputCoalescer,
} from "./tool-output-coalescer.js";
import type { ToolOutputCoalescer } from "./tool-output-coalescer.js";

interface Timer {
  at: number;
  callback: () => void;
  canceled: boolean;
}

/** Deterministic clock + timer queue; `advance` fires due timers in order at their own time. */
function createHarness(): {
  coalescer: ToolOutputCoalescer;
  delivered: AgentStreamEvent[];
  advance: (ms: number) => void;
  timers: Timer[];
} {
  let time = 1_000;
  const timers: Timer[] = [];
  const delivered: AgentStreamEvent[] = [];
  const coalescer = createToolOutputCoalescer({
    deliver: (event) => delivered.push(event),
    now: () => time,
    schedule: (callback, delayMs) => {
      const timer: Timer = { at: time + delayMs, callback, canceled: false };
      timers.push(timer);
      return () => {
        timer.canceled = true;
      };
    },
  });
  const advance = (ms: number): void => {
    const target = time + ms;
    for (;;) {
      const due = timers
        .filter((t) => !t.canceled && t.at <= target)
        .toSorted((a, b) => a.at - b.at)[0];
      if (!due) break;
      due.canceled = true;
      time = Math.max(time, due.at);
      due.callback();
    }
    time = target;
  };
  return { coalescer, delivered, advance, timers };
}

function partial(callId: string | undefined, output: string | undefined): AgentStreamEvent {
  return {
    kind: "tool_call",
    callId,
    tool: { kind: "shell", command: "make", output },
    status: "running",
    partial: true,
  };
}

function terminal(callId: string | undefined, output?: string): AgentStreamEvent {
  return {
    kind: "tool_call",
    callId,
    tool: { kind: "shell", command: "make", output },
    status: "completed",
  };
}

function outputs(events: AgentStreamEvent[]): (string | undefined)[] {
  return events.map((e) => (e.kind === "tool_call" ? e.tool.output : undefined));
}

describe("tool output coalescer", () => {
  it("emits the leading partial and one trailing flush carrying the latest snapshot", () => {
    const { coalescer, delivered, advance, timers } = createHarness();
    for (let i = 1; i <= 10; i++) {
      expect(coalescer.accept(partial("c1", `snap-${i}`))).toBe(true);
      advance(10);
    }
    expect(outputs(delivered)).toEqual(["snap-1"]);
    expect(timers).toHaveLength(1);
    advance(PARTIAL_MIN_INTERVAL_MS);
    expect(outputs(delivered)).toEqual(["snap-1", "snap-10"]);
    advance(PARTIAL_MIN_INTERVAL_MS * 5);
    expect(delivered).toHaveLength(2);
  });

  it("emits partials spaced by the interval immediately, with no trailing duplicates", () => {
    const { coalescer, delivered, advance, timers } = createHarness();
    for (const text of ["a", "b", "c"]) {
      coalescer.accept(partial("c1", text));
      advance(PARTIAL_MIN_INTERVAL_MS);
    }
    expect(outputs(delivered)).toEqual(["a", "b", "c"]);
    expect(timers).toHaveLength(0);
  });

  it("spaces the trailing flush from the last emit, not from the partial's arrival", () => {
    const { coalescer, delivered, advance } = createHarness();
    coalescer.accept(partial("c1", "a"));
    advance(150);
    coalescer.accept(partial("c1", "b"));
    advance(49);
    expect(delivered).toHaveLength(1);
    advance(1);
    expect(outputs(delivered)).toEqual(["a", "b"]);
  });

  it("emits nothing after the call's terminal event (flush race)", () => {
    const { coalescer, delivered, advance } = createHarness();
    coalescer.accept(partial("c1", "a"));
    coalescer.accept(partial("c1", "b"));
    expect(coalescer.accept(terminal("c1", "final"))).toBe(false);
    advance(PARTIAL_MIN_INTERVAL_MS * 3);
    expect(outputs(delivered)).toEqual(["a"]);
  });

  it("cancels pending partials on a start or started event for the same call", () => {
    const { coalescer, delivered, advance } = createHarness();
    coalescer.accept(partial("c1", "a"));
    coalescer.accept(partial("c1", "b"));
    expect(
      coalescer.accept({
        kind: "tool_call",
        callId: "c1",
        tool: { kind: "shell", command: "make" },
        status: "started",
      }),
    ).toBe(false);
    advance(PARTIAL_MIN_INTERVAL_MS * 3);
    expect(outputs(delivered)).toEqual(["a"]);
  });

  it("throttles callIds (including a nested id) independently", () => {
    const { coalescer, delivered, advance } = createHarness();
    coalescer.accept(partial("p", "p1"));
    coalescer.accept(partial("p", "p2"));
    coalescer.accept(partial("p/1", "n1"));
    expect(outputs(delivered)).toEqual(["p1", "n1"]);
    coalescer.accept(partial("p/1", "n2"));
    // Terminal of one call leaves the other's trailing flush alone.
    coalescer.accept(terminal("p/1", "n-final"));
    advance(PARTIAL_MIN_INTERVAL_MS);
    expect(outputs(delivered)).toEqual(["p1", "n1", "p2"]);
  });

  it.each(["turn_completed", "turn_failed", "turn_canceled"] as const)(
    "%s cancels every pending flush",
    (kind) => {
      const { coalescer, delivered, advance } = createHarness();
      coalescer.accept(partial("a", "a1"));
      coalescer.accept(partial("a", "a2"));
      coalescer.accept(partial("b", "b1"));
      coalescer.accept(partial("b", "b2"));
      const event: AgentStreamEvent =
        kind === "turn_failed" ? { kind, error: "boom" } : ({ kind } as AgentStreamEvent);
      expect(coalescer.accept(event)).toBe(false);
      advance(PARTIAL_MIN_INTERVAL_MS * 3);
      expect(outputs(delivered)).toEqual(["a1", "b1"]);
    },
  );

  it("cancelAll (session close) cancels pending flushes", () => {
    const { coalescer, delivered, advance } = createHarness();
    coalescer.accept(partial("a", "a1"));
    coalescer.accept(partial("a", "a2"));
    coalescer.cancelAll();
    advance(PARTIAL_MIN_INTERVAL_MS * 3);
    expect(outputs(delivered)).toEqual(["a1"]);
  });

  it("hands non-tool events back untouched", () => {
    const { coalescer, delivered } = createHarness();
    expect(coalescer.accept({ kind: "turn_started" } as AgentStreamEvent)).toBe(false);
    expect(delivered).toHaveLength(0);
  });

  it("passes partials without output through (bash's initial empty update)", () => {
    const { coalescer, delivered } = createHarness();
    coalescer.accept(partial("c1", undefined));
    expect(delivered).toHaveLength(1);
  });

  it("tail-caps a partial to its last 64 KiB; terminal output stays uncapped", () => {
    const { coalescer, delivered } = createHarness();
    const big = `${"h".repeat(1000)}${"x".repeat(PARTIAL_OUTPUT_CAP_BYTES)}`;
    coalescer.accept(partial("c1", big));
    const emitted = outputs(delivered)[0] ?? "";
    expect(Buffer.byteLength(emitted)).toBe(PARTIAL_OUTPUT_CAP_BYTES);
    expect(emitted).toBe(big.slice(-PARTIAL_OUTPUT_CAP_BYTES));

    const huge = "y".repeat(PARTIAL_OUTPUT_CAP_BYTES * 2);
    // Terminal events are handed back to the caller verbatim, never rewritten here.
    const end = terminal("c1", huge);
    expect(coalescer.accept(end)).toBe(false);
    expect(end.kind === "tool_call" && end.tool.output).toBe(huge);
  });

  it("cuts the tail on a character boundary", () => {
    const { coalescer, delivered } = createHarness();
    // 3-byte chars: the byte cap lands mid-character, so the cut must move forward.
    const text = "€".repeat(PARTIAL_OUTPUT_CAP_BYTES);
    coalescer.accept(partial("c1", text));
    const emitted = outputs(delivered)[0] ?? "";
    expect(emitted).not.toContain("\uFFFD");
    expect(Buffer.byteLength(emitted)).toBeLessThanOrEqual(PARTIAL_OUTPUT_CAP_BYTES);
    expect(Buffer.byteLength(emitted)).toBeGreaterThan(PARTIAL_OUTPUT_CAP_BYTES - 3);
    expect(emitted).toBe("€".repeat(emitted.length));
    // Astral (4-byte) characters too.
    const astral = "😀".repeat(PARTIAL_OUTPUT_CAP_BYTES);
    const h2 = createHarness();
    h2.coalescer.accept(partial("c2", astral));
    const out2 = outputs(h2.delivered)[0] ?? "";
    expect(out2).not.toContain("\uFFFD");
    expect(out2).toBe("😀".repeat(out2.length / 2));
  });
});
