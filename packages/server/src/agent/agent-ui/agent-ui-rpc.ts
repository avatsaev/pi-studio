import type { Logger } from "../../logging/logger.js";
import type { HandlerRegistry } from "../../ws/router.js";
import type { AgentUiService } from "./agent-ui-service.js";

/**
 * Wires the two `agent_ui_*` RPCs (swe/features/extension-ui-rpc.md § Public contract) onto
 * `AgentUiService`. Modelled directly on `registerFileWatchHandlers`/`registerProviderAuthHandlers`:
 * a thin adapter that stamps no policy of its own — ownership, first-wins resolution, and every
 * error code already live in the service (task-003). Never throws for a domain failure
 * (`not_found`/`unsupported` travel in `payload`); `requestId` is stamped by the router, not here.
 *
 * Registered in **both** bootstraps (task-004's deviation from the production-only
 * `provider_auth`/`file_watch` families) — the mock provider is this family's designated producer,
 * so the dev daemon must be able to drive it end to end.
 */

export interface AgentUiRpcDeps {
  service: AgentUiService;
  logger?: Logger;
}

export function registerAgentUiHandlers(registry: HandlerRegistry, deps: AgentUiRpcDeps): void {
  const { service } = deps;

  registry.register("agent_ui_respond_request", (ctx) => {
    const uiRequestId = String(ctx.message.uiRequestId ?? "");
    const response = (ctx.message.response ?? {}) as Record<string, unknown>;
    const result = service.respond(uiRequestId, response);
    return {
      type: "agent_ui_respond_response",
      payload: result.error ? { ok: result.ok, error: result.error } : { ok: result.ok },
    };
  });

  registry.register("agent_ui_list_request", (ctx) => {
    const agentId = typeof ctx.message.agentId === "string" ? ctx.message.agentId : undefined;
    return {
      type: "agent_ui_list_response",
      payload: {
        ok: true,
        pending: service.listPending(agentId),
        surfaces: service.listSurfaces(agentId),
      },
    };
  });
}
