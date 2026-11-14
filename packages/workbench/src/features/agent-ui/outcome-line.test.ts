import { describe, expect, it } from "vitest";
import type { AgentUiResolvedEntry } from "@av-pi-studio/client";
import { outcomeLine } from "./outcome-line.js";

function resolved(overrides: Partial<AgentUiResolvedEntry> = {}): AgentUiResolvedEntry {
  return {
    requestId: "req-1",
    agentId: "agent-1",
    method: "confirm",
    payload: {},
    createdAt: 1,
    reason: "answered",
    ...overrides,
  };
}

describe("outcomeLine", () => {
  it("select answered here: the chosen option verbatim, success tone, truncatable", () => {
    const line = outcomeLine(
      resolved({
        method: "select",
        answer: { value: "Allow this extension to modify /etc/hosts?" },
      }),
    );
    expect(line).toEqual({
      tone: "success",
      glyph: "check",
      text: "Allow this extension to modify /etc/hosts?",
      truncate: true,
    });
  });

  it("select answered elsewhere (no local answer): no longer pending, muted, no glyph", () => {
    const line = outcomeLine(resolved({ method: "select" }));
    expect(line).toEqual({
      tone: "muted",
      glyph: null,
      text: "no longer pending",
      truncate: false,
    });
  });

  it("confirm answered yes here: success, fixed 'Yes' text, never truncated", () => {
    const line = outcomeLine(resolved({ method: "confirm", answer: { confirmed: true } }));
    expect(line).toEqual({ tone: "success", glyph: "check", text: "Yes", truncate: false });
  });

  it("confirm answered no here: declined, muted, no glyph — same copy as a cancellation", () => {
    const line = outcomeLine(resolved({ method: "confirm", answer: { confirmed: false } }));
    expect(line).toEqual({ tone: "muted", glyph: null, text: "declined", truncate: false });
  });

  it("confirm answered elsewhere (no local answer): no longer pending", () => {
    const line = outcomeLine(resolved({ method: "confirm" }));
    expect(line).toEqual({
      tone: "muted",
      glyph: null,
      text: "no longer pending",
      truncate: false,
    });
  });

  it("input answered — by ANY client — never echoes the typed value, even a secret-looking one", () => {
    const line = outcomeLine(
      resolved({
        method: "input",
        // The SDK never actually populates `answer` for input/editor, but this module must not
        // reach into `payload` either — prove it feeds a secret-looking payload and asserts it
        // appears nowhere in the output.
        payload: { title: "Enter your API token", secret: "sk-live-super-secret-token-value" },
      }),
    );
    expect(line).toEqual({ tone: "success", glyph: "check", text: "answered", truncate: false });
    expect(JSON.stringify(line)).not.toContain("sk-live-super-secret-token-value");
  });

  it("editor answered never echoes the typed value, not even a first line", () => {
    const line = outcomeLine(
      resolved({ method: "editor", payload: { prefill: "the actual secret commit message" } }),
    );
    expect(line).toEqual({ tone: "success", glyph: "check", text: "submitted", truncate: false });
    expect(JSON.stringify(line)).not.toContain("the actual secret commit message");
  });

  it("cancelled: declined, muted, no glyph — identical copy to a confirm 'no'", () => {
    expect(outcomeLine(resolved({ method: "select", reason: "cancelled" }))).toEqual({
      tone: "muted",
      glyph: null,
      text: "declined",
      truncate: false,
    });
  });

  it("timeout: plain 'expired', never claims which default the extension acted on", () => {
    expect(outcomeLine(resolved({ method: "input", reason: "timeout" }))).toEqual({
      tone: "muted",
      glyph: null,
      text: "expired",
      truncate: false,
    });
  });

  it("an unrecognised reason is printed verbatim in the muted tone, never relabelled", () => {
    expect(outcomeLine(resolved({ reason: "aborted" }))).toEqual({
      tone: "muted",
      glyph: null,
      text: "aborted",
      truncate: false,
    });
    expect(outcomeLine(resolved({ reason: "some-future-reason" }))).toEqual({
      tone: "muted",
      glyph: null,
      text: "some-future-reason",
      truncate: false,
    });
  });

  it("an unrecognised method that got answered falls back to a neutral confirmation, never a value", () => {
    const line = outcomeLine(resolved({ method: "pickRange", reason: "answered" }));
    expect(line).toEqual({ tone: "success", glyph: "check", text: "answered", truncate: false });
  });
});
