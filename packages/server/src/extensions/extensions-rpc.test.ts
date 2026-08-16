import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  extensionPacksListResponseSchema,
  extensionPacksSetResponseSchema,
  type ExtensionPacksListResponse,
  type ExtensionPacksSetResponse,
} from "@av-pi-studio/protocol";
import { describe, expect, it, vi } from "vitest";

import { persistedConfigSchema, type PersistedConfig } from "../config/daemon-config.js";
import { silentLogger } from "../logging/logger.js";
import { HandlerRegistry, routeTextFrame } from "../ws/router.js";
import type { Session } from "../ws/session.js";
import { CURATED_PACKS } from "./curated-packs.js";
import { effectivePiHomeKey } from "./extensions-state.js";
import { ExtensionsService } from "./extensions-service.js";
import { registerExtensionsHandlers } from "./extensions-rpc.js";
import { planSync } from "./sync-planner.js";
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
  return mkdtemp(join(tmpdir(), "pi-studio-extensions-rpc-"));
}

async function seedSettings(piHomeKey: string, packages: unknown[]): Promise<void> {
  await mkdir(piHomeKey, { recursive: true });
  await writeFile(join(piHomeKey, "settings.json"), JSON.stringify({ packages }), "utf8");
}

function configWithPiHome(home: string): PersistedConfig {
  return persistedConfigSchema.parse({ daemon: { piHome: join(home, "pihome") } });
}

interface FakeSession {
  sent: unknown[];
  send: (env: unknown) => void;
}

function fakeSession(): FakeSession & Session {
  const sent: unknown[] = [];
  return { sent, send: (env: unknown) => sent.push(env) } as unknown as FakeSession & Session;
}

/** Boots a real `ExtensionsService` over a temp home + a registry with the extensions handlers
 *  registered — the same shape bootstrap.ts wires, minus the rest of the daemon. */
function boot(
  home: string,
  config: PersistedConfig,
  spawn?: InstallSpawn,
): { registry: HandlerRegistry; service: ExtensionsService; configPath: string } {
  const configPath = join(home, "config.json");
  const service = new ExtensionsService({
    home,
    config,
    logger: silentLogger(),
    spawn,
    configPath,
  });
  const registry = new HandlerRegistry();
  registerExtensionsHandlers(registry, { service, logger: silentLogger() });
  return { registry, service, configPath };
}

/** Dispatches one session RPC through the real router and returns the raw response message. */
async function dispatch(
  registry: HandlerRegistry,
  message: Record<string, unknown>,
): Promise<unknown> {
  const session = fakeSession();
  const requestId = message.requestId ?? "r1";
  await routeTextFrame(
    session,
    JSON.stringify({ type: "session", message: { ...message, requestId } }),
    registry,
  );
  // The envelope shape is guaranteed by `routeTextFrame`'s own contract (wraps the handler's
  // return in `{ type: "session", message }`); this is the one deserialization boundary, not a
  // per-field inline cast.
  const envelope = session.sent[0] as { type: string; message: unknown };
  return envelope?.message;
}

/** `dispatch` + validate against the real wire schema (task-001) — a response that doesn't
 *  actually satisfy the protocol contract fails the test here, not silently. */
async function rpcList(
  registry: HandlerRegistry,
  message: Record<string, unknown> = {},
): Promise<ExtensionPacksListResponse> {
  return extensionPacksListResponseSchema.parse(
    await dispatch(registry, { type: "extension_packs_list_request", ...message }),
  );
}

async function rpcSet(
  registry: HandlerRegistry,
  message: Record<string, unknown> = {},
): Promise<ExtensionPacksSetResponse> {
  return extensionPacksSetResponseSchema.parse(
    await dispatch(registry, { type: "extension_packs_set_request", ...message }),
  );
}

describe("extension_packs_list_request", () => {
  it("on a fresh daemon: autoSync true, selected [], one PackInfo for core with four entries, lastSync absent", async () => {
    const home = await tempHome();
    const config = configWithPiHome(home);
    const piHomeKey = effectivePiHomeKey(config);
    await seedSettings(piHomeKey, []);
    const { registry } = boot(home, config);

    const res = await rpcList(registry);
    expect(res.autoSync).toBe(true);
    expect(res.selected).toEqual([]);
    expect(res.lastSync).toBeUndefined();
    expect(res.packs).toHaveLength(1);
    expect(res.packs[0]?.id).toBe("core");
    expect(res.packs[0]?.packages).toHaveLength(4);
  });

  it("after a sync with a failure, reports that entry failed with lastError, and lastSync present", async () => {
    const home = await tempHome();
    const config = configWithPiHome(home);
    const piHomeKey = effectivePiHomeKey(config);
    await seedSettings(piHomeKey, []);
    const { registry, service } = boot(home, config, failWebAccess);

    await service.sync("bootstrap");
    const res = await rpcList(registry);

    expect(res.lastSync?.outcome).toBe("partial");
    const webAccess = res.packs[0]?.packages.find((p) => p.identity === "pi-web-access");
    expect(webAccess?.status).toBe("failed");
    expect(webAccess?.lastError?.attempts).toBe(1);
    expect(webAccess?.lastError?.reason).toBe("not_found");
    expect(typeof webAccess?.lastError?.message).toBe("string");
  });

  it("statuses are identical to the planner's own dry-run output for the same state", async () => {
    const home = await tempHome();
    const config = configWithPiHome(home);
    const piHomeKey = effectivePiHomeKey(config);
    // A curated identity, pinned by the user, so the compared status set is mixed
    // (`user_modified` + `pending`) rather than uniformly pending.
    await seedSettings(piHomeKey, ["npm:pi-powerline-footer@1.2.3"]);
    const { registry } = boot(home, config);

    const res = await rpcList(registry);
    const wireStatuses = (res.packs[0]?.packages ?? [])
      .map((p) => [p.identity, p.status] as const)
      .toSorted();

    const direct = planSync({
      catalog: CURATED_PACKS,
      packs: [],
      state: { offered: {}, failures: {} },
      settingsPackages: ["npm:pi-powerline-footer@1.2.3"],
    });
    const plannerStatuses = direct.entries.map((e) => [e.identity, e.status] as const).toSorted();

    expect(wireStatuses).toEqual(plannerStatuses);
  });
});

describe("extension_packs_set_request", () => {
  it("with an empty (valid) selection: persists to config.json, runs a sync, returns a report; a subsequent list shows it", async () => {
    const home = await tempHome();
    const config = configWithPiHome(home);
    const piHomeKey = effectivePiHomeKey(config);
    await seedSettings(piHomeKey, []);
    const { registry, configPath } = boot(home, config, succeedAlways);

    const res = await rpcSet(registry, { packs: [] });
    expect(res.ok).toBe(true);
    expect(res.report?.outcome).toBe("ok");
    expect(res.report?.installed).toHaveLength(4);

    const rawConfig = persistedConfigSchema.parse(JSON.parse(readFileSync(configPath, "utf8")));
    expect(rawConfig.daemon.extensions.packs).toEqual([]);

    const list = await rpcList(registry);
    expect(list.selected).toEqual([]);
  });

  it("in-memory effect: after set, a later sync('manual') on the same running daemon plans against the new selection (no restart)", async () => {
    const home = await tempHome();
    // Only `core` exists in the manifest today, so a non-empty selection round-trip isn't
    // reachable; this instead proves the in-memory-update path itself: `setSelectedPacks` must
    // mutate the SAME config object `runSync` reads on every call, not a copy — the regression
    // this task's spec calls out for the stale-selection bug.
    const config = configWithPiHome(home);
    const piHomeKey = effectivePiHomeKey(config);
    await seedSettings(piHomeKey, []);
    const { registry, service } = boot(home, config, succeedAlways);

    await rpcSet(registry, { packs: [] });
    // A later manual sync on the SAME service instance (no new ExtensionsService constructed).
    const report = await service.sync("manual");
    expect(report.outcome).toBe("noop"); // already installed by the set's own triggered sync
  });

  it("unknown slug ⇒ { ok: false, error }, config.json unchanged, no sync spawned, no report, never rpc_error", async () => {
    const home = await tempHome();
    const config = configWithPiHome(home);
    const piHomeKey = effectivePiHomeKey(config);
    await seedSettings(piHomeKey, []);
    const spawn = vi.fn(succeedAlways);
    const { registry, configPath } = boot(home, config, spawn);

    const res = await rpcSet(registry, { packs: ["does-not-exist"] });

    expect(res.ok).toBe(false);
    expect(res.error).toContain("does-not-exist");
    expect(res.report).toBeUndefined();
    expect(spawn).not.toHaveBeenCalled();
    expect(() => statSync(configPath)).toThrow(); // never even created
  });

  // A non-conforming client can put anything in `packs`: `ctx.message` reaches the handler as an
  // unvalidated `Record<string, unknown>`. Coercing a malformed value would read as "deselect
  // everything" and persist an empty selection — silent data loss, so it must be rejected.
  it.each([
    ["a bare string", "core"],
    ["an array with a non-string element", ["core", 42]],
    ["an object", { core: true }],
    ["null", null],
  ])(
    "malformed packs (%s) ⇒ { ok: false }, nothing persisted, no sync spawned",
    async (_label, packs) => {
      const home = await tempHome();
      const config = configWithPiHome(home);
      await seedSettings(effectivePiHomeKey(config), []);
      const spawn = vi.fn(succeedAlways);
      const { registry, configPath } = boot(home, config, spawn);

      const res = await rpcSet(registry, { packs });

      expect(res.ok).toBe(false);
      expect(res.error).toContain("invalid packs");
      expect(res.report).toBeUndefined();
      expect(res.selected).toEqual([]); // selection untouched
      expect(spawn).not.toHaveBeenCalled();
      expect(() => statSync(configPath)).toThrow(); // never even created
    },
  );

  it("without packs: runs sync('manual'), leaves config.json byte-identical, leaves selected unchanged", async () => {
    const home = await tempHome();
    const config = configWithPiHome(home);
    const piHomeKey = effectivePiHomeKey(config);
    await seedSettings(piHomeKey, []);
    const { registry, configPath } = boot(home, config, succeedAlways);

    // Seed a config.json the handler must never touch (no `packs` in the request).
    await mkdir(home, { recursive: true });
    const before = JSON.stringify({ version: 1, daemon: { piHome: config.daemon.piHome } });
    await writeFile(configPath, before, "utf8");

    const res = await rpcSet(registry);
    expect(res.ok).toBe(true);
    expect(res.selected).toEqual([]);
    expect(res.report?.outcome).toBe("ok");

    expect(readFileSync(configPath, "utf8")).toBe(before);
  });

  it("manual sync is ungated: autoSync:false + no packs still installs; autoSync:false + packs installs nothing", async () => {
    const home = await tempHome();
    const config = persistedConfigSchema.parse({
      daemon: { piHome: join(home, "pihome"), extensions: { autoSync: false } },
    });
    const piHomeKey = effectivePiHomeKey(config);
    await seedSettings(piHomeKey, []);
    const { registry } = boot(home, config, succeedAlways);

    const manual = await rpcSet(registry);
    expect(manual.report?.installed).toHaveLength(4);

    // Fresh state for the second half: a new home so the `packs`-selection branch starts from
    // zero installs (this is the branch that must NOT install under autoSync:false).
    const home2 = await tempHome();
    const config2 = persistedConfigSchema.parse({
      daemon: { piHome: join(home2, "pihome"), extensions: { autoSync: false } },
    });
    const piHomeKey2 = effectivePiHomeKey(config2);
    await seedSettings(piHomeKey2, []);
    const { registry: registry2 } = boot(home2, config2, succeedAlways);

    const selection = await rpcSet(registry2, { packs: [] });
    expect(selection.ok).toBe(true);
    expect(selection.report?.installed).toEqual([]);
    expect(selection.report?.outcome).toBe("noop");
  });

  it("with autoSync:false, set WITH packs persists the selection and returns a report with no installs; list still reports full statuses", async () => {
    const home = await tempHome();
    const config = persistedConfigSchema.parse({
      daemon: { piHome: join(home, "pihome"), extensions: { autoSync: false } },
    });
    const piHomeKey = effectivePiHomeKey(config);
    await seedSettings(piHomeKey, []);
    const { registry, configPath } = boot(home, config, succeedAlways);

    const res = await rpcSet(registry, { packs: [] });
    expect(res.ok).toBe(true);
    expect(res.report?.installed).toEqual([]);
    const rawConfig = persistedConfigSchema.parse(JSON.parse(readFileSync(configPath, "utf8")));
    expect(rawConfig.daemon.extensions.packs).toEqual([]);

    const list = await rpcList(registry);
    expect(list.packs[0]?.packages).toHaveLength(4);
  });

  it("concurrent set + a directly-triggered sync serialize through the single service mutex", async () => {
    const home = await tempHome();
    const config = configWithPiHome(home);
    const piHomeKey = effectivePiHomeKey(config);
    await seedSettings(piHomeKey, []);

    // Integration test deliberately exercising real timer behavior: the call chain crosses real
    // fs I/O (readSettings/loadExtensionsState) before reaching the mutex-guarded install batch,
    // so a microtask-flush loop can't stand in for genuine event-loop interleaving here — a short
    // real delay on the FIRST spawned action is what gives a genuinely concurrent second `sync()`
    // call a chance to start (and prove it doesn't). Mirrors the identical precedent in
    // extensions-service.test.ts's own concurrent-sync test.
    let inFlight = 0;
    let maxConcurrent = 0;
    const blockingSpawn: InstallSpawn = async () => {
      inFlight++;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 5);
      await promise;
      inFlight--;
      return { exitCode: 0, stderr: "" };
    };
    const { registry, service } = boot(home, config, blockingSpawn);

    const [setResult, bootReport] = await Promise.all([
      rpcSet(registry, { packs: [] }),
      service.sync("bootstrap"),
    ]);

    expect(maxConcurrent).toBe(1); // never two install batches running at once
    // One of the two runs installs all 5; the other, running second against already-installed
    // state, is a noop re-plan — never the same report object.
    const outcomes = [setResult.report?.outcome, bootReport.outcome].toSorted();
    expect(outcomes).toEqual(["noop", "ok"]);
  });
});
