import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { persistedConfigSchema } from "../config/daemon-config.js";
import { PROVIDER_MANIFEST } from "./manifest.js";
import {
  ProviderRegistry,
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
