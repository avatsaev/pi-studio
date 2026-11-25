import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  daemonUpdateStatusPushSchema,
  daemonUpdateStatusSchema,
  type DaemonUpdateStatus,
} from "@av-pi-studio/protocol";

import { silentLogger } from "../logging/logger.js";
import {
  connectTestClient,
  listeningPort,
  messageOf,
  type TestClient,
  type WireFrame,
} from "../test-support/daemon-test-client.js";
import { updateCheckRig } from "../test-support/update-check-rig.js";
import { UPDATE_CONNECT_CHECK_MIN_AGE_MS } from "../update/update-service.js";
import { startDaemon, type DaemonHandle, type DaemonOptions } from "./bootstrap.js";

/**
 * The daemon-update family over a real socket on the production bootstrap (temp home, port 0).
 * `PI_STUDIO_UPDATE_AUTOCHECK=false` comes from the root vitest config, so no test asks the real
 * npm registry; the check paths themselves are covered with injected seams in
 * `update/update-service.test.ts`.
 */

let handle: DaemonHandle | undefined;
const clients: TestClient[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) await c.close();
  await handle?.close();
  handle = undefined;
});

async function boot(
  files: {
    config?: Record<string, unknown>;
    result?: unknown;
    options?: Partial<DaemonOptions>;
  } = {},
): Promise<{ client: TestClient; home: string }> {
  const home = mkdtempSync(join(tmpdir(), "pi-studio-update-e2e-"));
  const piHome = mkdtempSync(join(tmpdir(), "pi-studio-update-e2e-pihome-"));
  const config = files.config ?? {};
  const daemon = (config.daemon as Record<string, unknown> | undefined) ?? {};
  writeFileSync(
    join(home, "config.json"),
    JSON.stringify({ ...config, daemon: { piHome, extensions: { autoSync: false }, ...daemon } }),
    "utf8",
  );
  if (files.result !== undefined) {
    writeFileSync(join(home, "update-result.json"), JSON.stringify(files.result), "utf8");
  }
  handle = startDaemon({
    host: "127.0.0.1",
    port: 0,
    home,
    logger: silentLogger(),
    ...files.options,
  });
  const client = await connectTestClient(await listeningPort(handle.httpServer));
  clients.push(client);
  return { client, home };
}

/** Another client on the daemon `boot` started. */
async function connectAnother(): Promise<TestClient> {
  if (!handle) throw new Error("no daemon is running");
  const client = await connectTestClient(await listeningPort(handle.httpServer));
  clients.push(client);
  return client;
}

describe("daemon update family on the production daemon", () => {
  it("pushes the status right after server_info", async () => {
    const { client } = await boot();
    const push = await client.waitFor((f) => messageOf(f).type === "daemon_update_status");
    expect(client.frames.indexOf(push)).toBeGreaterThan(client.frames.indexOf(client.status));
    const parsed = daemonUpdateStatusPushSchema.parse(messageOf(push));
    expect(parsed.status.autoCheck).toBe(false);
    expect(parsed.status.state).toEqual({ kind: "idle" });
  });

  it("answers status and refuses an apply when nothing newer is known", async () => {
    const { client } = await boot();
    const status = await client.rpc("daemon_update_status_request");
    expect(status.type).toBe("daemon_update_status_response");
    expect(daemonUpdateStatusSchema.parse(status.status).currentVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(await client.rpc("daemon_update_apply_request")).toMatchObject({
      type: "daemon_update_apply_response",
      ok: false,
      error: "not_available",
    });
  });

  it("reads update-result.json once, removes it, and carries it as lastResult", async () => {
    const result = { from: "0.0.1", to: "0.0.2", outcome: "updated", at: 42 };
    const { client, home } = await boot({ result });
    const status = await client.rpc("daemon_update_status_request");
    expect(daemonUpdateStatusSchema.parse(status.status).lastResult).toEqual(result);
    expect(() => readFileSync(join(home, "update-result.json"), "utf8")).toThrow(/ENOENT/);
  });

  it("set_auto_check writes config.json keeping unknown keys; env still wins in memory", async () => {
    const { client, home } = await boot({
      config: { unknown_top: "kept", daemon: { unknown_daemon: 1 } },
    });
    const response = await client.rpc("daemon_update_set_auto_check_request", { enabled: true });
    expect(response.type).toBe("daemon_update_set_auto_check_response");
    // The test environment pins PI_STUDIO_UPDATE_AUTOCHECK=false: the effective value stays false.
    expect(daemonUpdateStatusSchema.parse(response.status).autoCheck).toBe(false);
    const raw = JSON.parse(readFileSync(join(home, "config.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(raw.unknown_top).toBe("kept");
    const daemon = raw.daemon as Record<string, unknown>;
    expect(daemon.unknown_daemon).toBe(1);
    expect(daemon.update).toEqual({ autoCheck: true });
  });

  it("advertises daemonUpdate in server_info.features on the direct handshake", async () => {
    const { client } = await boot();
    const payload = client.status.payload as { features?: Record<string, boolean> };
    expect(payload.features?.daemonUpdate).toBe(true);
  });
});

/** The status a `daemon_update_status` push carries; `undefined` for any other frame. */
function pushedStatus(frame: WireFrame): DaemonUpdateStatus | undefined {
  const message = messageOf(frame);
  return message.type === "daemon_update_status"
    ? daemonUpdateStatusPushSchema.parse(message).status
    : undefined;
}

/** The `state.kind` a `daemon_update_status` broadcast carries; `undefined` for any other frame. */
function broadcastKind(frame: WireFrame): string | undefined {
  return pushedStatus(frame)?.state.kind;
}

/** Fakes for everything a real apply would touch: npm, the extensions and the helper. */
function applySeams(
  events: string[],
  pause: () => Promise<void>,
  probeGate: Promise<void> = Promise.resolve(),
): NonNullable<DaemonOptions["updateTestSeams"]> {
  return {
    service: {
      // The probe stays pending until the test has connected, so the connect-time status and the
      // probe's own broadcast both reach the client (the old race, now every time).
      detectInstallKind: async () => {
        await probeGate;
        return "npm-global";
      },
      fetchLatest: async () => "99.0.0",
      npmOnPath: async () => true,
      globalFolder: async () => "/fake/npm/root",
      canWriteGlobalFolder: async () => true,
      platform: "linux",
    },
    pipeline: {
      install: async (version) => void events.push(`install ${version}`),
      updateExtensions: async () => void events.push("extensions"),
      spawnHelper: (target, previous) => void events.push(`helper ${target} ${previous}`),
      pause,
    },
  };
}

describe("the apply handoff on the production daemon (fakes only)", () => {
  it("apply: states in order, the real shutdown ran once, then exit is called", async () => {
    const events: string[] = [];
    const exited = Promise.withResolvers<number>();
    const watcher: { client?: TestClient } = {};
    const probeGate = Promise.withResolvers<void>();
    const { client } = await boot({
      options: {
        // Hands over once the client has seen `restarting`: the sockets close right after.
        updateTestSeams: applySeams(
          events,
          async () => {
            await watcher.client?.waitFor((f) => broadcastKind(f) === "restarting");
          },
          probeGate.promise,
        ),
        onUpdateRestart: (code) => {
          const pidFile = join(handle?.home ?? "", "pi-studio.pid");
          events.push(
            `exit ${code} listening=${handle?.httpServer.listening} pid=${existsSync(pidFile)}`,
          );
          exited.resolve(code);
        },
      },
    });
    watcher.client = client;
    probeGate.resolve();
    // The status answer waits for the start-up probe, whose own broadcast lands before the reply:
    // frames collected from here on are the apply sequence only.
    await client.rpc("daemon_update_status_request");
    const probed = client.frames.length;
    const checked = await client.rpc("daemon_update_check_request");
    expect(daemonUpdateStatusSchema.parse(checked.status).state).toEqual({
      kind: "available",
      version: "99.0.0",
    });
    expect(await client.rpc("daemon_update_apply_request")).toMatchObject({
      type: "daemon_update_apply_response",
      ok: true,
    });
    expect(await exited.promise).toBe(0);

    expect(events).toEqual([
      "install 99.0.0",
      "extensions",
      expect.stringMatching(/^helper 99\.0\.0 \d+\.\d+\.\d+/),
      // Shutdown had finished when exit was called: not listening, pid file removed.
      "exit 0 listening=false pid=false",
    ]);
    expect(client.frames.slice(probed).flatMap((frame) => broadcastKind(frame) ?? [])).toEqual([
      "checking",
      "available",
      "installing",
      "updating_extensions",
      "restarting",
    ]);
  });

  it("a daemon without an exit owner fails the apply before installing anything", async () => {
    const events: string[] = [];
    const { client } = await boot({
      options: { updateTestSeams: applySeams(events, async () => undefined) },
    });
    await client.rpc("daemon_update_check_request");
    await client.rpc("daemon_update_apply_request");
    await client.waitFor((f) => broadcastKind(f) === "failed");
    expect(events).toEqual([]);
  });
});

describe("a connecting client starts an update check when the last one is old (fakes only)", () => {
  it("answers with the stored status at once, then every client gets what the check found; a quick connect asks nothing", async () => {
    const rig = updateCheckRig();
    const { client: first } = await boot({ options: { updateTestSeams: rig.seams } });
    // The start-up check ends with a status that carries its time. The first connect landed while
    // it ran, or after it: either way it asked nothing of its own.
    await first.waitFor((f) => pushedStatus(f)?.checkedAt === 1_000);
    expect(rig.asked.count).toBe(1);

    rig.clock.now += UPDATE_CONNECT_CHECK_MIN_AGE_MS;
    rig.registry.latest = "99.0.0";
    const second = await connectAnother();
    await second.waitFor((f) => broadcastKind(f) === "available");
    await first.waitFor((f) => broadcastKind(f) === "available");
    expect(rig.asked.count).toBe(2);
    // The stored status first, then the result: the check is silent, no `checking` in between.
    expect(second.frames.flatMap((frame) => broadcastKind(frame) ?? [])).toEqual([
      "idle",
      "available",
    ]);
    expect(first.frames.flatMap((frame) => broadcastKind(frame) ?? [])).not.toContain("checking");

    const third = await connectAnother();
    await third.rpc("daemon_update_status_request");
    expect(rig.asked.count).toBe(2);
  });
});
