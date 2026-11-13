import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import type { MockAgentSession } from "../agent/providers/mock/mock-provider.js";
import { LogTap } from "../logging/log-tap.js";
import { createLogger, silentLogger, type LogLevel } from "../logging/logger.js";
import { registerDaemonLogsHandlers } from "../observability/daemon-logs-rpc.js";
import { DaemonLogsService } from "../observability/daemon-logs-service.js";
import {
  authenticatedRpc,
  startAuthGatedServer,
  unauthenticatedUpgradeStatus,
} from "../test-support/auth-gated-rpc.js";
import {
  connectTestClient,
  listeningPort,
  messageOf,
  type TestClient,
  type WireFrame,
} from "../test-support/daemon-test-client.js";
import { startDevDaemon, type DevBootstrapHandle } from "./dev-bootstrap.js";

/**
 * Daemon log streaming over a real socket (sprint-085/task-004; swe/features/daemon-log-streaming.md).
 * Boots the real dev daemon with a tapped injected logger (the bootstrap shares the tap with the
 * service through `logTap`). The only real-time waits are the service's 100 ms flush.
 */

let handle: DevBootstrapHandle | undefined;
const clients: TestClient[] = [];
const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const c of clients.splice(0)) await c.close();
  await handle?.close();
  handle = undefined;
  for (const fn of cleanups.splice(0).toReversed()) await fn();
});

async function boot(
  level: LogLevel = "info",
): Promise<{ client: TestClient; dev: DevBootstrapHandle }> {
  const tap = new LogTap();
  const logger = createLogger({ level, tap, stdoutStream: new PassThrough(), pretty: false });
  const dev = startDevDaemon({ host: "127.0.0.1", port: 0, logger, logTap: tap });
  handle = dev;
  const client = await connectTestClient(await listeningPort(dev.httpServer));
  clients.push(client);
  return { client, dev };
}

const isLogPush = (f: WireFrame): boolean => messageOf(f).type === "daemon_log_lines";

/** Every `msg` pushed so far, flattened. */
const pushedMsgs = (c: TestClient): string[] =>
  c.frames
    .filter(isLogPush)
    .flatMap((f) => (messageOf(f).lines as { msg: string }[]).map((l) => l.msg));

const settle = (ms = 250): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("daemon log streaming over the dev daemon (sprint-085/task-004)", () => {
  it("delivers a live line within the flush window and honours minLevel", async () => {
    const { client, dev } = await boot();
    const sub = await client.rpc("daemon_logs_subscribe_request", { minLevel: "warn" });
    expect(sub.payload).toMatchObject({ ok: true, minLevel: "warn", effectiveLevel: "warn" });

    dev.logger.info("live-info-line");
    dev.logger.warn("live-warn-line");
    await client.waitFor(() => pushedMsgs(client).includes("live-warn-line"), 1000);
    expect(pushedMsgs(client)).not.toContain("live-info-line");
  });

  it("returns the newest `tail` lines as a backlog", async () => {
    const { client, dev } = await boot();
    for (let i = 0; i < 5; i++) dev.logger.info(`backlog-${i}`);
    const sub = await client.rpc("daemon_logs_subscribe_request", { minLevel: "info", tail: 3 });
    const lines = (sub.payload as { lines: { msg: string }[] }).lines;
    expect(lines.map((l) => l.msg)).toEqual(["backlog-2", "backlog-3", "backlog-4"]);
  });

  it("rejects an invalid level as a domain failure", async () => {
    const { client } = await boot();
    const sub = await client.rpc("daemon_logs_subscribe_request", { minLevel: "loud" });
    expect(sub.type).toBe("daemon_logs_subscribe_response");
    expect(sub.payload).toEqual({ ok: false, error: "invalid_level" });
  });

  it("stops pushing after unsubscribe and after the socket closes", async () => {
    const { client, dev } = await boot();
    const other = await connectTestClient(await listeningPort(dev.httpServer));
    clients.push(other);
    await client.rpc("daemon_logs_subscribe_request", { minLevel: "info" });
    await other.rpc("daemon_logs_subscribe_request", { minLevel: "info" });

    dev.logger.info("before-unsubscribe");
    await client.waitFor(() => pushedMsgs(client).includes("before-unsubscribe"), 1000);
    await other.waitFor(() => pushedMsgs(other).includes("before-unsubscribe"), 1000);

    const unsub = await client.rpc("daemon_logs_unsubscribe_request");
    expect(unsub.payload).toEqual({ ok: true });
    dev.logger.info("after-unsubscribe");
    await other.waitFor(() => pushedMsgs(other).includes("after-unsubscribe"), 1000);
    await settle();
    expect(pushedMsgs(client)).not.toContain("after-unsubscribe");

    const pushesBeforeClose = other.frames.filter(isLogPush).length;
    await other.close();
    dev.logger.info("after-close");
    await settle();
    expect(other.frames.filter(isLogPush)).toHaveLength(pushesBeforeClose);
  });

  it("a daemon with an injected silent logger answers ok:true with no lines", async () => {
    handle = startDevDaemon({ host: "127.0.0.1", port: 0, logger: silentLogger() });
    const client = await connectTestClient(await listeningPort(handle.httpServer));
    clients.push(client);
    const sub = await client.rpc("daemon_logs_subscribe_request", { minLevel: "trace", tail: 50 });
    expect(sub.payload).toMatchObject({
      ok: true,
      effectiveLevel: "silent",
      lines: [],
      dropped: 0,
    });
    await settle();
    expect(client.frames.filter(isLogPush)).toHaveLength(0);
  });
});

describe("daemon log stream redaction (sprint-085/task-004)", () => {
  it("never streams the sentinel secrets of a full agent + extension-UI scenario", async () => {
    const PROMPT = "SENTINEL-PROMPT-7f3a";
    const UI_PAYLOAD = "SENTINEL-UI-PAYLOAD-91bc";
    const UI_ANSWER = "SENTINEL-UI-ANSWER-d204";
    const { client, dev } = await boot("trace");
    await client.rpc("daemon_logs_subscribe_request", { minLevel: "trace" });

    const created = await client.rpc("create_agent_request", {
      config: { provider: "mock", cwd: "/tmp" },
      initialPrompt: PROMPT,
    });
    const agentId = (created.payload as { agentId: string }).agentId;
    await client.waitFor((f) => {
      const m = messageOf(f);
      return m.type === "agent_stream" && (m.event as { kind?: string }).kind === "turn_completed";
    });

    const session = dev.manager.get(agentId)?.session as MockAgentSession;
    session.emitUiRequest({
      method: "input",
      payload: { title: UI_PAYLOAD, placeholder: UI_PAYLOAD },
    });
    const ask = await client.waitFor((f) => messageOf(f).type === "agent_ui_request");
    const answered = await client.rpc("agent_ui_respond_request", {
      uiRequestId: messageOf(ask).requestId,
      response: { value: UI_ANSWER },
    });
    expect(answered.payload).toEqual({ ok: true });
    await client.waitFor((f) => messageOf(f).type === "agent_ui_resolved");
    await settle();

    const backlog = await client.rpc("daemon_logs_subscribe_request", {
      minLevel: "trace",
      tail: 1000,
    });
    const everything = JSON.stringify([
      client.frames.filter(isLogPush).map((f) => messageOf(f).lines),
      (backlog.payload as { lines: unknown }).lines,
    ]);
    expect(everything.length).toBeGreaterThan(100);
    for (const sentinel of [PROMPT, UI_PAYLOAD, UI_ANSWER]) {
      expect(everything).not.toContain(sentinel);
    }
  });
});

describe("daemon log streaming is authenticated only (sprint-085/task-004)", () => {
  it("rejects an unauthenticated socket and serves an authenticated one", async () => {
    const tap = new LogTap();
    createLogger({ level: "info", tap, stdoutStream: new PassThrough(), pretty: false });
    let service: DaemonLogsService | undefined;
    const server = await startAuthGatedServer((registry) => {
      service = new DaemonLogsService({ tap, send: (s, e) => s.send(e) });
      registerDaemonLogsHandlers(registry, { service });
    });
    cleanups.push(async () => {
      service?.dispose();
      await server.close();
    });

    expect(await unauthenticatedUpgradeStatus(server.port)).toBe(401);
    const res = await authenticatedRpc(server.port, "daemon_logs_subscribe_request", {
      minLevel: "info",
    });
    expect(res.type).toBe("daemon_logs_subscribe_response");
    expect(res.payload).toMatchObject({ ok: true });
  });
});
