import { describe, expect, it, vi, type Mock } from "vitest";

import type { DaemonUpdateStatus } from "@av-pi-studio/protocol";

import {
  UpdateService,
  type BinaryManifestLookup,
  type BinaryUpdateProbes,
  type UpdateServiceDeps,
} from "./update-service.js";

const RELEASES_PAGE = "https://github.com/avatsaev/pi-studio/releases";

interface Setup {
  service: UpdateService;
  broadcasts: DaemonUpdateStatus[];
  fetchLatest: Mock;
  npmOnPath: Mock;
  pipeline: Mock;
}

function setup(
  probes: Partial<BinaryUpdateProbes> = {},
  overrides: Partial<UpdateServiceDeps> = {},
): Setup {
  const broadcasts: DaemonUpdateStatus[] = [];
  const fetchLatest = vi.fn(async () => "9.9.9");
  const npmOnPath = vi.fn(async () => true);
  const pipeline = vi.fn(async () => undefined);
  const service = new UpdateService({
    currentVersion: "0.0.10",
    detectInstallKind: async () => "binary",
    fetchLatest,
    binary: {
      lookup: async () => ({ kind: "ok", version: "0.0.11", hasAsset: true }),
      blocker: async () => null,
      ...probes,
    },
    npmOnPath,
    globalFolder: async () => null,
    canWriteGlobalFolder: async () => false,
    platform: "linux",
    autoCheck: false,
    takeLastResult: async () => undefined,
    persistAutoCheck: async (enabled) => enabled,
    broadcast: (status) => broadcasts.push(status),
    now: () => 1_000,
    pipeline,
    ...overrides,
  });
  return { service, broadcasts, fetchLatest, npmOnPath, pipeline };
}

describe("UpdateService check, binary", () => {
  it("is available for a newer manifest version on a managed, writable binary", async () => {
    const { service, fetchLatest, npmOnPath } = setup();
    const status = await service.check("manual");
    expect(status).toMatchObject({
      installKind: "binary",
      state: { kind: "available", version: "0.0.11" },
      checkedAt: 1_000,
    });
    expect(status.checkError).toBeUndefined();
    // npm is never asked.
    expect(fetchLatest).not.toHaveBeenCalled();
    expect(npmOnPath).not.toHaveBeenCalled();
  });

  it.each(["0.0.10", "0.0.9"])("stays idle when the manifest names %s", async (version) => {
    const { service } = setup({ lookup: async () => ({ kind: "ok", version, hasAsset: true }) });
    expect((await service.check("manual")).state).toEqual({ kind: "idle" });
  });

  it("is cannot_update(unmanaged_binary) with the release page outside bin/versions", async () => {
    const { service } = setup({ blocker: async () => "unmanaged_binary" });
    expect((await service.check("manual")).state).toEqual({
      kind: "cannot_update",
      reason: "unmanaged_binary",
      version: "0.0.11",
      command: RELEASES_PAGE,
    });
  });

  it("is cannot_update(not_writable) with the release page when bin is read-only", async () => {
    const { service } = setup({ blocker: async () => "not_writable" });
    expect((await service.check("manual")).state).toEqual({
      kind: "cannot_update",
      reason: "not_writable",
      version: "0.0.11",
      command: RELEASES_PAGE,
    });
  });

  it("is cannot_update(unsupported_platform) when the manifest has no asset for this system", async () => {
    const { service } = setup({
      lookup: async () => ({ kind: "ok", version: "0.0.11", hasAsset: false }),
    });
    expect((await service.check("manual")).state).toEqual({
      kind: "cannot_update",
      reason: "unsupported_platform",
      version: "0.0.11",
      command: RELEASES_PAGE,
    });
  });

  it("checks the managed rule before the asset", async () => {
    const { service } = setup({
      lookup: async () => ({ kind: "ok", version: "0.0.11", hasAsset: false }),
      blocker: async () => "unmanaged_binary",
    });
    expect((await service.check("manual")).state).toMatchObject({ reason: "unmanaged_binary" });
  });

  it("is cannot_update(unsupported_platform) on Windows", async () => {
    const { service } = setup({}, { platform: "win32" });
    expect((await service.check("manual")).state).toMatchObject({
      reason: "unsupported_platform",
      command: RELEASES_PAGE,
    });
  });

  it.each<[BinaryManifestLookup, string]>([
    [{ kind: "offline" }, "offline"],
    [{ kind: "bad_answer" }, "bad_answer"],
  ])("a manual check reports %j as checkError and keeps the state", async (lookup, error) => {
    const { service } = setup({ lookup: async () => lookup });
    const before = service.status().state;
    const status = await service.check("manual");
    expect(status.checkError).toBe(error);
    expect(status.state).toEqual(before);
  });

  it("an automatic check that fails changes nothing", async () => {
    const { service, broadcasts } = setup({ lookup: async () => ({ kind: "bad_answer" }) });
    await service.start();
    const status = await service.check("automatic");
    expect(status.checkError).toBeUndefined();
    expect(status.checkedAt).toBeUndefined();
    expect(broadcasts.at(-1)?.checkError).toBeUndefined();
  });

  it("without probes a binary install cannot check (offline)", async () => {
    const { service } = setup({}, { binary: undefined });
    expect((await service.check("manual")).checkError).toBe("offline");
  });

  it("keeps the skipped version for automatic checks and offers it to a manual one", async () => {
    let skipped: string | undefined = "0.0.11";
    const { service } = setup(
      {},
      {
        skipStore: {
          read: async () => skipped,
          write: async (v) => {
            skipped = v;
          },
          clear: async () => {
            skipped = undefined;
          },
        },
      },
    );
    await service.start();
    expect((await service.check("automatic")).state).toEqual({ kind: "idle" });
    expect((await service.check("manual")).state).toEqual({ kind: "available", version: "0.0.11" });
  });

  it("applies through the pipeline with the manifest version as target", async () => {
    const { service, pipeline } = setup();
    await service.check("manual");
    expect(service.apply()).toEqual({ ok: true });
    await service.whenApplySettled();
    expect(pipeline).toHaveBeenCalledWith(
      expect.objectContaining({ target: "0.0.11", previous: "0.0.10" }),
    );
  });

  it("refuses an apply while cannot_update", async () => {
    const { service } = setup({ blocker: async () => "unmanaged_binary" });
    await service.check("manual");
    expect(service.apply()).toEqual({ ok: false, error: "cannot_update" });
  });
});
