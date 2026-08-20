import { DaemonClient } from "../daemon-client.js";
import { PiStudioClient } from "../pistudio-client.js";
import type { Transport } from "../transport.js";

/**
 * Scripted in-memory daemon transport, shared across `pistudio-client.test.ts` (sprint-055+) and
 * `agent-ui-controller.test.ts` (sprint-067/task-003). Speaks just enough of the protocol for the
 * facade/controller tests: completes the handshake, echoes responses correlated by `requestId`,
 * and can push broadcasts or drop the connection on command.
 *
 * `features` is the **live** object read on every `hello` — mutate it in place
 * (`fake.features.extensionUi = true`) before calling `daemon.connect()` again to simulate a
 * reconnect where the daemon-advertised capability set changed.
 */
export interface ScriptedDaemon {
  transport: Transport;
  sent: Array<Record<string, unknown>>;
  features: Record<string, boolean>;
  push: (sessionMessage: Record<string, unknown>) => void;
  /** Simulate the socket dying mid-session (distinct from a clean RPC response). */
  drop: (reason?: string) => void;
}

export function makeScriptedDaemon(opts?: { features?: Record<string, boolean> }): ScriptedDaemon {
  const sent: Array<Record<string, unknown>> = [];
  let agentSeq = 0;
  const features = opts?.features ?? { providersSnapshot: true, providerAuth: true };

  const transport: Transport = {
    onMessage: null,
    onClose: null,
    onError: null,
    isOpen: true,
    connect: () => Promise.resolve(),
    sendBinary: () => {},
    close: () => {},
    sendText: (data) => {
      const frame = JSON.parse(data) as Record<string, unknown>;
      if (frame.type === "hello") {
        queueMicrotask(() =>
          transport.onMessage?.(
            JSON.stringify({
              type: "status",
              payload: {
                status: "server_info",
                serverId: "srv-mock",
                capabilities: {},
                features,
              },
            }),
          ),
        );
        return;
      }
      if (frame.type === "session") {
        const msg = frame.message as Record<string, unknown>;
        sent.push(msg);
        respond(msg);
      }
    },
  };

  function reply(message: Record<string, unknown>): void {
    queueMicrotask(() => transport.onMessage?.(JSON.stringify({ type: "session", message })));
  }

  function respond(msg: Record<string, unknown>): void {
    const requestId = msg.requestId as string;
    // The `provider_auth_*` family is driven manually by each test via `fake.push()` — real
    // flows are ordering-sensitive (buffering-before-response, prompt races), so an automatic
    // reply here would hide exactly the bugs those tests exist to catch.
    if (typeof msg.type === "string" && msg.type.startsWith("provider_auth_")) {
      return;
    }
    switch (msg.type) {
      case "agent_ui_respond_request":
      case "agent_ui_list_request":
        // Driven manually by each test via `fake.push()` — the ok/error mix (and, for
        // agent_ui_list_request, the exact moment the reply lands relative to other pushed
        // events) is exactly what the acceptance criteria differentiate on; an automatic reply
        // would hide it.
        return;
      case "create_agent_request": {
        const agentId = `agent-${++agentSeq}`;
        reply({ type: "create_agent_response", requestId, payload: { agentId } });
        // Simulate a streamed turn for the new agent.
        if (msg.initialPrompt) {
          reply({
            type: "agent_stream",
            agentId,
            event: { kind: "turn_started" },
          });
          reply({
            type: "agent_stream",
            agentId,
            event: { kind: "assistant_message", text: "hello from mock" },
          });
          reply({ type: "agent_stream", agentId, event: { kind: "turn_completed" } });
          reply({ type: "agent_update", agentId, status: "idle" });
        }
        return;
      }
      case "fetch_agent_timeline_request": {
        reply({
          type: "fetch_agent_timeline_response",
          requestId,
          payload: {
            agentId: msg.agentId,
            items: [{ kind: "assistant_message", text: "hello from mock" }],
            startCursor: "c0",
            endCursor: "c1",
            hasOlder: false,
            hasNewer: false,
            seqStart: 1,
            seqEnd: 1,
          },
        });
        return;
      }
      case "update_agent": {
        reply({ type: "update_agent_response", requestId, payload: { ok: true } });
        reply({
          type: "agent_update",
          agentId: msg.agentId,
          title: msg.title,
        });
        return;
      }
      case "agent_session_stats_request": {
        reply({
          type: "agent_session_stats_response",
          requestId,
          payload: { sessionId: "s1", totalMessages: 3 },
        });
        return;
      }
      case "agent_compact_request": {
        reply({
          type: "agent_compact_response",
          requestId,
          payload: { summary: "compacted", tokensBefore: 1000 },
        });
        return;
      }
      case "agent_list_commands_request": {
        reply({
          type: "agent_list_commands_response",
          requestId,
          payload: {
            commands: [
              {
                name: "fix-tests",
                description: "Fix failing tests",
                source: "prompt",
                scope: "project",
                path: "/w/.pi/agent/prompts/fix-tests.md",
              },
              { name: "skill:brave-search", source: "skill", scope: "user" },
            ],
          },
        });
        return;
      }
      case "list_provider_models": {
        reply({
          type: "list_provider_models_response",
          requestId,
          payload: { models: [{ id: "m1" }, { id: "m2" }] },
        });
        return;
      }
      case "list_provider_modes": {
        reply({
          type: "list_provider_modes_response",
          requestId,
          payload: { modes: [{ id: "plan" }, { id: "default" }] },
        });
        return;
      }
      case "providers.snapshot.refresh.request": {
        reply({
          type: "providers.snapshot.refresh.response",
          requestId,
          payload: { refreshed: true },
        });
        return;
      }
      case "resolve_default_model": {
        reply({
          type: "resolve_default_model_response",
          requestId,
          provider: msg.provider,
          model: "claude-sonnet-5",
          modelProvider: "anthropic",
        });
        return;
      }
      case "extension_packs_list_request": {
        // Flat fields on the message — the real wire schema (packages/protocol/src/messages.ts)
        // has no `payload` wrapper for this pair, unlike several older RPCs above.
        reply({
          type: "extension_packs_list_response",
          requestId,
          autoSync: true,
          selected: ["swe"],
          packs: [
            { id: "core", title: "Core", description: "Always-on core pack", packages: [] },
            { id: "swe", title: "Software Engineering", description: "SWE tools", packages: [] },
          ],
        });
        return;
      }
      case "extension_packs_set_request": {
        const packs = msg.packs as string[] | undefined;
        if (packs?.includes("unknown")) {
          reply({
            type: "extension_packs_set_response",
            requestId,
            autoSync: true,
            selected: ["swe"],
            packs: [],
            ok: false,
            error: "unknown pack: unknown",
          });
          return;
        }
        reply({
          type: "extension_packs_set_response",
          requestId,
          autoSync: true,
          selected: packs ?? ["swe"],
          packs: [],
          ok: true,
          report: { at: new Date().toISOString(), outcome: "ok", installed: [], failures: [] },
        });
        return;
      }
      default:
        reply({ type: `${String(msg.type)}_response`, requestId, payload: { ok: true } });
    }
  }

  return {
    transport,
    sent,
    features,
    push: (sessionMessage) => reply(sessionMessage),
    drop: (reason = "test drop") => transport.onClose?.(1006, reason),
  };
}

export interface ScriptedFacade {
  client: PiStudioClient;
  daemon: DaemonClient;
  fake: ScriptedDaemon;
}

/** Builds a connected `PiStudioClient` over `makeScriptedDaemon`. */
export async function makeFacade(opts?: {
  features?: Record<string, boolean>;
}): Promise<ScriptedFacade> {
  const fake = makeScriptedDaemon(opts);
  const daemon = new DaemonClient({
    url: "ws://mock/ws",
    clientId: "c1",
    clientType: "cli",
    transport: fake.transport,
    rpcTimeoutMs: 1000,
  });
  await daemon.connect();
  return { client: new PiStudioClient(daemon), daemon, fake };
}
