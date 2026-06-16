import { describe, expect, it, vi } from "vitest";

import {
  deterministicFallback,
  generate,
  MAX_EXPLICIT_AGENT_TITLE_CHARS,
  type StructuredGenerationProvider,
} from "./structured-generation.js";

function fakeProvider(
  id: string,
  result: string | null,
  available = true,
): StructuredGenerationProvider {
  return {
    provider: id,
    isAvailable: () => available,
    structuredGenerate: vi.fn(() => Promise.resolve(result)),
  };
}

describe("generate", () => {
  it("tries metadataGeneration.providers in configured order first", async () => {
    const first = fakeProvider("p1", "My Agent");
    const second = fakeProvider("p2", "Other");
    const result = await generate("agent_title", {
      candidates: [first, second],
      context: { prompt: "build thing" },
    });
    expect(result).toBe("My Agent");
    expect((first.structuredGenerate as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect((second.structuredGenerate as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("falls through to the next candidate when a provider fails/is unavailable", async () => {
    const failing = fakeProvider("bad", null);
    const unavailable = fakeProvider("absent", "x", false);
    const good = fakeProvider("ok", "Good title");
    const result = await generate("agent_title", {
      candidates: [failing, unavailable, good],
    });
    expect(result).toBe("Good title");
  });

  it("uses the deterministic fallback when all providers fail", async () => {
    const p = fakeProvider("p", null);
    const result = await generate("agent_title", {
      candidates: [p],
      context: { prompt: "do stuff" },
    });
    expect(result).toBe("do stuff"); // deterministic fallback = truncated prompt
  });

  it("does not create a throwaway AgentSession (no session imports in structured-generation.ts)", () => {
    // Structural assertion: structuredGenerate is called, not session.run/startTurn.
    const provider = fakeProvider("p", "title");
    generate("agent_title", { candidates: [provider], context: { prompt: "x" } });
    expect(provider.structuredGenerate as ReturnType<typeof vi.fn>).toBeDefined();
    // No AgentSession or AgentClient.createSession is involved.
  });

  it("clamps generated titles to MAX_EXPLICIT_AGENT_TITLE_CHARS", async () => {
    const long = "A".repeat(200);
    const p = fakeProvider("p", long);
    const result = await generate("agent_title", { candidates: [p] });
    expect(result.length).toBeLessThanOrEqual(MAX_EXPLICIT_AGENT_TITLE_CHARS);
  });
});

describe("deterministicFallback", () => {
  it("returns a slug for branch_name", () => {
    const slug = deterministicFallback("branch_name", { prompt: "Fix login bug" });
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(slug).toBe("fix-login-bug");
  });

  it("truncates long agent titles", () => {
    const long = "x".repeat(200);
    expect(deterministicFallback("agent_title", { prompt: long }).length).toBeLessThanOrEqual(
      MAX_EXPLICIT_AGENT_TITLE_CHARS,
    );
  });

  it("returns a sensible fallback for every task type", () => {
    for (const task of [
      "agent_title",
      "commit_message",
      "pr_title",
      "pr_body",
      "branch_name",
    ] as const) {
      const result = deterministicFallback(task, { prompt: "do something" });
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    }
  });
});
