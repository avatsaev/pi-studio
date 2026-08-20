import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `PiAuthRuntime` seam tests (swe/features/provider-auth-rpc.md § Behavior & Algorithms — runtime
 * bullet). Covers the observable contract: the lazy-import guarantee (no
 * `@earendil-works/pi-coding-agent` import until a runtime method is first called, imported at
 * most once, and — unlike the CLI sibling — retried after a failed construction), provider
 * mapping/filtering, bounded `checkAuth`, `login`'s signal merge, and `logout`'s re-check. Never
 * the actual Pi auth engine's own behavior (that belongs to `@earendil-works/pi-coding-agent`'s
 * own test suite) — except the one temp-dir integration check at the bottom.
 */

const mockCreate = vi.fn();

vi.mock("@earendil-works/pi-coding-agent", () => ({
  ModelRuntime: { create: mockCreate },
}));

const { createPiAuthRuntime } = await import("./pi-auth-runtime.js");

function fakeRuntime(overrides: Record<string, unknown> = {}) {
  return {
    getProviders: () => [],
    checkAuth: async () => undefined,
    login: async () => ({ type: "api_key" }),
    logout: async () => {},
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

// ─── lazy import + retry-on-failure ─────────────────────────────────────────────────

describe("createPiAuthRuntime — lazy import", () => {
  it("does not import @earendil-works/pi-coding-agent at construction time", () => {
    mockCreate.mockClear();
    createPiAuthRuntime({});
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("imports the module on first method call, and only once across repeated calls", async () => {
    mockCreate.mockClear();
    mockCreate.mockResolvedValue(fakeRuntime());
    const runtime = createPiAuthRuntime({ authPath: "/x/auth.json" });
    expect(mockCreate).not.toHaveBeenCalled();

    await runtime.listProviders();
    expect(mockCreate).toHaveBeenCalledTimes(1);

    await runtime.checkAuth("anthropic");
    await runtime.logout("anthropic");
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("passes refreshOnCreate: false and the resolved paths through to ModelRuntime.create", async () => {
    mockCreate.mockClear();
    mockCreate.mockResolvedValue(fakeRuntime());
    const runtime = createPiAuthRuntime({ authPath: "/x/auth.json", modelsPath: "/x/models.json" });
    await runtime.listProviders();
    expect(mockCreate).toHaveBeenCalledWith({
      authPath: "/x/auth.json",
      modelsPath: "/x/models.json",
      refreshOnCreate: false,
    });
  });

  it("retries construction on the next call after a transient failure", async () => {
    mockCreate.mockClear();
    mockCreate.mockRejectedValueOnce(new Error("locked"));
    mockCreate.mockResolvedValueOnce(fakeRuntime());
    const runtime = createPiAuthRuntime({});

    await expect(runtime.listProviders()).rejects.toThrow("locked");
    expect(mockCreate).toHaveBeenCalledTimes(1);

    await expect(runtime.listProviders()).resolves.toEqual([]);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });
});

// ─── provider mapping + filtering ──────────────────────────────────────────────────

describe("createPiAuthRuntime — listProviders", () => {
  it("maps Provider -> PiAuthProviderInfo and filters out providers with no login capability", async () => {
    mockCreate.mockClear();
    mockCreate.mockResolvedValue(
      fakeRuntime({
        getProviders: () => [
          { id: "anthropic", name: "Anthropic", auth: { apiKey: { login: () => {} } } },
          {
            id: "chatgpt",
            name: "ChatGPT",
            auth: { oauth: { login: () => {}, loginLabel: "Sign in", isSubscription: true } },
          },
          { id: "no-auth", name: "No Auth", auth: {} },
          { id: "no-auth-field", name: "No Auth Field" },
        ],
      }),
    );
    const runtime = createPiAuthRuntime({});
    const providers = await runtime.listProviders();
    expect(providers).toEqual([
      { id: "anthropic", name: "Anthropic", authTypes: ["api_key"] },
      {
        id: "chatgpt",
        name: "ChatGPT",
        authTypes: ["oauth"],
        oauthLoginLabel: "Sign in",
        oauthIsSubscription: true,
      },
    ]);
  });

  it("skips a single malformed provider rather than throwing", async () => {
    mockCreate.mockClear();
    mockCreate.mockResolvedValue(
      fakeRuntime({
        getProviders: () => [
          null,
          { id: "anthropic", name: "Anthropic", auth: { apiKey: { login: () => {} } } },
        ],
      }),
    );
    const runtime = createPiAuthRuntime({});
    const providers = await runtime.listProviders();
    expect(providers.map((p) => p.id)).toEqual(["anthropic"]);
  });
});

// ─── bounded checkAuth ───────────────────────────────────────────────────────────────

describe("createPiAuthRuntime — checkAuth", () => {
  it("maps an unconfigured provider (undefined) to { configured: false }", async () => {
    mockCreate.mockClear();
    mockCreate.mockResolvedValue(fakeRuntime());
    const runtime = createPiAuthRuntime({});
    expect(await runtime.checkAuth("anthropic")).toEqual({ configured: false });
  });

  it("maps a configured provider to { configured: true, type, source }", async () => {
    mockCreate.mockClear();
    mockCreate.mockResolvedValue(
      fakeRuntime({ checkAuth: async () => ({ type: "oauth", source: "keychain" }) }),
    );
    const runtime = createPiAuthRuntime({});
    expect(await runtime.checkAuth("chatgpt")).toEqual({
      configured: true,
      type: "oauth",
      source: "keychain",
    });
  });

  it("degrades to { configured: 'unknown' } within the bound when the probe never settles", async () => {
    mockCreate.mockClear();
    const hang = new Promise<never>(() => {});
    mockCreate.mockResolvedValue(fakeRuntime({ checkAuth: async () => hang }));
    const runtime = createPiAuthRuntime({}, { checkAuthTimeoutMs: 50 });
    // Warm the lazy runtime cache under real timers first — the dynamic `import()` machinery
    // does not play well with fake timers, and a real service would already have a cached
    // runtime by the time `checkAuth` races its bound anyway.
    await runtime.listProviders();

    vi.useFakeTimers();
    const promise = runtime.checkAuth("slow-provider");
    await vi.advanceTimersByTimeAsync(50);
    await expect(promise).resolves.toEqual({ configured: "unknown" });
  });
});

// ─── login: signal merge ────────────────────────────────────────────────────────────

describe("createPiAuthRuntime — login", () => {
  it("merges the caller-supplied signal onto the interaction and returns the credential type", async () => {
    mockCreate.mockClear();
    let seenSignal: AbortSignal | undefined;
    mockCreate.mockResolvedValue(
      fakeRuntime({
        login: async (_id: string, _type: string, interaction: { signal?: AbortSignal }) => {
          seenSignal = interaction.signal;
          return { type: "api_key" };
        },
      }),
    );
    const runtime = createPiAuthRuntime({});
    const controller = new AbortController();
    const interaction = { prompt: async () => "value", notify: () => {} };
    const result = await runtime.login("openai", "api_key", interaction, controller.signal);
    expect(result).toEqual({ type: "api_key" });
    expect(seenSignal).toBe(controller.signal);
  });

  it("falls back to the interaction's own signal when no explicit signal is passed", async () => {
    mockCreate.mockClear();
    let seenSignal: AbortSignal | undefined;
    mockCreate.mockResolvedValue(
      fakeRuntime({
        login: async (_id: string, _type: string, interaction: { signal?: AbortSignal }) => {
          seenSignal = interaction.signal;
          return { type: "oauth" };
        },
      }),
    );
    const runtime = createPiAuthRuntime({});
    const controller = new AbortController();
    const interaction = {
      signal: controller.signal,
      prompt: async () => "value",
      notify: () => {},
    };
    await runtime.login("chatgpt", "oauth", interaction);
    expect(seenSignal).toBe(controller.signal);
  });
});

// ─── logout: re-check reports an ambient credential surviving removal ─────────────

describe("createPiAuthRuntime — logout", () => {
  it("reports stillConfigured: true when a re-check still shows the provider configured", async () => {
    mockCreate.mockClear();
    mockCreate.mockResolvedValue(
      fakeRuntime({ checkAuth: async () => ({ type: "api_key", source: "env:OPENAI_API_KEY" }) }),
    );
    const runtime = createPiAuthRuntime({});
    expect(await runtime.logout("openai")).toEqual({ stillConfigured: true });
  });

  it("reports stillConfigured: false once the credential is actually gone", async () => {
    mockCreate.mockClear();
    mockCreate.mockResolvedValue(fakeRuntime());
    const runtime = createPiAuthRuntime({});
    expect(await runtime.logout("openai")).toEqual({ stillConfigured: false });
  });
});

// ─── authPathLabel: no import triggered ─────────────────────────────────────────────

describe("createPiAuthRuntime — authPathLabel", () => {
  it("returns the resolved authPath without importing the Pi package", () => {
    mockCreate.mockClear();
    const runtime = createPiAuthRuntime({ authPath: "/x/auth.json" });
    expect(runtime.authPathLabel()).toBe("/x/auth.json");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("falls back to a placeholder when no authPath is resolved", () => {
    const runtime = createPiAuthRuntime({});
    expect(runtime.authPathLabel()).toBe("<default Pi auth path>");
  });
});

// ─── real Pi contract: fresh-machine tolerance ──────────────────────────────────────

describe("ModelRuntime.create — fresh machine", () => {
  it("succeeds with authPath set but no models.json present on disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-studio-server-auth-test-"));
    try {
      const real = await vi.importActual<typeof import("@earendil-works/pi-coding-agent")>(
        "@earendil-works/pi-coding-agent",
      );
      const runtime = await real.ModelRuntime.create({
        authPath: join(dir, "auth.json"),
        modelsPath: join(dir, "models.json"),
        refreshOnCreate: false,
      });
      expect(runtime.getProviders().length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
