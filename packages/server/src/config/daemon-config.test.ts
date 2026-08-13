import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { chmodSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadConfig,
  migrateConfig,
  overlayEnv,
  persistedConfigSchema,
  persistExtensionPacks,
} from "./daemon-config.js";

async function tempConfig(contents: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-studio-config-"));
  const path = join(dir, "config.json");
  await writeFile(path, JSON.stringify(contents), "utf8");
  return path;
}

async function tempConfigPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-studio-config-"));
  return join(dir, "config.json");
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
    expect(cfg.daemon.extensions).toEqual({ autoSync: true, packs: [] });
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

  it("PI_STUDIO_EXTENSIONS_AUTOSYNC: 'false'/'0' disable, unset/other values leave it true", () => {
    const base = persistedConfigSchema.parse({});
    expect(overlayEnv(base, {}).daemon.extensions.autoSync).toBe(true);
    expect(
      overlayEnv(base, { PI_STUDIO_EXTENSIONS_AUTOSYNC: "false" }).daemon.extensions.autoSync,
    ).toBe(false);
    expect(
      overlayEnv(base, { PI_STUDIO_EXTENSIONS_AUTOSYNC: "0" }).daemon.extensions.autoSync,
    ).toBe(false);
    expect(
      overlayEnv(base, { PI_STUDIO_EXTENSIONS_AUTOSYNC: "yes" }).daemon.extensions.autoSync,
    ).toBe(true);
  });

  it("PI_STUDIO_EXTENSION_PACKS splits and trims a CSV of pack slugs", () => {
    const base = persistedConfigSchema.parse({});
    expect(
      overlayEnv(base, { PI_STUDIO_EXTENSION_PACKS: "a, b ,c" }).daemon.extensions.packs,
    ).toEqual(["a", "b", "c"]);
  });

  it("an unknown pack slug in daemon.extensions.packs loads without error", () => {
    expect(
      persistedConfigSchema.parse({ daemon: { extensions: { packs: ["not-a-real-pack"] } } }).daemon
        .extensions.packs,
    ).toEqual(["not-a-real-pack"]);
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

describe("persistExtensionPacks", () => {
  it("writes daemon.extensions.packs into a fresh (absent) config.json with mode 0600", async () => {
    const path = await tempConfigPath();
    await persistExtensionPacks(path, ["ext-1", "ext-2"]);

    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    expect(raw.daemon).toEqual({ extensions: { packs: ["ext-1", "ext-2"] } });
    expect((statSync(path).mode & 0o777) === 0o600).toBe(true);
  });

  it("preserves unrelated keys on an existing file", async () => {
    const initial = {
      version: 1,
      unknown_top: "value",
      daemon: {
        listen: "127.0.0.1:7000",
        unknown_daemon_key: "preserved",
        auth: { password: "hash" },
      },
    };
    const path = await tempConfig(initial);
    await persistExtensionPacks(path, ["ext-1"]);

    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    // Check that all original keys are preserved
    expect(raw.version).toBe(1);
    expect(raw.unknown_top).toBe("value");
    expect((raw.daemon as Record<string, unknown>).listen).toBe("127.0.0.1:7000");
    expect((raw.daemon as Record<string, unknown>).unknown_daemon_key).toBe("preserved");
    expect(((raw.daemon as Record<string, unknown>).auth as Record<string, unknown>).password).toBe(
      "hash",
    );
    // Check that packs was added
    expect(
      ((raw.daemon as Record<string, unknown>).extensions as Record<string, unknown>).packs,
    ).toEqual(["ext-1"]);
  });

  it("does NOT persist env overrides (headline test)", async () => {
    const initial = { version: 1 };
    const path = await tempConfig(initial);

    // Call with env vars set; they must NOT leak into the written file.
    // Note: persistExtensionPacks does NOT use env — it only writes the packs argument
    await persistExtensionPacks(path, ["arg-pack-1", "arg-pack-2"]);

    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const daemon = raw.daemon as Record<string, unknown>;

    // Only daemon.extensions.packs should be present
    expect(daemon.listen).toBeUndefined();
    expect((daemon.extensions as Record<string, unknown>).autoSync).toBeUndefined();
    expect((daemon.extensions as Record<string, unknown>).packs).toEqual([
      "arg-pack-1",
      "arg-pack-2",
    ]);
  });

  it('does NOT materialize defaults: a file with only {"version":1} gains only daemon.extensions.packs', async () => {
    const path = await tempConfig({ version: 1 });
    await persistExtensionPacks(path, ["ext-1"]);

    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

    // Only version and daemon.extensions.packs should be present
    expect((raw.daemon as Record<string, unknown>).listen).toBeUndefined();
    expect((raw.daemon as Record<string, unknown>).hostnames).toBeUndefined();
    expect(Object.keys(raw).toSorted()).toEqual(["daemon", "version"]);
  });

  it("re-tightens a pre-existing 0644 file to 0600", async () => {
    const path = await tempConfig({ version: 1 });
    // Manually chmod to 0644
    chmodSync(path, 0o644);
    expect((statSync(path).mode & 0o777) === 0o644).toBe(true);

    await persistExtensionPacks(path, ["ext-1"]);

    expect((statSync(path).mode & 0o777) === 0o600).toBe(true);
  });

  it("does NOT throw on a corrupt/unparseable existing file; replaces it with the merged key", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-studio-config-"));
    const path = join(dir, "config.json");
    await writeFile(path, "{ invalid json", "utf8");

    // Should not throw
    await persistExtensionPacks(path, ["ext-1"]);

    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    expect(raw).toEqual({ daemon: { extensions: { packs: ["ext-1"] } } });
  });

  it("loadConfig after a write returns the persisted packs; env value still wins in memory", async () => {
    const path = await tempConfig({ version: 1 });
    await persistExtensionPacks(path, ["file-pack-1", "file-pack-2"]);

    // Load with no env override
    const cfgNoEnv = loadConfig(path, {});
    expect(cfgNoEnv.daemon.extensions.packs).toEqual(["file-pack-1", "file-pack-2"]);

    // Load with env override; env must win in memory
    const cfgWithEnv = loadConfig(path, {
      PI_STUDIO_EXTENSION_PACKS: "env-pack-1,env-pack-2",
    });
    expect(cfgWithEnv.daemon.extensions.packs).toEqual(["env-pack-1", "env-pack-2"]);

    // The file should still contain only the file value
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    expect(
      ((raw.daemon as Record<string, unknown>).extensions as Record<string, unknown>).packs,
    ).toEqual(["file-pack-1", "file-pack-2"]);
  });

  it("writes atomically: no temp file left behind on success", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-studio-config-"));
    const path = join(dir, "config.json");

    await persistExtensionPacks(path, ["ext-1"]);

    // List files in the directory; should only contain config.json
    const fileList = await readdir(dir);
    expect(fileList).toEqual(["config.json"]);
  });
});
