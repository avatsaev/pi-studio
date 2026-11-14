import { PassThrough } from "node:stream";

import type { MockAgentSession } from "../agent/providers/mock/mock-provider.js";
import { MOCK_REBIND_ENTRY_ID } from "../agent/providers/mock/mock-provider.js";
import type { DevBootstrapHandle } from "../daemon/dev-bootstrap.js";
import { LogTap } from "../logging/log-tap.js";
import { createLogger, type Logger } from "../logging/logger.js";
import { listeningPort, messageOf, type TestClient, type WireFrame } from "./daemon-test-client.js";

/**
 * The scripted dev-daemon scenario behind the external-client wire fixtures
 * (swe/architecture/external-client-fixtures.md). Shared by the Layer B contract test
 * (`daemon/external-fixtures-e2e.test.ts`) and the recorder script
 * (`scripts/record-external-fixtures.ts`), so what is recorded is exactly what is verified.
 *
 * Drives every daemon-output type through its real path and returns the FIRST captured frame per
 * fixture variant key (the manifest `file` stem, e.g. `agent_stream.tool_call.partial`). Matching
 * is by predicate over the frame log, never by index.
 */

/** The dev daemon must be started with at least this `mockTurnDelayMs` so a mock turn is still
 *  running when `interrupt_agent` arrives (`turn_canceled`). */
export const SCENARIO_MOCK_TURN_DELAY_MS = 150;

/**
 * Dev-daemon options the scenario needs: the turn delay plus a tapped silent-output logger, so the
 * `daemon_logs_*` stage 2 steps have a stream (`logTap` is shared with the bootstrap's service).
 */
export function scenarioDaemonOptions(): {
  logger: Logger;
  logTap: LogTap;
  mockTurnDelayMs: number;
} {
  const logTap = new LogTap();
  const logger = createLogger({
    level: "info",
    tap: logTap,
    stdoutStream: new PassThrough(),
    pretty: false,
  });
  return { logger, logTap, mockTurnDelayMs: SCENARIO_MOCK_TURN_DELAY_MS };
}

/** Fixture-variant key for `frame`, or `undefined` when the frame is not a fixtured variant. */
export function variantKey(frame: WireFrame): string | undefined {
  const m = messageOf(frame);
  const type = String(m.type);
  switch (type) {
    case "status":
      return "status.server_info";
    case "agent_stream": {
      const event = m.event as { kind: string; partial?: boolean };
      return `agent_stream.${event.kind}${event.kind === "tool_call" && event.partial ? ".partial" : ""}`;
    }
    case "agent_update":
      if ("model" in m) return "agent_update.model";
      return "status" in m ? "agent_update" : undefined;
    case "agent_ui_request":
      return `agent_ui_request.${String(m.method)}${m.removed === true ? ".removed" : ""}`;
    case "agent_ui_resolved":
      return `agent_ui_resolved.${String(m.reason)}`;
    case "agent_ui_respond_response": {
      const payload = m.payload as { ok: boolean; error?: string };
      return payload.ok ? "agent_ui_respond_response.ok" : "agent_ui_respond_response.not_found";
    }
    case "pong":
    case "daemon_status_response":
    case "daemon_status_subscribe_response":
    case "daemon_status_unsubscribe_response":
    case "daemon_status_update":
    case "daemon_logs_subscribe_response":
    case "daemon_logs_unsubscribe_response":
    case "daemon_log_lines":
    case "list_agents_response":
    case "agent_archived":
    case "agent_deleted":
    case "agent_timeline_reset":
    case "fetch_agent_timeline_response":
    case "agent_session_stats_response":
    case "interrupt_response":
    case "agent_ui_list_response":
    case "rpc_error":
      return type;
    default:
      return undefined;
  }
}

const isStream =
  (kind: string, extra: (event: Record<string, unknown>) => boolean = () => true) =>
  (frame: WireFrame): boolean => {
    const m = messageOf(frame);
    if (m.type !== "agent_stream") return false;
    const event = m.event as Record<string, unknown>;
    return event.kind === kind && extra(event);
  };

const isType =
  (type: string, extra: (m: WireFrame) => boolean = () => true) =>
  (frame: WireFrame): boolean => {
    const m = messageOf(frame);
    return m.type === type && extra(m);
  };

export async function runExternalFixtureScenario(
  dev: DevBootstrapHandle,
  client: TestClient,
): Promise<Map<string, WireFrame>> {
  const { rpc, waitFor } = client;
  const createAgent = async (initialPrompt?: string): Promise<string> => {
    const created = await rpc("create_agent_request", {
      config: { provider: "mock", cwd: "/tmp" },
      ...(initialPrompt !== undefined ? { initialPrompt } : {}),
    });
    return (created.payload as { agentId: string }).agentId;
  };
  // `MockAgentSession.emitUiRequest` is deliberately not part of the provider-neutral
  // `AgentSession` contract; the dev handle's `manager` is the sanctioned test seam to reach it.
  const mockSession = (agentId: string): MockAgentSession => {
    const session = dev.manager.get(agentId)?.session;
    if (!session) throw new Error(`no live session for ${agentId}`);
    return session as MockAgentSession;
  };

  // Liveness.
  client.send({ type: "ping", requestId: "scenario-ping", clientSentAt: Date.now() });
  await waitFor(isType("pong"));

  // Normal turn: user_message, turn_started, assistant_message, turn_completed, agent_update.
  const agentId = await createAgent("hello");
  await waitFor(isStream("turn_completed"));
  await waitFor(isType("agent_update", (m) => m.status === "idle"));

  // Tool call with partials, then the `#stream` kinds the normal turn never produces.
  await rpc("send_agent_prompt", { agentId, prompt: "#tool shell" });
  for (const recipe of ["reasoning", "fail", "error"]) {
    await rpc("send_agent_prompt", { agentId, prompt: `#stream ${recipe}` });
  }

  // Cancellation: `send_agent_prompt` blocks until the turn ends, so send raw and interrupt once
  // the daemon has recorded the prompt (the mock turn is still pending its delay).
  client.send({
    type: "session",
    message: {
      type: "send_agent_prompt",
      requestId: "scenario-slow",
      agentId,
      prompt: "slow turn to cancel",
    },
  });
  await waitFor(isStream("user_message", (e) => e.text === "slow turn to cancel"));
  await rpc("interrupt_agent", { agentId });
  await waitFor(isStream("turn_canceled"));
  await waitFor(isType("agent_prompt_response", (m) => m.requestId === "scenario-slow"));

  // Compaction (mock holds `started` for ~1.5 s).
  await rpc("agent_compact_request", { agentId });

  // Reads.
  await rpc("list_agents_request");
  await rpc("fetch_agent_timeline_request", { agentId, direction: "after" });
  await rpc("agent_session_stats_request", { agentId });

  // Extension UI: dialogs, a hand-off pair, a non-dialog, a retained surface, list, removal.
  const session = mockSession(agentId);
  session.emitUiRequest({ method: "select", payload: { title: "Pick one", options: ["a", "b"] } });
  session.emitUiRequest({
    method: "confirm",
    payload: { title: "Proceed?", message: "Apply the change?" },
  });
  session.emitUiRequest({ method: "input", payload: { title: "Name", placeholder: "name" } });
  session.emitUiRequest({ method: "editor", payload: { title: "Edit", prefill: "text" } });
  session.emitUiRequest({ method: "notify", expectsResponse: false, payload: { message: "Done" } });
  session.emitUiRequest({
    method: "setStatus",
    expectsResponse: false,
    surfaceKey: "status:build",
    payload: { statusText: "building" },
  });
  await waitFor(isType("agent_ui_request", (m) => m.method === "setStatus"));
  await rpc("agent_ui_list_request", { agentId });
  session.emitUiRequest({
    method: "setStatus",
    expectsResponse: false,
    surfaceKey: "status:build",
    removed: true,
    payload: {},
  });

  // Answered (confirm → {confirmed}, select → {value}); unknown id → not_found; timeout.
  const uiRequestId = async (method: string): Promise<string> =>
    String(
      messageOf(await waitFor(isType("agent_ui_request", (m) => m.method === method))).requestId,
    );
  await rpc("agent_ui_respond_request", {
    uiRequestId: await uiRequestId("confirm"),
    response: { confirmed: true },
  });
  await rpc("agent_ui_respond_request", {
    uiRequestId: await uiRequestId("select"),
    response: { value: "a" },
  });
  await rpc("agent_ui_respond_request", {
    uiRequestId: "unknown-request-id",
    response: { confirmed: true },
  });
  session.emitUiRequest({ method: "confirm", timeoutMs: 50, payload: { title: "Hurry" } });
  await waitFor(isType("agent_ui_resolved", (m) => m.reason === "timeout"));

  // Aborted + archived + deleted: a second agent with a dialog pending, then archive / delete.
  const doomedId = await createAgent("bye");
  await waitFor(isType("agent_update", (m) => m.agentId === doomedId && m.status === "idle"));
  mockSession(doomedId).emitUiRequest({ method: "input", payload: { title: "Never answered" } });
  await waitFor(isType("agent_ui_request", (m) => m.agentId === doomedId));
  await rpc("archive_agent", { agentId: doomedId });
  await waitFor(isType("agent_ui_resolved", (m) => m.reason === "aborted"));
  await rpc("delete_agent", { agentId: doomedId });

  // A session-less draft: the model switch is broadcast as `agent_update {model, modelProvider}`.
  const draftId = await createAgent();
  await rpc("agent_set_model_request", { agentId: draftId, provider: "mock", modelId: "mock-2" });

  // Timeline reset: the mock rebinds its persistence handle, so `handleFork` runs for real.
  await rpc("agent_fork_request", { agentId, entryId: MOCK_REBIND_ENTRY_ID });
  await waitFor(isType("agent_timeline_reset"));

  // Unknown message type with a requestId → rpc_error.
  await rpc("scenario_no_such_type");

  // Stage 2 (daemonObservability): status one-shot, subscribe → push (real 5 s interval) →
  // unsubscribe; then a log subscription with a one-line backlog, a live push and unsubscribe.
  await rpc("daemon_status_request");
  await rpc("daemon_status_subscribe_request");
  await waitFor(isType("daemon_status_update"), 10_000);
  await rpc("daemon_status_unsubscribe_request");
  dev.logger.info("external fixture log line");
  await rpc("daemon_logs_subscribe_request", { minLevel: "info", tail: 1 });
  dev.logger.info("external fixture live line");
  await waitFor(isType("daemon_log_lines"), 2000);
  await rpc("daemon_logs_unsubscribe_request");

  const captured = new Map<string, WireFrame>();
  for (const frame of client.frames) {
    const key = variantKey(frame);
    if (key !== undefined && !captured.has(key)) captured.set(key, frame);
  }

  // HTTP health (unauthenticated).
  const port = await listeningPort(dev.httpServer);
  const response = await fetch(`http://127.0.0.1:${port}/api/health`);
  captured.set("health", {
    status: response.status,
    contentType: response.headers.get("content-type"),
    body: await response.json(),
  });
  return captured;
}
