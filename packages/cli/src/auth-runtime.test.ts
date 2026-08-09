import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

/**
 * Auth runtime seam tests (features/provider-auth-cli.md § Public Contract / § Behavior &
 * Algorithms). Covers the observable contract: `--pi-home`/`PI_STUDIO_PI_HOME` path derivation
 * (byte-identical to the daemon's `piHomeEnv()`), the lazy-import guarantee (task-001 acceptance
 * criterion — no `@earendil-works/pi-coding-agent` import until a runtime method is first called,
 * imported at most once), provider mapping/filtering, and `checkAuth` mapping. Never the actual Pi
 * auth engine's own behavior (that belongs to `@earendil-works/pi-coding-agent`'s own test suite) —
 * except the single temp-dir integration check below, which closes a TODO(verify) about a real Pi
 * contract this seam depends on.
 */

const mockCreate = vi.fn();

vi.mock("@earendil-works/pi-coding-agent", () => ({
  ModelRuntime: { create: mockCreate },
}));

const { defaultAuthRuntime, resolvePiAuthPaths } = await import("./auth-runtime.js");

// ─── resolvePiAuthPaths ────────────────────────────────────────────────────────────

describe("resolvePiAuthPaths", () => {
  it("derives auth.json/models.json from --pi-home", () => {
    expect(resolvePiAuthPaths({ piHome: "/custom/.pi" }, {})).toEqual({
      authPath: "/custom/.pi/agent/auth.json",
      modelsPath: "/custom/.pi/agent/models.json",
    });
  });

  it("falls back to $PI_STUDIO_PI_HOME when --pi-home is not given", () => {
    expect(resolvePiAuthPaths({}, { PI_STUDIO_PI_HOME: "/env/.pi" })).toEqual({
      authPath: "/env/.pi/agent/auth.json",
      modelsPath: "/env/.pi/agent/models.json",
    });
  });

  it("is empty when neither is set", () => {
    expect(resolvePiAuthPaths({}, {})).toEqual({});
  });

  it("--pi-home takes precedence over $PI_STUDIO_PI_HOME", () => {
    expect(resolvePiAuthPaths({ piHome: "/flag/.pi" }, { PI_STUDIO_PI_HOME: "/env/.pi" })).toEqual({
      authPath: "/flag/.pi/agent/auth.json",
      modelsPath: "/flag/.pi/agent/models.json",
    });
  });

  it('matches the daemon\'s piHomeEnv() derivation (provider-registry.ts:57) — join(piHome, "agent", "auth.json")', () => {
    const piHome = "/srv/.pi-studio-pi";
    expect(resolvePiAuthPaths({ piHome }, {}).authPath).toBe(join(piHome, "agent", "auth.json"));
  });
});

// ─── lazy import ────────────────────────────────────────────────────────────────────

describe("defaultAuthRuntime — lazy import", () => {
  it("does not import @earendil-works/pi-coding-agent at construction time", () => {
    mockCreate.mockClear();
    defaultAuthRuntime({});
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("imports the module on first method call, and only once across repeated calls", async () => {
    mockCreate.mockClear();
    mockCreate.mockResolvedValue({
      getProviders: () => [],
      checkAuth: async () => undefined,
      login: async () => ({ type: "api_key" }),
      logout: async () => {},
    });
    const runtime = defaultAuthRuntime({ authPath: "/x/auth.json" });
    expect(mockCreate).not.toHaveBeenCalled();

    await runtime.listProviders();
    expect(mockCreate).toHaveBeenCalledTimes(1);

    await runtime.checkAuth("anthropic");
    await runtime.logout("anthropic");
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("passes refreshOnCreate: false and the resolved paths through to ModelRuntime.create", async () => {
    mockCreate.mockClear();
    mockCreate.mockResolvedValue({
      getProviders: () => [],
      checkAuth: async () => undefined,
      login: async () => ({ type: "api_key" }),
      logout: async () => {},
    });
    const runtime = defaultAuthRuntime({ authPath: "/x/auth.json", modelsPath: "/x/models.json" });
    await runtime.listProviders();
    expect(mockCreate).toHaveBeenCalledWith({
      authPath: "/x/auth.json",
      modelsPath: "/x/models.json",
      refreshOnCreate: false,
    });
  });
});

// ─── provider mapping + filtering ──────────────────────────────────────────────────

describe("defaultAuthRuntime — listProviders", () => {
  it("maps Provider -> AuthProviderInfo and filters out providers with no login capability", async () => {
    mockCreate.mockClear();
    mockCreate.mockResolvedValue({
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
      checkAuth: async () => undefined,
      login: async () => ({ type: "api_key" }),
      logout: async () => {},
    });
    const runtime = defaultAuthRuntime({});
    const providers = await runtime.listProviders();
    expect(providers).toEqual([
      { id: "anthropic", name: "Anthropic", canApiKeyLogin: true, canOAuthLogin: false },
      {
        id: "chatgpt",
        name: "ChatGPT",
        canApiKeyLogin: false,
        canOAuthLogin: true,
        oauthLoginLabel: "Sign in",
        oauthIsSubscription: true,
      },
    ]);
  });

  it("skips a single bad provider rather than throwing", async () => {
    mockCreate.mockClear();
    mockCreate.mockResolvedValue({
      getProviders: () => [
        null,
        { id: "anthropic", name: "Anthropic", auth: { apiKey: { login: () => {} } } },
      ],
      checkAuth: async () => undefined,
      login: async () => ({ type: "api_key" }),
      logout: async () => {},
    });
    const runtime = defaultAuthRuntime({});
    const providers = await runtime.listProviders();
    expect(providers.map((p) => p.id)).toEqual(["anthropic"]);
  });
});

// ─── checkAuth mapping ──────────────────────────────────────────────────────────────

describe("defaultAuthRuntime — checkAuth", () => {
  it("maps an unconfigured provider (undefined) to { configured: false }", async () => {
    mockCreate.mockClear();
    mockCreate.mockResolvedValue({
      getProviders: () => [],
      checkAuth: async () => undefined,
      login: async () => ({ type: "api_key" }),
      logout: async () => {},
    });
    const runtime = defaultAuthRuntime({});
    expect(await runtime.checkAuth("anthropic")).toEqual({ configured: false });
  });

  it("maps a configured provider to { configured: true, type, source }", async () => {
    mockCreate.mockClear();
    mockCreate.mockResolvedValue({
      getProviders: () => [],
      checkAuth: async () => ({ type: "oauth", source: "keychain" }),
      login: async () => ({ type: "oauth" }),
      logout: async () => {},
    });
    const runtime = defaultAuthRuntime({});
    expect(await runtime.checkAuth("chatgpt")).toEqual({
      configured: true,
      type: "oauth",
      source: "keychain",
    });
  });
});

// ─── real Pi contract: fresh-machine tolerance (TODO(verify) closed) ───────────────

describe("ModelRuntime.create — fresh machine", () => {
  it("succeeds with authPath set but no models.json present on disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-studio-auth-test-"));
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
