import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { loadConfig, persistUpdateAutoCheck } from "../config/daemon-config.js";
import { silentLogger } from "../logging/logger.js";
import { HandlerRegistry, routeTextFrame } from "../ws/router.js";
import type { Session } from "../ws/session.js";
import { registerDaemonUpdateHandlers } from "./update-rpc.js";
import { UpdateService, type UpdatePipeline } from "./update-service.js";

/** Drives the real registry + router with a fake session and a service on injected seams. */
function setup(
  pipeline: UpdatePipeline = async () => undefined,
  persistAutoCheck: (enabled: boolean) => Promise<boolean> = async (enabled) => enabled,
) {
  const sent: unknown[] = [];
  const session = {
    clientId: "c",
    send: (frame: unknown) => sent.push(frame),
  } as unknown as Session;
  const persist = vi.fn(persistAutoCheck);
  const service = new UpdateService({
    currentVersion: "0.0.10",
    detectInstallKind: async () => "npm-global",
    fetchLatest: async () => "0.0.11",
    npmOnPath: async () => true,
    globalFolder: async () => "/g",
    canWriteGlobalFolder: async () => true,
    platform: "linux",
    autoCheck: false,
    takeLastResult: async () => undefined,
    persistAutoCheck: persist,
    broadcast: () => {},
    pipeline,
    timer: { set: () => ({}), clear: () => {} },
  });
  const registry = new HandlerRegistry(silentLogger());
  registerDaemonUpdateHandlers(registry, { service });
  const call = async (type: string, body: Record<string, unknown> = {}): Promise<unknown> => {
    sent.length = 0;
    await routeTextFrame(
      session,
      JSON.stringify({ type: "session", message: { type, requestId: "r1", ...body } }),
      registry,
    );
    return (sent[0] as { message: unknown }).message;
  };
  return { call, service, persist };
}

describe("registerDaemonUpdateHandlers", () => {
  it("answers status with the stamped requestId", async () => {
    const { call } = setup();
    expect(await call("daemon_update_status_request")).toMatchObject({
      type: "daemon_update_status_response",
      requestId: "r1",
      status: { currentVersion: "0.0.10", state: { kind: "idle" } },
    });
  });

  it("check answers with the finished status, even offline (never rpc_error)", async () => {
    const { call } = setup();
    expect(await call("daemon_update_check_request")).toMatchObject({
      type: "daemon_update_check_response",
      status: { state: { kind: "available", version: "0.0.11" } },
    });
  });

  it("apply refuses not_available, then answers ok and refuses in_progress", async () => {
    const { call, service } = setup(() => Promise.withResolvers<void>().promise);
    expect(await call("daemon_update_apply_request")).toMatchObject({
      type: "daemon_update_apply_response",
      ok: false,
      error: "not_available",
    });
    await call("daemon_update_check_request");
    expect(await call("daemon_update_apply_request")).toEqual({
      type: "daemon_update_apply_response",
      requestId: "r1",
      ok: true,
    });
    expect(service.status().state.kind).toBe("installing");
    expect(await call("daemon_update_apply_request")).toMatchObject({
      ok: false,
      error: "in_progress",
    });
  });

  it("set_auto_check persists and answers the status", async () => {
    const { call, persist } = setup();
    expect(await call("daemon_update_set_auto_check_request", { enabled: true })).toMatchObject({
      type: "daemon_update_set_auto_check_response",
      status: { autoCheck: true },
    });
    expect(persist).toHaveBeenCalledWith(true);
  });

  it("set_auto_check rejects a non-boolean as an rpc_error and writes nothing", async () => {
    const { call, persist } = setup();
    expect(await call("daemon_update_set_auto_check_request", { enabled: "yes" })).toMatchObject({
      type: "rpc_error",
    });
    expect(persist).not.toHaveBeenCalled();
  });

  it("set_auto_check on a damaged config.json answers an rpc_error naming the file and leaves it alone", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-studio-update-rpc-"));
    const configPath = join(dir, "config.json");
    const damaged = '{ "daemon": { "auth": { "password": "$2a$10$hash"';
    await writeFile(configPath, damaged, "utf8");
    const { call, service } = setup(undefined, async (enabled) => {
      await persistUpdateAutoCheck(configPath, enabled);
      return loadConfig(configPath, {}).daemon.update.autoCheck;
    });

    expect(await call("daemon_update_set_auto_check_request", { enabled: true })).toMatchObject({
      type: "rpc_error",
      code: "handler_error",
      message: expect.stringContaining(configPath),
    });

    expect(await readFile(configPath, "utf8")).toBe(damaged);
    expect(service.status().autoCheck).toBe(false);
  });
});
