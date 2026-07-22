import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfig, migrateConfig, overlayEnv, persistedConfigSchema } from "./daemon-config.js";

async function tempConfig(contents: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-studio-config-"));
  const path = join(dir, "config.json");
  await writeFile(path, JSON.stringify(contents), "utf8");
  return path;
}

describe("defaults", () => {
  it("missing config.json yields all defaults", () => {
    const cfg = loadConfig(join(tmpdir(), "definitely-missing-pi-studio-config.json"), {});
    expect(cfg.version).toBe(1);
    expect(cfg.daemon.listen).toBe("127.0.0.1:6767");
    expect(cfg.daemon.hostnames).toEqual(["localhost", "*.localhost"]);
    expect(cfg.daemon.mcp).toEqual({ enabled: true, injectIntoAgents: true });
    expect(cfg.daemon.relay.enabled).toBe(false);
    expect(cfg.log.level).toBe("info");
    expect(cfg.agents.providers).toEqual({});
  });

  it("an empty object parses to defaults", () => {
    expect(persistedConfigSchema.parse({}).daemon.listen).toBe("127.0.0.1:6767");
  });
});

describe("legacy migration", () => {
  it("migrates daemon.allowedHosts → hostnames", async () => {
    const path = await tempConfig({ daemon: { allowedHosts: ["a.local", "b.local"] } });
    const cfg = loadConfig(path, {});
    expect(cfg.daemon.hostnames).toEqual(["a.local", "b.local"]);
  });

  it("migrates top-level allowedHosts → hostnames", () => {
    const migrated = migrateConfig({ allowedHosts: true }) as { daemon: { hostnames: unknown } };
    expect(migrated.daemon.hostnames).toBe(true);
  });

  it("loads a legacy provider command:{mode,…} without error", async () => {
    const path = await tempConfig({
      agents: {
        providers: {
          "my-fork": {
            extends: "pi",
            label: "My Fork",
            command: { mode: "rpc", command: "pi-fork", args: ["--flag"] },
          },
        },
      },
    });
    const cfg = loadConfig(path, {});
    expect(cfg.agents.providers["my-fork"]?.command).toEqual(["pi-fork", "--flag"]);
  });
});

describe("env overlay (env wins)", () => {
  it("overrides listen, password, relay, app.baseUrl, service-proxy and piHome keys", () => {
    const base = persistedConfigSchema.parse({});
    const cfg = overlayEnv(base, {
      PI_STUDIO_LISTEN: "0.0.0.0:7000",
      PI_STUDIO_PASSWORD: "$2b$hash",
      PI_STUDIO_RELAY_ENABLED: "true",
      PI_STUDIO_RELAY_ENDPOINT: "relay.internal:9000",
      PI_STUDIO_RELAY_USE_TLS: "true",
      PI_STUDIO_APP_BASE_URL: "http://localhost:8080",
      PI_STUDIO_SERVICE_PROXY_LISTEN: "127.0.0.1:8080",
      PI_STUDIO_SERVICE_PROXY_ENABLED: "1",
      PI_STUDIO_PI_HOME: "/custom/.pi",
    });
    expect(cfg.daemon.listen).toBe("0.0.0.0:7000");
    expect(cfg.daemon.auth.password).toBe("$2b$hash");
    expect(cfg.daemon.relay.enabled).toBe(true);
    expect(cfg.daemon.relay.endpoint).toBe("relay.internal:9000");
    expect(cfg.daemon.relay.useTls).toBe(true);
    expect(cfg.app.baseUrl).toBe("http://localhost:8080");
    expect(cfg.daemon.serviceProxy.listen).toBe("127.0.0.1:8080");
    expect(cfg.daemon.serviceProxy.enabled).toBe(true);
    expect(cfg.daemon.piHome).toBe("/custom/.pi");
  });

  it("PI_STUDIO_HOSTNAMES='true' disables the allowlist, else splits a CSV", () => {
    const base = persistedConfigSchema.parse({});
    expect(overlayEnv(base, { PI_STUDIO_HOSTNAMES: "true" }).daemon.hostnames).toBe(true);
    expect(overlayEnv(base, { PI_STUDIO_HOSTNAMES: "a, b ,c" }).daemon.hostnames).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe("provider validation", () => {
  it("rejects a custom provider missing extends + label", async () => {
    const path = await tempConfig({ agents: { providers: { "my-fork": { description: "x" } } } });
    expect(() => loadConfig(path, {})).toThrow();
  });

  it("rejects a bad provider id", async () => {
    const path = await tempConfig({
      agents: { providers: { "Bad-Id": { extends: "pi", label: "X" } } },
    });
    expect(() => loadConfig(path, {})).toThrow();
  });

  it("allows overriding the built-in pi provider without extends/label", async () => {
    const path = await tempConfig({
      agents: { providers: { pi: { disallowedTools: ["shell"] } } },
    });
    const cfg = loadConfig(path, {});
    expect(cfg.agents.providers.pi?.disallowedTools).toEqual(["shell"]);
  });

  it("accepts a valid custom profile", async () => {
    const path = await tempConfig({
      agents: { providers: { "my-fork": { extends: "pi", label: "My Fork", order: 2 } } },
    });
    const cfg = loadConfig(path, {});
    expect(cfg.agents.providers["my-fork"]?.label).toBe("My Fork");
  });
});
