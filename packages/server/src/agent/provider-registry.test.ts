import { mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { persistedConfigSchema } from "../config/daemon-config.js";
import { effectivePiHomeKey } from "../extensions/extensions-state.js";
import { PROVIDER_MANIFEST } from "./manifest.js";
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
  it("exposes pi modes with colorTier + icon", () => {
    const pi = PROVIDER_MANIFEST.pi;
    expect(pi.id).toBe("pi");
    expect(pi.modes.find((m) => m.id === "full-access")?.colorTier).toBe("dangerous");
    expect(pi.modes.find((m) => m.id === "plan")?.icon).toBe("Compass");
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

  it("launches a custom extends:pi profile via its command and finds imports via params.sessionDir", async () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "fork-sessions-"));
    writeFileSync(
      join(sessionDir, "s1.jsonl"),
      `${JSON.stringify({ cwd: "/w", title: "Forked" })}\n`,
    );

    const config = persistedConfigSchema.parse({
      agents: {
        providers: {
          "my-fork": {
            extends: "pi",
            label: "My Fork",
            command: ["my-pi", "--mode", "rpc"],
            params: { sessionDir },
          },
        },
      },
    });
    const { deps, spawns } = fakeDeps();
    const client = resolveProviderClient("my-fork", config, deps);
    expect(client.provider).toBe("my-fork");

    await client.createSession({ provider: "my-fork", cwd: "/w" });
    expect(spawns[0]?.args[0]).toBe("my-pi");

    const rows = await client.listImportableSessions!();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("Forked");
  });

  it("applies models override (replace) and additionalModels (merge)", async () => {
    const config = persistedConfigSchema.parse({
      agents: {
        providers: {
          "fork-b": {
            extends: "pi",
            label: "Fork B",
            command: ["forkb"],
            models: [{ id: "m1", label: "One" }],
            additionalModels: [{ id: "m2", label: "Two" }],
          },
        },
      },
    });
    const { deps } = fakeDeps();
    const client = resolveProviderClient("fork-b", config, deps);
    const models = await client.listModels();
    expect(models.map((m) => m.id).toSorted()).toEqual(["m1", "m2"]);
  });
});

describe("ProviderRegistry metadata replacement", () => {
  it("updates visible metadata without spawning Pi", () => {
    const { deps, spawns } = fakeDeps();
    const registry = new ProviderRegistry();
    const config = persistedConfigSchema.parse({
      agents: { providers: { "my-fork": { extends: "pi", label: "Relabeled Fork" } } },
    });

    registry.replaceMetadata(config);
    // Re-resolving the client after a metadata replace must not spawn the process.
    resolveProviderClient("pi", config, deps);

    expect(registry.getMetadata("my-fork")?.label).toBe("Relabeled Fork");
    expect(spawns).toHaveLength(0); // building a client never spawns
  });
});
