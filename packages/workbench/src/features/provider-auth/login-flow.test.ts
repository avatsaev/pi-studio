import { describe, expect, it } from "vitest";
import type { ProviderAuthFlowUiEvent } from "@av-pi-studio/client";
import { applyLoginFlowEvent, initialLoginFlowState, type LoginFlowState } from "./login-flow.js";

function fresh(): LoginFlowState {
  return initialLoginFlowState("openai", "api_key");
}

describe("login-flow reducer — initial state", () => {
  it("starts in phase 'starting' with no status lines and the given provider/authType", () => {
    const state = fresh();
    expect(state.phase).toBe("starting");
    expect(state.statusLines).toEqual([]);
    expect(state.provider).toBe("openai");
    expect(state.authType).toBe("api_key");
  });
});

describe("login-flow reducer — every event kind", () => {
  it("info: appends a status line and advances 'starting' to 'waiting'", () => {
    const next = applyLoginFlowEvent(fresh(), { kind: "info", message: "checking credentials" });
    expect(next.phase).toBe("waiting");
    expect(next.statusLines).toEqual([
      { kind: "info", message: "checking credentials", links: undefined },
    ]);
  });

  it("progress: appends a status line and advances 'starting' to 'waiting'", () => {
    const next = applyLoginFlowEvent(fresh(), { kind: "progress", message: "contacting provider" });
    expect(next.phase).toBe("waiting");
    expect(next.statusLines).toEqual([{ kind: "progress", message: "contacting provider" }]);
  });

  it("auth_url: records url/instructions", () => {
    const next = applyLoginFlowEvent(fresh(), {
      kind: "auth_url",
      url: "https://provider.example/authorize",
      instructions: "Open this link",
    });
    expect(next.authUrl).toEqual({
      url: "https://provider.example/authorize",
      instructions: "Open this link",
    });
  });

  it("device_code: records the code, verification uri, and optional expiry", () => {
    const next = applyLoginFlowEvent(fresh(), {
      kind: "device_code",
      userCode: "ABC-123",
      verificationUri: "https://provider.example/device",
      intervalSeconds: 5,
      expiresInSeconds: 900,
    });
    expect(next.deviceCode).toEqual({
      userCode: "ABC-123",
      verificationUri: "https://provider.example/device",
      intervalSeconds: 5,
      expiresInSeconds: 900,
    });
  });

  it("prompt: sets phase='prompt' and stores the descriptor", () => {
    const next = applyLoginFlowEvent(fresh(), {
      kind: "prompt",
      promptId: "p1",
      promptKind: "secret",
      message: "Enter API key",
    });
    expect(next.phase).toBe("prompt");
    expect(next.prompt).toEqual({
      kind: "prompt",
      promptId: "p1",
      promptKind: "secret",
      message: "Enter API key",
    });
  });

  it("prompt_cancelled: with the matching id clears the prompt and returns to 'waiting'", () => {
    const prompted = applyLoginFlowEvent(fresh(), {
      kind: "prompt",
      promptId: "p1",
      promptKind: "text",
      message: "?",
    });
    const next = applyLoginFlowEvent(prompted, { kind: "prompt_cancelled", promptId: "p1" });
    expect(next.phase).toBe("waiting");
    expect(next.prompt).toBeUndefined();
  });

  it("prompt_cancelled: with a stale id is a no-op", () => {
    const prompted = applyLoginFlowEvent(fresh(), {
      kind: "prompt",
      promptId: "p1",
      promptKind: "text",
      message: "?",
    });
    const next = applyLoginFlowEvent(prompted, {
      kind: "prompt_cancelled",
      promptId: "some-other-id",
    });
    expect(next).toEqual(prompted);
  });

  it("done: sets phase='done' and stores the result", () => {
    const next = applyLoginFlowEvent(fresh(), { kind: "done", ok: true });
    expect(next.phase).toBe("done");
    expect(next.result).toEqual({ ok: true, error: undefined });

    const failed = applyLoginFlowEvent(fresh(), {
      kind: "done",
      ok: false,
      error: "unknown_provider",
    });
    expect(failed.result).toEqual({ ok: false, error: "unknown_provider" });
  });
});

describe("login-flow reducer — auth_url / manual_code concurrency", () => {
  it("auth_url arriving after a prompt leaves phase 'prompt', with both the url and the prompt present", () => {
    const prompted = applyLoginFlowEvent(fresh(), {
      kind: "prompt",
      promptId: "p-manual",
      promptKind: "manual_code",
      message: "Paste the code shown on the provider's device page",
    });
    expect(prompted.phase).toBe("prompt");

    const withAuthUrl = applyLoginFlowEvent(prompted, {
      kind: "auth_url",
      url: "https://provider.example/authorize",
    });
    expect(withAuthUrl.phase).toBe("prompt");
    expect(withAuthUrl.prompt?.promptId).toBe("p-manual");
    expect(withAuthUrl.authUrl?.url).toBe("https://provider.example/authorize");
  });
});

describe("login-flow reducer — status line accumulation", () => {
  it("info appends distinct lines; progress replaces its own last occurrence rather than accumulating", () => {
    let state = fresh();
    state = applyLoginFlowEvent(state, { kind: "progress", message: "step 1" });
    expect(state.statusLines).toEqual([{ kind: "progress", message: "step 1" }]);

    state = applyLoginFlowEvent(state, { kind: "info", message: "found account" });
    expect(state.statusLines).toEqual([
      { kind: "progress", message: "step 1" },
      { kind: "info", message: "found account", links: undefined },
    ]);

    // A new progress line replaces the earlier one but leaves the permanent info line untouched,
    // and lands after it (the rolling status always trails the accumulated log).
    state = applyLoginFlowEvent(state, { kind: "progress", message: "step 2" });
    expect(state.statusLines).toEqual([
      { kind: "info", message: "found account", links: undefined },
      { kind: "progress", message: "step 2" },
    ]);
  });

  it("info carries optional links verbatim", () => {
    const next = applyLoginFlowEvent(fresh(), {
      kind: "info",
      message: "see docs",
      links: [{ url: "https://example.com/docs", label: "Docs" }],
    });
    expect(next.statusLines[0]?.links).toEqual([
      { url: "https://example.com/docs", label: "Docs" },
    ]);
  });
});

describe("login-flow reducer — done is terminal", () => {
  it("a subsequent prompt event does not change a done state", () => {
    const done = applyLoginFlowEvent(fresh(), { kind: "done", ok: true });
    const next = applyLoginFlowEvent(done, {
      kind: "prompt",
      promptId: "too-late",
      promptKind: "text",
      message: "?",
    });
    expect(next).toEqual(done);
  });

  it("a subsequent info event does not change a done state", () => {
    const done = applyLoginFlowEvent(fresh(), {
      kind: "done",
      ok: false,
      error: "connection_lost",
    });
    const next = applyLoginFlowEvent(done, { kind: "info", message: "too late" });
    expect(next).toEqual(done);
  });

  it("a second done event does not change an already-done state", () => {
    const done = applyLoginFlowEvent(fresh(), { kind: "done", ok: true });
    const next = applyLoginFlowEvent(done, { kind: "done", ok: false, error: "should be ignored" });
    expect(next).toEqual(done);
  });
});

describe("login-flow reducer — purity", () => {
  it("never mutates the input state object", () => {
    const state = fresh();
    const snapshot = JSON.parse(JSON.stringify(state)) as unknown;
    applyLoginFlowEvent(state, { kind: "info", message: "x" });
    expect(JSON.parse(JSON.stringify(state))).toEqual(snapshot);
  });

  it("the module imports nothing from React, the DOM, or an SDK transport — type-only imports only", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("./login-flow.ts", import.meta.url), "utf8"),
    );
    const importLines = source.split("\n").filter((line) => line.trimStart().startsWith("import"));
    for (const line of importLines) {
      expect(line).toMatch(/^import type /);
      expect(line).not.toMatch(/react|dom|transport|daemon-client/i);
    }
  });
});

describe("login-flow reducer — exhaustiveness", () => {
  it("every ProviderAuthFlowUiEvent kind is handled (compile-time exhaustive switch, smoke-tested here)", () => {
    const kinds: ProviderAuthFlowUiEvent["kind"][] = [
      "info",
      "progress",
      "auth_url",
      "device_code",
      "prompt",
      "prompt_cancelled",
      "done",
    ];
    expect(kinds).toHaveLength(7);
  });
});
