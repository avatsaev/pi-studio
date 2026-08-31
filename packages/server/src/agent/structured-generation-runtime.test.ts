import { describe, expect, it, vi } from "vitest";

/**
 * `structured-generation-runtime.ts` tests. Two concerns, kept separate:
 * - `parseTitleMarker`: pure string parsing, no mocking.
 * - `createAgentTitleGenerator`: candidate resolution/fallthrough + the deterministic-vs-decline
 *   split, against a mocked `ModelRuntime` (same `vi.mock` pattern as
 *   `provider-auth/pi-auth-runtime.test.ts` — never the real Pi auth engine).
 */

const mockCreate = vi.fn();

vi.mock("@earendil-works/pi-coding-agent", () => ({
  ModelRuntime: { create: mockCreate },
}));

const { createAgentTitleGenerator, parseTitleMarker } =
  await import("./structured-generation-runtime.js");

function fakeModel(id = "m1") {
  return { id };
}

function fakeRuntime(overrides: Record<string, unknown> = {}) {
  return {
    getProviderAuthStatus: () => ({ configured: true }),
    getModel: (_provider: string, modelId: string) => fakeModel(modelId),
    getModels: () => [fakeModel()],
    completeSimple: async () => ({
      role: "assistant",
      content: [{ type: "text", text: "<title>Fix login bug</title>" }],
      stopReason: "stop",
    }),
    ...overrides,
  };
}

// ─── parseTitleMarker ────────────────────────────────────────────────────────────

describe("parseTitleMarker", () => {
  it("extracts a closed tag", () => {
    expect(parseTitleMarker("<title>Fix login button on mobile</title>")).toEqual({
      kind: "title",
      title: "Fix login button on mobile",
    });
  });

  it("returns decline for the self-closing marker", () => {
    expect(parseTitleMarker("<title/>")).toEqual({ kind: "decline" });
    expect(parseTitleMarker("<title />")).toEqual({ kind: "decline" });
  });

  it("tolerates a tag left unclosed (backend hit maxTokens)", () => {
    expect(parseTitleMarker("<title>Fix login button on mobile")).toEqual({
      kind: "title",
      title: "Fix login button on mobile",
    });
  });

  it("strips a leaked <think> envelope before matching", () => {
    expect(
      parseTitleMarker("<think>the user wants a fix</think><title>Fix login bug</title>"),
    ).toEqual({ kind: "title", title: "Fix login bug" });
  });

  it("returns missing (not decline) when no marker is present at all", () => {
    expect(parseTitleMarker("I can help with that.")).toEqual({ kind: "missing" });
  });

  it("returns missing when an unclosed <think> envelope consumed the whole output", () => {
    expect(parseTitleMarker("<think>hmm, what is the user even asking")).toEqual({
      kind: "missing",
    });
  });

  it("treats an empty closed tag as a decline", () => {
    expect(parseTitleMarker("<title></title>")).toEqual({ kind: "decline" });
  });
});

// ─── createAgentTitleGenerator ───────────────────────────────────────────────────

describe("createAgentTitleGenerator — no candidates", () => {
  it("returns the deterministic fallback without ever constructing a ModelRuntime", async () => {
    mockCreate.mockClear();
    const generate = createAgentTitleGenerator({}, []);
    const title = await generate({ prompt: "add dark mode toggle to settings" });
    expect(title).toBe("add dark mode toggle to settings");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns null for an empty/whitespace-only prompt without constructing a ModelRuntime", async () => {
    mockCreate.mockClear();
    const generate = createAgentTitleGenerator({}, [{ provider: "anthropic" }]);
    expect(await generate({ prompt: "   " })).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("createAgentTitleGenerator — configured candidates", () => {
  it("uses the first configured candidate's title, clamped", async () => {
    mockCreate.mockClear();
    mockCreate.mockResolvedValue(fakeRuntime());
    const generate = createAgentTitleGenerator({}, [{ provider: "anthropic", model: "haiku" }]);
    const title = await generate({ prompt: "fix the login bug" });
    expect(title).toBe("Fix login bug");
  });

  it("falls through to the next candidate when one is unavailable (no configured auth)", async () => {
    mockCreate.mockClear();
    const getProviderAuthStatus = vi
      .fn()
      .mockImplementation((provider: string) => ({ configured: provider === "openai" }));
    mockCreate.mockResolvedValue(fakeRuntime({ getProviderAuthStatus }));
    const generate = createAgentTitleGenerator({}, [
      { provider: "anthropic" },
      { provider: "openai" },
    ]);
    const title = await generate({ prompt: "fix the login bug" });
    expect(title).toBe("Fix login bug");
    expect(getProviderAuthStatus).toHaveBeenCalledWith("anthropic");
    expect(getProviderAuthStatus).toHaveBeenCalledWith("openai");
  });

  it("falls through to the next candidate when completeSimple throws", async () => {
    mockCreate.mockClear();
    const completeSimple = vi
      .fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({
        role: "assistant",
        content: [{ type: "text", text: "<title>Fix login bug</title>" }],
        stopReason: "stop",
      });
    mockCreate.mockResolvedValue(fakeRuntime({ completeSimple }));
    const generate = createAgentTitleGenerator({}, [
      { provider: "anthropic" },
      { provider: "openai" },
    ]);
    const title = await generate({ prompt: "fix the login bug" });
    expect(title).toBe("Fix login bug");
    expect(completeSimple).toHaveBeenCalledTimes(2);
  });

  it("treats stopReason 'error' as a failed candidate, falling through", async () => {
    mockCreate.mockClear();
    const completeSimple = vi
      .fn()
      .mockResolvedValueOnce({ role: "assistant", content: [], stopReason: "error" })
      .mockResolvedValueOnce({
        role: "assistant",
        content: [{ type: "text", text: "<title>Fix login bug</title>" }],
        stopReason: "stop",
      });
    mockCreate.mockResolvedValue(fakeRuntime({ completeSimple }));
    const generate = createAgentTitleGenerator({}, [
      { provider: "anthropic" },
      { provider: "openai" },
    ]);
    expect(await generate({ prompt: "fix the login bug" })).toBe("Fix login bug");
  });

  it("clamps a long generated title to MAX_EXPLICIT_AGENT_TITLE_CHARS", async () => {
    mockCreate.mockClear();
    const long = "A".repeat(200);
    mockCreate.mockResolvedValue(
      fakeRuntime({
        completeSimple: async () => ({
          role: "assistant",
          content: [{ type: "text", text: `<title>${long}</title>` }],
          stopReason: "stop",
        }),
      }),
    );
    const generate = createAgentTitleGenerator({}, [{ provider: "anthropic" }]);
    const title = await generate({ prompt: "x" });
    expect(title).not.toBeNull();
    expect((title as string).length).toBeLessThanOrEqual(80);
  });

  it("requests TITLE_MAX_TOKENS (1024 — survives reasoning-leaky backends) with temperature 0", async () => {
    mockCreate.mockClear();
    const completeSimple = vi.fn().mockResolvedValue({
      role: "assistant",
      content: [{ type: "text", text: "<title>Fix login bug</title>" }],
      stopReason: "stop",
    });
    mockCreate.mockResolvedValue(fakeRuntime({ completeSimple }));
    const generate = createAgentTitleGenerator({}, [{ provider: "anthropic" }]);
    await generate({ prompt: "fix the login bug" });
    expect(completeSimple).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ maxTokens: 1024, temperature: 0 }),
    );
  });

  it("caps the prompt sent to the LLM at TITLE_INPUT_MAX_CHARS (a pasted-log first message never becomes a huge titling request)", async () => {
    mockCreate.mockClear();
    const completeSimple = vi.fn().mockResolvedValue({
      role: "assistant",
      content: [{ type: "text", text: "<title>Fix login bug</title>" }],
      stopReason: "stop",
    });
    mockCreate.mockResolvedValue(fakeRuntime({ completeSimple }));
    const generate = createAgentTitleGenerator({}, [{ provider: "anthropic" }]);
    await generate({ prompt: "x".repeat(100_000) });
    const sent = completeSimple.mock.calls[0]![1] as {
      messages: Array<{ content: string }>;
    };
    expect(sent.messages[0]!.content).toHaveLength(4000);
  });
});

describe("createAgentTitleGenerator — decline vs deterministic fallback", () => {
  it("returns null (not the deterministic fallback) when a real candidate exists but declines", async () => {
    mockCreate.mockClear();
    mockCreate.mockResolvedValue(
      fakeRuntime({
        completeSimple: async () => ({
          role: "assistant",
          content: [{ type: "text", text: "<title/>" }],
          stopReason: "stop",
        }),
      }),
    );
    const generate = createAgentTitleGenerator({}, [{ provider: "anthropic" }]);
    const title = await generate({ prompt: "hey" });
    expect(title).toBeNull();
  });

  it("falls back to the deterministic title (not null) when the only candidate is unavailable — regression: a provider configured purely via a static `models.json`-embedded key (a self-hosted/custom provider, e.g. a LiteLLM proxy) reads as unconfigured here and must never leave a session permanently untitled", async () => {
    mockCreate.mockClear();
    mockCreate.mockResolvedValue(
      fakeRuntime({ getProviderAuthStatus: () => ({ configured: false }) }),
    );
    const generate = createAgentTitleGenerator({}, [{ provider: "anthropic" }]);
    expect(await generate({ prompt: "fix the login bug" })).toBe("fix the login bug");
  });

  it("falls back to the deterministic title when the only candidate errors without ever running (never a bare null)", async () => {
    mockCreate.mockClear();
    mockCreate.mockResolvedValue(
      fakeRuntime({ completeSimple: async () => Promise.reject(new Error("network error")) }),
    );
    const generate = createAgentTitleGenerator({}, [{ provider: "anthropic" }]);
    expect(await generate({ prompt: "fix the login bug" })).toBe("fix the login bug");
  });

  it("still returns null (not the deterministic fallback) when one candidate errors but a later one actually declines", async () => {
    mockCreate.mockClear();
    const completeSimple = vi
      .fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({
        role: "assistant",
        content: [{ type: "text", text: "<title/>" }],
        stopReason: "stop",
      });
    mockCreate.mockResolvedValue(fakeRuntime({ completeSimple }));
    const generate = createAgentTitleGenerator({}, [
      { provider: "anthropic" },
      { provider: "openai" },
    ]);
    expect(await generate({ prompt: "hey" })).toBeNull();
  });

  it("falls back to the deterministic title when the response has no <title> marker at all (malformed is a failure, not a decline)", async () => {
    mockCreate.mockClear();
    mockCreate.mockResolvedValue(
      fakeRuntime({
        completeSimple: async () => ({
          role: "assistant",
          content: [{ type: "text", text: "Sure! A good title would be: Fix login bug." }],
          stopReason: "stop",
        }),
      }),
    );
    const generate = createAgentTitleGenerator({}, [{ provider: "anthropic" }]);
    expect(await generate({ prompt: "fix the login bug" })).toBe("fix the login bug");
  });

  it("falls back to the deterministic title when the candidate's provider resolves no model", async () => {
    mockCreate.mockClear();
    mockCreate.mockResolvedValue(fakeRuntime({ getModels: () => [] }));
    const generate = createAgentTitleGenerator({}, [{ provider: "anthropic" }]);
    expect(await generate({ prompt: "fix the login bug" })).toBe("fix the login bug");
  });
});

describe("createAgentTitleGenerator — agent's own model as fallback candidate", () => {
  it("uses the agent's own modelProvider/model when no configured candidates exist", async () => {
    mockCreate.mockClear();
    const getModel = vi.fn().mockReturnValue(fakeModel("claude-haiku"));
    mockCreate.mockResolvedValue(fakeRuntime({ getModel }));
    const generate = createAgentTitleGenerator({}, []);
    const title = await generate({
      modelProvider: "anthropic",
      model: "claude-haiku",
      prompt: "fix the login bug",
    });
    expect(title).toBe("Fix login bug");
    expect(getModel).toHaveBeenCalledWith("anthropic", "claude-haiku");
  });

  it("does not add a duplicate candidate when the agent's provider is already configured", async () => {
    mockCreate.mockClear();
    const completeSimple = vi.fn().mockResolvedValue({
      role: "assistant",
      content: [{ type: "text", text: "<title>Fix login bug</title>" }],
      stopReason: "stop",
    });
    mockCreate.mockResolvedValue(fakeRuntime({ completeSimple }));
    const generate = createAgentTitleGenerator({}, [{ provider: "anthropic", model: "opus" }]);
    await generate({ modelProvider: "anthropic", model: "haiku", prompt: "fix the login bug" });
    expect(completeSimple).toHaveBeenCalledTimes(1);
  });

  it("passes authPath/modelsPath/refreshOnCreate:false through to ModelRuntime.create", async () => {
    mockCreate.mockClear();
    mockCreate.mockResolvedValue(fakeRuntime());
    const generate = createAgentTitleGenerator(
      { authPath: "/x/auth.json", modelsPath: "/x/models.json" },
      [{ provider: "anthropic" }],
    );
    await generate({ prompt: "fix the login bug" });
    expect(mockCreate).toHaveBeenCalledWith({
      authPath: "/x/auth.json",
      modelsPath: "/x/models.json",
      refreshOnCreate: false,
    });
  });
});
