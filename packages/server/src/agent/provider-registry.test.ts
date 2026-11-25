import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { persistedConfigSchema } from "../config/daemon-config.js";
import { effectivePiHomeKey } from "../extensions/extensions-state.js";
import { PROVIDER_MANIFEST } from "./manifest.js";
import { resolvePiAuthPaths } from "./pi-home.js";
import {
  ProviderRegistry,
  resolvePiAgentDir,
  resolveProviderClient,
  type ProviderClientDeps,
} from "./provider-registry.js";
import type { PiRpcTransport, PiTransportSpawnArgs } from "./providers/pi/rpc-transport.js";

function fakeDeps(): { deps: ProviderClientDeps; spawns: PiTransportSpawnArgs[] } {
  const spawns: PiTransportSpawnArgs[] = [];
  const transport: PiRpcTransport = {
    request: () => Promise.resolve([]),
    notify: () => {},
    onEvent: () => () => {},
    close: () => Promise.resolve(),
  };
  return {
    spawns,
    deps: {
      binaryResolver: () => true,
      transportFactory: (args) => {
        spawns.push(args);
        return transport;
      },
    },
  };
}

describe("manifest", () => {
  it("exposes the pi and mock providers", () => {
    expect(PROVIDER_MANIFEST.pi.id).toBe("pi");
    expect(PROVIDER_MANIFEST.mock.id).toBe("mock");
  });
});

describe("resolveProviderClient", () => {
  it("resolves built-in pi and mock", () => {
    const config = persistedConfigSchema.parse({});
    const { deps } = fakeDeps();
    expect(resolveProviderClient("pi", config, deps).provider).toBe("pi");
    expect(resolveProviderClient("mock", config, deps).provider).toBe("mock");
  });

  it("piHome sets PI_CODING_AGENT_DIR/PI_CODING_AGENT_SESSION_DIR as base env, overridable", async () => {
    const config = persistedConfigSchema.parse({ daemon: { piHome: "/custom/.pi" } });
    const { deps, spawns } = fakeDeps();
    const client = resolveProviderClient("pi", config, deps);
    await client.createSession({ provider: "pi", cwd: "/w" });
    expect(spawns[0]?.env.PI_CODING_AGENT_DIR).toBe(join("/custom/.pi", "agent"));
    expect(spawns[0]?.env.PI_CODING_AGENT_SESSION_DIR).toBe(
      join("/custom/.pi", "agent", "sessions"),
    );

    const overridden = persistedConfigSchema.parse({
      daemon: { piHome: "/custom/.pi" },
      agents: {
        providers: { pi: { env: { PI_CODING_AGENT_DIR: "/explicit/agent" } } },
      },
    });
    const { deps: deps2, spawns: spawns2 } = fakeDeps();
    const client2 = resolveProviderClient("pi", overridden, deps2);
    await client2.createSession({ provider: "pi", cwd: "/w" });
    expect(spawns2[0]?.env.PI_CODING_AGENT_DIR).toBe("/explicit/agent");
  });

  it("resolvePiAgentDir is byte-identical to the spawned PI_CODING_AGENT_DIR (plain + override)", async () => {
    const config = persistedConfigSchema.parse({ daemon: { piHome: "/custom/.pi" } });
    const { deps, spawns } = fakeDeps();
    await resolveProviderClient("pi", config, deps).createSession({ provider: "pi", cwd: "/w" });
    expect(resolvePiAgentDir(config)).toBe(spawns[0]?.env.PI_CODING_AGENT_DIR);

    const overridden = persistedConfigSchema.parse({
      daemon: { piHome: "/custom/.pi" },
      agents: { providers: { pi: { env: { PI_CODING_AGENT_DIR: "/explicit/agent" } } } },
    });
    const { deps: deps2, spawns: spawns2 } = fakeDeps();
    await resolveProviderClient("pi", overridden, deps2).createSession({
      provider: "pi",
      cwd: "/w",
    });
    expect(resolvePiAgentDir(overridden)).toBe("/explicit/agent");
    expect(resolvePiAgentDir(overridden)).toBe(spawns2[0]?.env.PI_CODING_AGENT_DIR);
  });

  it("resolvePiAuthPaths derives auth.json/models.json from resolvePiAgentDir, byte-identical to the spawned PI_CODING_AGENT_DIR (plain + override)", async () => {
    const config = persistedConfigSchema.parse({ daemon: { piHome: "/custom/.pi" } });
    const { deps, spawns } = fakeDeps();
    await resolveProviderClient("pi", config, deps).createSession({ provider: "pi", cwd: "/w" });
    expect(resolvePiAuthPaths(config)).toEqual({
      authPath: join("/custom/.pi", "agent", "auth.json"),
      modelsPath: join("/custom/.pi", "agent", "models.json"),
    });
    expect(resolvePiAuthPaths(config).authPath).toBe(
      join(spawns[0]?.env.PI_CODING_AGENT_DIR ?? "", "auth.json"),
    );

    const overridden = persistedConfigSchema.parse({
      daemon: { piHome: "/custom/.pi" },
      agents: { providers: { pi: { env: { PI_CODING_AGENT_DIR: "/explicit/agent" } } } },
    });
    const { deps: deps2, spawns: spawns2 } = fakeDeps();
    await resolveProviderClient("pi", overridden, deps2).createSession({
      provider: "pi",
      cwd: "/w",
    });
    expect(resolvePiAuthPaths(overridden)).toEqual({
      authPath: "/explicit/agent/auth.json",
      modelsPath: "/explicit/agent/models.json",
    });
    expect(resolvePiAuthPaths(overridden).authPath).toBe(
      join(spawns2[0]?.env.PI_CODING_AGENT_DIR ?? "", "auth.json"),
    );
  });

  it("resolvePiAuthPaths is empty (Pi's own defaults) with no piHome/override set", () => {
    expect(resolvePiAuthPaths(persistedConfigSchema.parse({}))).toEqual({});
  });

  it("resolvePiAgentDir and effectivePiHomeKey are byte-identical to the spawned PI_CODING_AGENT_DIR for a tilde-prefixed piHome", async () => {
    const config = persistedConfigSchema.parse({ daemon: { piHome: "~/.pi-studio-test-home" } });
    const { deps, spawns } = fakeDeps();
    await resolveProviderClient("pi", config, deps).createSession({ provider: "pi", cwd: "/w" });
    const resolved = resolvePiAgentDir(config);
    // pi's own `normalizePath` expands a leading `~/` against `homedir()` but never resolves a
    // relative path — so this value must already be absolute and must not contain a literal `~`,
    // or the install target (state key / executor env) and the agent's load path silently diverge.
    expect(resolved).toBe(join(homedir(), ".pi-studio-test-home", "agent"));
    expect(resolved?.startsWith("~")).toBe(false);
    expect(resolved).toBe(spawns[0]?.env.PI_CODING_AGENT_DIR);
    expect(resolved).toBe(effectivePiHomeKey(config));
  });

  it("resolvePiAgentDir and effectivePiHomeKey are byte-identical to the spawned PI_CODING_AGENT_DIR for a relative piHome", async () => {
    const config = persistedConfigSchema.parse({ daemon: { piHome: "relative-pihome" } });
    const { deps, spawns } = fakeDeps();
    await resolveProviderClient("pi", config, deps).createSession({ provider: "pi", cwd: "/w" });
    const resolved = resolvePiAgentDir(config);
    expect(resolved).toBe(resolve("relative-pihome", "agent"));
    expect(resolved && isAbsolute(resolved)).toBe(true);
    expect(resolved).toBe(spawns[0]?.env.PI_CODING_AGENT_DIR);
    expect(resolved).toBe(effectivePiHomeKey(config));
  });

  it("resolvePiAgentDir and effectivePiHomeKey are byte-identical for a tilde-prefixed provider env override", () => {
    const config = persistedConfigSchema.parse({
      agents: { providers: { pi: { env: { PI_CODING_AGENT_DIR: "~/.pi-studio-test-override" } } } },
    });
    const resolved = resolvePiAgentDir(config);
    expect(resolved).toBe(join(homedir(), ".pi-studio-test-override"));
    expect(resolved).toBe(effectivePiHomeKey(config));
  });

  it("resolvePiAgentDir returns undefined (Pi's own default) with no piHome/override set", () => {
    expect(resolvePiAgentDir(persistedConfigSchema.parse({}))).toBeUndefined();
  });

  it("rejects an unknown provider id", () => {
    expect(() => resolveProviderClient("my-fork", persistedConfigSchema.parse({}))).toThrow(
      "unknown provider: my-fork",
    );
  });
});

describe("ProviderRegistry", () => {
  it("answers the manifest as is", () => {
    const registry = new ProviderRegistry();
    expect(registry.getMetadata("pi")?.id).toBe("pi");
    expect(registry.listMetadata().map((d) => d.id)).toContain("pi");
  });
});
