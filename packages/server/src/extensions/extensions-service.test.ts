import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { persistedConfigSchema, type PersistedConfig } from "../config/daemon-config.js";
import { silentLogger } from "../logging/logger.js";
import { effectivePiHomeKey, loadExtensionsState } from "./extensions-state.js";
import { ExtensionsService } from "./extensions-service.js";
import type { InstallSpawn } from "./sync-executor.js";

/** Every core entry always succeeds — mirrors a healthy first boot, offline. */
const succeedAlways: InstallSpawn = async () => ({ exitCode: 0, stderr: "" });

/** `pi-web-access` fails with a 404; every other action succeeds. */
const failWebAccess: InstallSpawn = async ({ command }) => {
  const source = command.at(-1) as string;
  return source.includes("pi-web-access")
    ? { exitCode: 1, stderr: "npm error 404 Not Found" }
    : { exitCode: 0, stderr: "" };
};

async function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pi-studio-extensions-service-"));
}

async function seedSettings(piHomeKey: string, packages: unknown[]): Promise<void> {
  await mkdir(piHomeKey, { recursive: true });
  await writeFile(join(piHomeKey, "settings.json"), JSON.stringify({ packages }), "utf8");
}

function configWithPiHome(home: string): PersistedConfig {
  return persistedConfigSchema.parse({ daemon: { piHome: join(home, "pihome") } });
}

describe("ExtensionsService.sync", () => {
  it("a fresh pi-home installs every offerable core entry (offline, injected seam)", async () => {
    const home = await tempHome();
    const config = configWithPiHome(home);
    const service = new ExtensionsService({
      home,
      config,
      logger: silentLogger(),
      spawn: succeedAlways,
    });

    const report = await service.sync("bootstrap");
    expect(report.outcome).toBe("ok");
    expect(report.installed).toHaveLength(4);
    expect(report.failures).toEqual([]);
  });

  it("a pre-existing user-pinned entry is never installed over on first sync", async () => {
    const home = await tempHome();
    const config = configWithPiHome(home);
    const piHomeKey = effectivePiHomeKey(config);
    // The user installed two of the curated packages themselves, before Pi-Studio ever ran here —
    // one pinned to an exact version, one filtered via the object form.
    await seedSettings(piHomeKey, [
      "npm:@juicesharp/rpiv-todo@0.4.1",
      { source: "npm:pi-web-access", tools: ["fetch"] },
    ]);
    const spawned: string[] = [];
    const spawn: InstallSpawn = async ({ command }) => {
      spawned.push(command.at(-1) as string);
      return { exitCode: 0, stderr: "" };
    };
    const service = new ExtensionsService({ home, config, logger: silentLogger(), spawn });

    const report = await service.sync("bootstrap");

    // `pi install` is never spawned for either of the user's own entries — spawning it would let
    // pi's own settings-merge rewrite their pin/filter in place.
    expect(spawned).not.toContain("npm:@juicesharp/rpiv-todo");
    expect(spawned).not.toContain("npm:pi-web-access");
    expect(spawned).toHaveLength(2);
    expect(report.installed).toHaveLength(2);

    const described = await service.describe();
    expect(described.entries.find((e) => e.identity === "@juicesharp/rpiv-todo")?.status).toBe(
      "user_modified",
    );
    expect(described.entries.find((e) => e.identity === "pi-web-access")?.status).toBe(
      "user_modified",
    );
  });

  it("second sync with an unchanged manifest performs zero installs (outcome noop)", async () => {
    const home = await tempHome();
    const config = configWithPiHome(home);
    const spawn = vi.fn(succeedAlways);
    const service = new ExtensionsService({ home, config, logger: silentLogger(), spawn });

    await service.sync("bootstrap");
    spawn.mockClear();
    const second = await service.sync("bootstrap");

    expect(second.outcome).toBe("noop");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("persists a { at, outcome } lastSync summary readable via describe()", async () => {
    const home = await tempHome();
    const config = configWithPiHome(home);
    const service = new ExtensionsService({
      home,
      config,
      logger: silentLogger(),
      spawn: succeedAlways,
    });

    await service.sync("bootstrap");
    const described = await service.describe();
    expect(described.lastSync?.outcome).toBe("ok");
    expect(described.lastSync?.at).toBeTruthy();
  });

  it("autoSync: false ⇒ bootstrap/selection perform no installs and never spawn pi", async () => {
    const home = await tempHome();
    const config = persistedConfigSchema.parse({
      daemon: { piHome: join(home, "pihome"), extensions: { autoSync: false } },
    });
    const spawn = vi.fn(succeedAlways);
    const service = new ExtensionsService({ home, config, logger: silentLogger(), spawn });

    const bootstrapReport = await service.sync("bootstrap");
    const selectionReport = await service.sync("selection");
    expect(spawn).not.toHaveBeenCalled();
    expect(bootstrapReport.installed).toEqual([]);
    expect(selectionReport.installed).toEqual([]);
  });

  it("autoSync: false ⇒ manual still runs (the explicit escape hatch)", async () => {
    const home = await tempHome();
    const config = persistedConfigSchema.parse({
      daemon: { piHome: join(home, "pihome"), extensions: { autoSync: false } },
    });
    const spawn = vi.fn(succeedAlways);
    const service = new ExtensionsService({ home, config, logger: silentLogger(), spawn });

    const report = await service.sync("manual");
    expect(spawn).toHaveBeenCalled();
    expect(report.installed).toHaveLength(4);
  });

  it("malformed settings.json ⇒ outcome skipped, no spawn, file left untouched", async () => {
    const home = await tempHome();
    const config = configWithPiHome(home);
    const piHomeKey = effectivePiHomeKey(config);
    await mkdir(piHomeKey, { recursive: true });
    await writeFile(join(piHomeKey, "settings.json"), "{not valid json", "utf8");
    const spawn = vi.fn(succeedAlways);
    const service = new ExtensionsService({ home, config, logger: silentLogger(), spawn });

    const report = await service.sync("bootstrap");
    expect(report.outcome).toBe("skipped");
    expect(spawn).not.toHaveBeenCalled();
    expect(await readFile(join(piHomeKey, "settings.json"), "utf8")).toBe("{not valid json");
  });

  it("corrupt extensions-state.json ⇒ outcome skipped, zero actions, file left byte-identical", async () => {
    const home = await tempHome();
    const config = configWithPiHome(home);
    await mkdir(home, { recursive: true });
    await writeFile(join(home, "extensions-state.json"), "{also not valid", "utf8");
    const spawn = vi.fn(succeedAlways);
    const service = new ExtensionsService({ home, config, logger: silentLogger(), spawn });

    const report = await service.sync("bootstrap");
    expect(report.outcome).toBe("skipped");
    expect(spawn).not.toHaveBeenCalled();
    expect(await readFile(join(home, "extensions-state.json"), "utf8")).toBe("{also not valid");
  });

  it("concurrent sync() calls serialize: two overlapping calls produce one run then a re-plan", async () => {
    const home = await tempHome();
    const config = configWithPiHome(home);
    let inFlight = 0;
    let maxConcurrent = 0;
    const spawn: InstallSpawn = async () => {
      inFlight++;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { exitCode: 0, stderr: "" };
    };
    const service = new ExtensionsService({ home, config, logger: silentLogger(), spawn });

    const [first, second] = await Promise.all([
      service.sync("bootstrap"),
      service.sync("bootstrap"),
    ]);
    // Never overlapping: the second run only starts once the first's actions are all done.
    expect(maxConcurrent).toBe(1);
    // First run installs everything; the second sees it all already offered ⇒ noop.
    expect(first.installed).toHaveLength(4);
    expect(second.outcome).toBe("noop");
  });

  it("a partial sync logs at warn, never error", async () => {
    const home = await tempHome();
    const config = configWithPiHome(home);
    const warnCalls: unknown[] = [];
    const errorCalls: unknown[] = [];
    const logger = {
      ...silentLogger(),
      warn: (...args: unknown[]) => warnCalls.push(args),
      error: (...args: unknown[]) => errorCalls.push(args),
    };
    const spawn = failWebAccess;
    const service = new ExtensionsService({ home, config, logger, spawn });

    const report = await service.sync("bootstrap");
    expect(report.outcome).toBe("partial");
    expect(errorCalls).toEqual([]);
    expect(warnCalls.length).toBeGreaterThan(0);
  });
});

describe("ExtensionsService.describe", () => {
  it("reports statuses without writing anything (dry-run)", async () => {
    const home = await tempHome();
    const config = configWithPiHome(home);
    const piHomeKey = effectivePiHomeKey(config);
    await seedSettings(piHomeKey, []);
    const service = new ExtensionsService({ home, config, logger: silentLogger() });

    const described = await service.describe();
    expect(described.autoSync).toBe(true);
    expect(described.selected).toEqual([]);
    expect(described.entries).toHaveLength(4);
    expect(described.entries.every((e) => e.status === "pending")).toBe(true);
    expect(await loadExtensionsState(home)).toEqual({ version: 1, piHomes: {} });
  });

  it("always works even when autoSync is false", async () => {
    const home = await tempHome();
    const config = persistedConfigSchema.parse({
      daemon: { piHome: join(home, "pihome"), extensions: { autoSync: false } },
    });
    const service = new ExtensionsService({ home, config, logger: silentLogger() });
    const described = await service.describe();
    expect(described.autoSync).toBe(false);
    expect(described.entries).toHaveLength(4);
  });
});
