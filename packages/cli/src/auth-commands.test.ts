import { describe, expect, it, vi } from "vitest";

// `program.js` transitively static-imports `@av-pi-studio/server`, which itself statically
// imports the real `@earendil-works/pi-coding-agent` — so the mock factory below can run during
// this file's own import-resolution phase, before a plain top-level `const` would be initialized.
// `vi.hoisted()` runs before all imports, same as `vi.mock()`, so it's safe to close over here.
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));
vi.mock("@earendil-works/pi-coding-agent", () => ({
  ModelRuntime: { create: mockCreate },
}));

import type { TerminalIo } from "./auth-interaction.js";
import type { AuthProviderInfo, AuthRuntime, AuthStatusInfo } from "./auth-runtime.js";
import { CHECK_AUTH_TIMEOUT_MS, checkAuthBounded, runAuthLogin } from "./auth-commands.js";
import { type CliContext, defaultContext } from "./cli-core.js";
import { connectDaemon } from "./connection.js";
import { buildProgram, run } from "./program.js";

/**
 * `auth status`/`auth logout` tests (features/provider-auth-cli.md § Behavior — status/logout,
 * § Error Handling). Drives `run(argv, ctx)` end to end with an injected fake `AuthRuntime` —
 * `@earendil-works/pi-coding-agent` is mocked at the top of this file and never actually invoked by
 * anything these tests exercise.
 */

function fakeRuntime(overrides: Partial<AuthRuntime> = {}): AuthRuntime {
  return {
    listProviders: async () => [],
    checkAuth: async () => ({ configured: false }),
    login: async () => ({ type: "api_key" }),
    logout: async () => {},
    authPathLabel: () => "/home/.pi-studio-pi/agent/auth.json",
    ...overrides,
  };
}

function ctxWith(auth: AuthRuntime): { ctx: CliContext; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const ctx: CliContext = {
    connect: (opts) => connectDaemon(opts),
    sink: { write: (l) => out.push(l), error: (l) => err.push(l) },
    auth,
  };
  return { ctx, out, err };
}

const fourStateProviders: AuthProviderInfo[] = [
  { id: "anthropic", name: "Anthropic", canApiKeyLogin: true, canOAuthLogin: false },
  { id: "chatgpt", name: "ChatGPT", canApiKeyLogin: false, canOAuthLogin: true },
  { id: "gemini", name: "Gemini", canApiKeyLogin: true, canOAuthLogin: false },
  { id: "openai", name: "OpenAI", canApiKeyLogin: true, canOAuthLogin: false },
];

const fourStateStatuses: Record<string, AuthStatusInfo> = {
  anthropic: { configured: true, type: "api_key", source: "auth.json" },
  chatgpt: { configured: true, type: "oauth" },
  gemini: { configured: true, type: "api_key", source: "GEMINI_API_KEY" },
  openai: { configured: false },
};

function fourStateRuntime(overrides: Partial<AuthRuntime> = {}): AuthRuntime {
  return fakeRuntime({
    listProviders: async () => fourStateProviders,
    checkAuth: async (id) => fourStateStatuses[id] ?? { configured: false },
    ...overrides,
  });
}

// ─── auth status ────────────────────────────────────────────────────────────────────

describe("auth status", () => {
  it("renders a table covering all four states: stored api key, stored oauth, env-var-sourced, not configured", async () => {
    const { ctx, out, err } = ctxWith(fourStateRuntime());
    const code = await run(["auth", "status"], ctx);
    expect(code).toBe(0);
    const table = out.join("\n");
    expect(table).toContain("anthropic");
    expect(table).toContain("api key");
    expect(table).toContain("auth.json");
    expect(table).toContain("chatgpt");
    expect(table).toContain("oauth");
    expect(table).toContain("gemini");
    expect(table).toContain("GEMINI_API_KEY");
    expect(table).toContain("openai");
    expect(table).toContain("not configured");
    // resolved auth.json path shown in table mode, on stderr (the footer line)
    expect(err.some((l) => l.includes("/home/.pi-studio-pi/agent/auth.json"))).toBe(true);
  });

  it("--json emits the documented id-sorted array with no extra keys", async () => {
    const { ctx, out, err } = ctxWith(fourStateRuntime());
    const code = await run(["--json", "auth", "status"], ctx);
    expect(code).toBe(0);
    expect(out).toHaveLength(1);
    const parsed = JSON.parse(out[0]!) as Array<Record<string, unknown>>;
    expect(parsed.map((r) => r.id)).toEqual(["anthropic", "chatgpt", "gemini", "openai"]);
    for (const row of parsed) {
      expect(Object.keys(row).toSorted()).toEqual(
        ["configured", "id", "name", "source", "type"].filter((k) => k in row),
      );
    }
    expect(parsed.find((r) => r.id === "anthropic")).toMatchObject({
      configured: true,
      type: "api_key",
      source: "auth.json",
    });
    expect(parsed.find((r) => r.id === "openai")).toMatchObject({ configured: false });
    expect("type" in parsed.find((r) => r.id === "openai")!).toBe(false);
    // the resolved auth.json path is a table-mode-only footer — absent from JSON stdout
    expect(out.join("\n")).not.toContain("agent/auth.json");
    expect(err).toEqual([]);
  });

  it("a provider whose checkAuth() hangs past the timeout degrades to unknown, not a hang", async () => {
    vi.useFakeTimers();
    try {
      const hang = Promise.withResolvers<AuthStatusInfo>().promise;
      const runtime = fakeRuntime({ checkAuth: async () => hang });
      const promise = checkAuthBounded(runtime, "slow-provider", 50);
      await vi.advanceTimersByTimeAsync(50);
      await expect(promise).resolves.toBe("unknown");
    } finally {
      vi.useRealTimers();
    }
  });

  it("status: a hung provider degrades that row to unknown without blocking the command", async () => {
    vi.useFakeTimers();
    try {
      const runtime = fakeRuntime({
        listProviders: async () => [
          { id: "slow", name: "Slow Co", canApiKeyLogin: true, canOAuthLogin: false },
        ],
        checkAuth: async () => Promise.withResolvers<AuthStatusInfo>().promise,
      });
      const { ctx, out } = ctxWith(runtime);
      const resultPromise = run(["auth", "status"], ctx);
      await vi.advanceTimersByTimeAsync(CHECK_AUTH_TIMEOUT_MS);
      const code = await resultPromise;
      expect(code).toBe(0);
      expect(out.join("\n")).toContain("unknown");
    } finally {
      vi.useRealTimers();
    }
  });

  it("exits EXIT_OK even when nothing is configured", async () => {
    const { ctx } = ctxWith(
      fakeRuntime({
        listProviders: async () => [
          { id: "openai", name: "OpenAI", canApiKeyLogin: true, canOAuthLogin: false },
        ],
      }),
    );
    expect(await run(["auth", "status"], ctx)).toBe(0);
  });
});

// ─── auth logout ────────────────────────────────────────────────────────────────────

describe("auth logout", () => {
  it("removes a stored credential (fake runtime records the call) and exits 0", async () => {
    const logoutCalls: string[] = [];
    let configured = true;
    const runtime = fakeRuntime({
      listProviders: async () => [
        { id: "anthropic", name: "Anthropic", canApiKeyLogin: true, canOAuthLogin: false },
      ],
      checkAuth: async () => ({ configured }),
      logout: async (id) => {
        logoutCalls.push(id);
        configured = false;
      },
    });
    const { ctx, out } = ctxWith(runtime);
    const code = await run(["auth", "logout", "anthropic"], ctx);
    expect(code).toBe(0);
    expect(logoutCalls).toEqual(["anthropic"]);
    expect(out.some((l) => l.includes("removed"))).toBe(true);
  });

  it('a second logout on an already-removed credential still exits 0 with a "nothing stored" message', async () => {
    const runtime = fakeRuntime({
      listProviders: async () => [
        { id: "anthropic", name: "Anthropic", canApiKeyLogin: true, canOAuthLogin: false },
      ],
      checkAuth: async () => ({ configured: false }),
    });
    const { ctx, out } = ctxWith(runtime);
    const code = await run(["auth", "logout", "anthropic"], ctx);
    expect(code).toBe(0);
    expect(out.some((l) => l.toLowerCase().includes("nothing stored"))).toBe(true);
  });

  it("an unknown provider id exits EXIT_ERROR and lists valid provider ids", async () => {
    const runtime = fakeRuntime({
      listProviders: async () => [
        { id: "anthropic", name: "Anthropic", canApiKeyLogin: true, canOAuthLogin: false },
        { id: "openai", name: "OpenAI", canApiKeyLogin: true, canOAuthLogin: false },
      ],
    });
    const { ctx, err } = ctxWith(runtime);
    const code = await run(["auth", "logout", "bogus"], ctx);
    expect(code).not.toBe(0);
    expect(err.some((l) => l.includes("anthropic") && l.includes("openai"))).toBe(true);
  });

  it("logging out a provider that is also env-var configured prints the ambient-credential note", async () => {
    let logoutCalled = false;
    const runtime = fakeRuntime({
      listProviders: async () => [
        { id: "anthropic", name: "Anthropic", canApiKeyLogin: true, canOAuthLogin: false },
      ],
      // before logout: stored credential reported; after logout: the ambient env var behind it
      checkAuth: async () =>
        logoutCalled
          ? { configured: true, type: "api_key", source: "ANTHROPIC_API_KEY" }
          : { configured: true, type: "api_key", source: "auth.json" },
      logout: async () => {
        logoutCalled = true;
      },
    });
    const { ctx, out } = ctxWith(runtime);
    const code = await run(["auth", "logout", "anthropic"], ctx);
    expect(code).toBe(0);
    expect(out.some((l) => l.includes("removed"))).toBe(true);
    expect(out.some((l) => l.includes("ANTHROPIC_API_KEY") && l.includes("still configured"))).toBe(
      true,
    );
  });
});

// ─── --help / lazy import ───────────────────────────────────────────────────────────

describe("auth group registration", () => {
  it("--help lists the auth group; no Pi import occurs for --help", () => {
    mockCreate.mockClear();
    const program = buildProgram(defaultContext(), () => {});
    const help = program.helpInformation();
    expect(help).toMatch(/\bauth\b/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("no Pi import occurs for an unrelated command group's action", async () => {
    mockCreate.mockClear();
    const { ctx } = ctxWith(fakeRuntime());
    // `daemon status` belongs to daemon-commands.ts, not auth-commands.ts — it never touches
    // ctx.auth, so exercising it must never construct/import the Pi runtime.
    const daemonCtx: CliContext = {
      ...ctx,
      daemon: { probe: async () => false, hash: (p) => p, kill: () => true, start: async () => 0 },
    };
    await run(["daemon", "status"], daemonCtx);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

// ─── auth login ─────────────────────────────────────────────────────────────────

function fakeIo(overrides: Partial<TerminalIo> = {}): { io: TerminalIo; closed: () => boolean } {
  let closed = false;
  const io: TerminalIo = {
    isTty: true,
    question: async () => "",
    secret: async () => "",
    select: async (_message, options) => options[0]?.id ?? "",
    close: () => {
      closed = true;
    },
    ...overrides,
  };
  return { io, closed: () => closed };
}

function pendingForever<T>(): Promise<T> {
  return Promise.withResolvers<T>().promise;
}

const singleMethodProvider: AuthProviderInfo = {
  id: "anthropic",
  name: "Anthropic",
  canApiKeyLogin: true,
  canOAuthLogin: false,
};

describe("auth login", () => {
  it("no args: prompts a provider picker showing configured state and subscription markers, and proceeds with the selection", async () => {
    const pickerProviders: AuthProviderInfo[] = [
      { id: "anthropic", name: "Anthropic", canApiKeyLogin: true, canOAuthLogin: false },
      {
        id: "chatgpt",
        name: "ChatGPT",
        canApiKeyLogin: false,
        canOAuthLogin: true,
        oauthLoginLabel: "Sign in with ChatGPT Plus",
        oauthIsSubscription: true,
      },
    ];
    // The picker is an interactive select — labels go to the picker, not to stderr.
    const pickerLabels: string[] = [];
    const { io } = fakeIo({
      select: async (_message, options) => {
        pickerLabels.push(...options.map((o) => o.label));
        return options[1]!.id; // pick chatgpt
      },
    });
    const loginCalls: Array<{ id: string; type: string }> = [];
    const runtime = fakeRuntime({
      listProviders: async () => pickerProviders,
      checkAuth: async (id) =>
        id === "anthropic" ? { configured: true, type: "api_key" } : { configured: false },
      login: async (id, type) => {
        loginCalls.push({ id, type });
        return { type };
      },
    });
    const { ctx } = ctxWith(runtime);
    const code = await runAuthLogin(ctx, {}, undefined, {}, io);
    expect(code).toBe(0);
    expect(loginCalls).toEqual([{ id: "chatgpt", type: "oauth" }]);
    expect(
      pickerLabels.some((l) => l.includes("Anthropic") && l.includes("already configured")),
    ).toBe(true);
    expect(pickerLabels.some((l) => l.includes("ChatGPT") && l.includes("subscription"))).toBe(
      true,
    );
  });

  it("<provider> with a single supported method starts that flow with no method prompt", async () => {
    let promptCalls = 0;
    const { io } = fakeIo({
      question: async () => {
        promptCalls++;
        return "";
      },
      select: async () => {
        promptCalls++;
        return "";
      },
    });
    const loginCalls: Array<{ id: string; type: string }> = [];
    const runtime = fakeRuntime({
      listProviders: async () => [singleMethodProvider],
      login: async (id, type) => {
        loginCalls.push({ id, type });
        return { type };
      },
    });
    const { ctx } = ctxWith(runtime);
    const code = await runAuthLogin(ctx, {}, "anthropic", {}, io);
    expect(code).toBe(0);
    expect(loginCalls).toEqual([{ id: "anthropic", type: "api_key" }]);
    expect(promptCalls).toBe(0); // no picker (arg given), no method prompt (single method)
  });

  it("<provider> with two methods prompts once for the method, using the OAuth loginLabel when present", async () => {
    const dual: AuthProviderInfo = {
      id: "chatgpt",
      name: "ChatGPT",
      canApiKeyLogin: true,
      canOAuthLogin: true,
      oauthLoginLabel: "Sign in with ChatGPT Plus",
    };
    let selectCalls = 0;
    const methodLabels: string[] = [];
    const { io } = fakeIo({
      select: async (message, options) => {
        selectCalls++;
        methodLabels.push(message, ...options.map((o) => o.label));
        return "oauth";
      },
    });
    const loginCalls: Array<{ id: string; type: string }> = [];
    const runtime = fakeRuntime({
      listProviders: async () => [dual],
      login: async (id, type) => {
        loginCalls.push({ id, type });
        return { type };
      },
    });
    const { ctx } = ctxWith(runtime);
    const code = await runAuthLogin(ctx, {}, "chatgpt", {}, io);
    expect(code).toBe(0);
    expect(loginCalls).toEqual([{ id: "chatgpt", type: "oauth" }]);
    expect(selectCalls).toBe(1);
    expect(methodLabels.some((l) => l.includes("ChatGPT"))).toBe(true);
    expect(methodLabels).toContain("Sign in with ChatGPT Plus");
  });

  it("--type oauth on an api-key-only provider errors before any prompt", async () => {
    let promptCalls = 0;
    const { io } = fakeIo({
      question: async () => {
        promptCalls++;
        return "";
      },
      select: async () => {
        promptCalls++;
        return "";
      },
    });
    const runtime = fakeRuntime({ listProviders: async () => [singleMethodProvider] });
    const { ctx, err } = ctxWith(runtime);
    const code = await runAuthLogin(ctx, {}, "anthropic", { type: "oauth" }, io);
    expect(code).not.toBe(0);
    expect(
      err.some((l) => l.includes("does not support --type oauth") && l.includes("api_key")),
    ).toBe(true);
    expect(promptCalls).toBe(0);
  });

  it("--type api_key on an oauth-only provider errors before any prompt", async () => {
    const oauthOnly: AuthProviderInfo = {
      id: "chatgpt",
      name: "ChatGPT",
      canApiKeyLogin: false,
      canOAuthLogin: true,
    };
    let promptCalls = 0;
    const { io } = fakeIo({
      question: async () => {
        promptCalls++;
        return "";
      },
      select: async () => {
        promptCalls++;
        return "";
      },
    });
    const runtime = fakeRuntime({ listProviders: async () => [oauthOnly] });
    const { ctx, err } = ctxWith(runtime);
    const code = await runAuthLogin(ctx, {}, "chatgpt", { type: "api_key" }, io);
    expect(code).not.toBe(0);
    expect(
      err.some((l) => l.includes("does not support --type api_key") && l.includes("oauth")),
    ).toBe(true);
    expect(promptCalls).toBe(0);
  });

  it("unknown provider id errors with the valid id list, exit EXIT_ERROR", async () => {
    const { io } = fakeIo();
    const runtime = fakeRuntime({ listProviders: async () => [singleMethodProvider] });
    const { ctx, err } = ctxWith(runtime);
    const code = await runAuthLogin(ctx, {}, "bogus", {}, io);
    expect(code).not.toBe(0);
    expect(err.some((l) => l.includes("anthropic"))).toBe(true);
  });

  it("a successful fake api_key flow (prompt secret -> resolve) reports success with provider, type, and auth.json path", async () => {
    const { io } = fakeIo({ secret: async () => "sk-test-123" });
    const runtime = fakeRuntime({
      listProviders: async () => [singleMethodProvider],
      login: async (_id, _type, interaction) => {
        const key = await interaction.prompt({ type: "secret", message: "API key" });
        expect(key).toBe("sk-test-123");
        return { type: "api_key" };
      },
      authPathLabel: () => "/home/.pi-studio-pi/agent/auth.json",
    });
    const { ctx, out } = ctxWith(runtime);
    const code = await runAuthLogin(ctx, {}, "anthropic", {}, io);
    expect(code).toBe(0);
    expect(
      out.some((l) => l.includes("anthropic") && l.includes("api_key") && l.includes("auth.json")),
    ).toBe(true);
  });

  it("a successful fake oauth flow (notify auth_url -> prompt manual_code -> resolve) completes and reports success", async () => {
    const oauthOnly: AuthProviderInfo = {
      id: "chatgpt",
      name: "ChatGPT",
      canApiKeyLogin: false,
      canOAuthLogin: true,
    };
    const { io } = fakeIo({ question: async () => "123456" });
    const runtime = fakeRuntime({
      listProviders: async () => [oauthOnly],
      login: async (_id, _type, interaction) => {
        interaction.notify({ type: "auth_url", url: "https://example.com/oauth" });
        const code = await interaction.prompt({ type: "manual_code", message: "Enter the code" });
        expect(code).toBe("123456");
        return { type: "oauth" };
      },
    });
    const { ctx, out, err } = ctxWith(runtime);
    const code = await runAuthLogin(ctx, {}, "chatgpt", {}, io);
    expect(code).toBe(0);
    expect(err.some((l) => l.includes("https://example.com/oauth"))).toBe(true);
    expect(out.some((l) => l.includes("oauth"))).toBe(true);
  });

  it("SIGINT during a pending prompt aborts the flow, prints login cancelled, exits EXIT_ERROR, and leaves no SIGINT handler behind, with io closed", async () => {
    const { io, closed } = fakeIo({ secret: () => pendingForever<string>() });
    const runtime = fakeRuntime({
      listProviders: async () => [singleMethodProvider],
      login: async (_id, _type, interaction) => {
        await interaction.prompt({ type: "secret", message: "API key" });
        return { type: "api_key" };
      },
    });
    const { ctx, err } = ctxWith(runtime);
    const before = process.listenerCount("SIGINT");
    const promise = runAuthLogin(ctx, {}, "anthropic", {}, io);
    // let the flow install its SIGINT handler and reach the pending prompt
    await Promise.resolve();
    await Promise.resolve();
    expect(process.listenerCount("SIGINT")).toBe(before + 1);
    process.emit("SIGINT");
    const code = await promise;
    expect(code).not.toBe(0);
    expect(err.some((l) => l.toLowerCase().includes("cancelled"))).toBe(true);
    expect(closed()).toBe(true);
    expect(process.listenerCount("SIGINT")).toBe(before);
  });

  it("a rejecting login() prints the provider error and exits EXIT_ERROR, with no secret in any output", async () => {
    const { io } = fakeIo({ secret: async () => "sk-should-not-appear" });
    const runtime = fakeRuntime({
      listProviders: async () => [singleMethodProvider],
      login: async (_id, _type, interaction) => {
        await interaction.prompt({ type: "secret", message: "API key" });
        throw new Error("provider rejected: invalid key");
      },
    });
    const { ctx, out, err } = ctxWith(runtime);
    const code = await runAuthLogin(ctx, {}, "anthropic", {}, io);
    expect(code).not.toBe(0);
    expect(err.some((l) => l.includes("invalid key"))).toBe(true);
    expect(out.join("\n")).not.toContain("sk-should-not-appear");
    expect(err.join("\n")).not.toContain("sk-should-not-appear");
  });

  it("re-login on an already configured provider is permitted and overwrites the credential", async () => {
    const { io } = fakeIo({ secret: async () => "new-key" });
    const loginCalls: string[] = [];
    const runtime = fakeRuntime({
      listProviders: async () => [singleMethodProvider],
      checkAuth: async () => ({ configured: true, type: "api_key", source: "auth.json" }),
      login: async (id, _type, interaction) => {
        loginCalls.push(id);
        await interaction.prompt({ type: "secret", message: "API key" });
        return { type: "api_key" };
      },
    });
    const { ctx } = ctxWith(runtime);
    const code = await runAuthLogin(ctx, {}, "anthropic", {}, io);
    expect(code).toBe(0);
    expect(loginCalls).toEqual(["anthropic"]);
  });
});

// ─── auth login --api-key (headless) ───────────────────────────────────────────────

describe("auth login --api-key (headless)", () => {
  it("completes with zero prompts and stores the key, exit EXIT_OK", async () => {
    const poisonedIo: TerminalIo = {
      isTty: true,
      question: async () => {
        throw new Error("io.question must never be called for --api-key");
      },
      secret: async () => {
        throw new Error("io.secret must never be called for --api-key");
      },
      select: async () => {
        throw new Error("io.select must never be called for --api-key");
      },
      close: () => {
        throw new Error("io.close must never be called for --api-key");
      },
    };
    const loginCalls: Array<{ id: string; type: string }> = [];
    const runtime = fakeRuntime({
      listProviders: async () => [singleMethodProvider],
      login: async (id, type, interaction) => {
        loginCalls.push({ id, type });
        const key = await interaction.prompt({ type: "secret", message: "API key" });
        expect(key).toBe("sk-headless-test");
        return { type: "api_key" };
      },
    });
    const { ctx, out } = ctxWith(runtime);
    const code = await runAuthLogin(
      ctx,
      {},
      "anthropic",
      { apiKey: "sk-headless-test" },
      poisonedIo,
    );
    expect(code).toBe(0);
    expect(loginCalls).toEqual([{ id: "anthropic", type: "api_key" }]);
    expect(out.some((l) => l.includes("anthropic") && l.includes("api_key"))).toBe(true);
  });

  it("the key never appears in any sink output", async () => {
    const runtime = fakeRuntime({
      listProviders: async () => [singleMethodProvider],
      login: async (_id, _type, interaction) => {
        await interaction.prompt({ type: "secret", message: "API key" });
        return { type: "api_key" };
      },
    });
    const { ctx, out, err } = ctxWith(runtime);
    const code = await runAuthLogin(
      ctx,
      {},
      "anthropic",
      { apiKey: "sk-super-secret-headless" },
      undefined,
    );
    expect(code).toBe(0);
    expect(out.join("\n")).not.toContain("sk-super-secret-headless");
    expect(err.join("\n")).not.toContain("sk-super-secret-headless");
  });

  it("--api-key without a provider argument errors, exit EXIT_ERROR", async () => {
    const runtime = fakeRuntime();
    const { ctx, err } = ctxWith(runtime);
    const code = await runAuthLogin(ctx, {}, undefined, { apiKey: "sk-x" }, undefined);
    expect(code).not.toBe(0);
    expect(err.some((l) => l.includes("--api-key") && l.includes("provider"))).toBe(true);
  });

  it("--api-key with --type oauth errors before the runtime is touched", async () => {
    let listProvidersCalls = 0;
    const runtime = fakeRuntime({
      listProviders: async () => {
        listProvidersCalls++;
        return [singleMethodProvider];
      },
    });
    const { ctx, err } = ctxWith(runtime);
    const code = await runAuthLogin(
      ctx,
      {},
      "anthropic",
      { apiKey: "sk-x", type: "oauth" },
      undefined,
    );
    expect(code).not.toBe(0);
    expect(err.some((l) => l.includes("--api-key") && l.includes("oauth"))).toBe(true);
    expect(listProvidersCalls).toBe(0);
  });

  it("--api-key against an oauth-only provider errors after lookup but before any login flow starts", async () => {
    const oauthOnly: AuthProviderInfo = {
      id: "chatgpt",
      name: "ChatGPT",
      canApiKeyLogin: false,
      canOAuthLogin: true,
    };
    const loginCalls: string[] = [];
    const runtime = fakeRuntime({
      listProviders: async () => [oauthOnly],
      login: async (id) => {
        loginCalls.push(id);
        return { type: "oauth" };
      },
    });
    const { ctx, err } = ctxWith(runtime);
    const code = await runAuthLogin(ctx, {}, "chatgpt", { apiKey: "sk-x" }, undefined);
    expect(code).not.toBe(0);
    expect(err.some((l) => l.includes("does not support --type api_key"))).toBe(true);
    expect(loginCalls).toEqual([]);
  });

  it("a provider whose api-key flow asks anything other than secret fails with the documented message", async () => {
    const runtime = fakeRuntime({
      listProviders: async () => [singleMethodProvider],
      login: async (_id, _type, interaction) => {
        await interaction.prompt({ type: "text", message: "Account name" });
        return { type: "api_key" };
      },
    });
    const { ctx, err } = ctxWith(runtime);
    const code = await runAuthLogin(ctx, {}, "anthropic", { apiKey: "sk-x" }, undefined);
    expect(code).not.toBe(0);
    expect(err.some((l) => l.includes("provider requires interactive login"))).toBe(true);
  });
});

// ─── auth login — non-TTY guard ────────────────────────────────────────────────────

describe("auth login — non-TTY guard", () => {
  it("non-TTY stdin without --api-key fails fast with guidance, never constructs the Pi runtime", async () => {
    mockCreate.mockClear();
    const { io, closed } = fakeIo({ isTty: false });
    let listProvidersCalls = 0;
    const runtime = fakeRuntime({
      listProviders: async () => {
        listProvidersCalls++;
        return [singleMethodProvider];
      },
    });
    const { ctx, err } = ctxWith(runtime);
    const code = await runAuthLogin(ctx, {}, undefined, {}, io);
    expect(code).not.toBe(0);
    expect(err.some((l) => l.includes("--api-key") && l.toLowerCase().includes("tty"))).toBe(true);
    expect(listProvidersCalls).toBe(0);
    expect(closed()).toBe(true);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("auth status / auth logout on non-TTY stdin", () => {
  it("auth status still works when stdin is not a TTY", async () => {
    const runtime = fourStateRuntime();
    const { ctx } = ctxWith(runtime);
    // status/logout never construct or check TerminalIo.isTty — the guard is login-only.
    const code = await run(["auth", "status"], ctx);
    expect(code).toBe(0);
  });

  it("auth logout still works when stdin is not a TTY", async () => {
    const runtime = fakeRuntime({ listProviders: async () => [singleMethodProvider] });
    const { ctx } = ctxWith(runtime);
    const code = await run(["auth", "logout", "anthropic"], ctx);
    expect(code).toBe(0);
  });
});
