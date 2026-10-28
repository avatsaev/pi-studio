import type { HandlerRegistry } from "../../ws/router.js";
import type { AgentTodosService } from "./agent-todos-service.js";

/**
 * Wires `agent_todos_list_request` (swe/features/agent-todos.md § Wire family) onto
 * `AgentTodosService`: a thin adapter that stamps no policy of its own. The answer is flat — a
 * success carries `snapshot` (and no `ok`), a refusal carries `ok: false` + an open-string `error`
 * (`not_found`). An unreadable session file is already an empty snapshot inside the service, so
 * this handler never raises `rpc_error` for it. `requestId` is stamped by the router.
 *
 * Registered in **both** bootstraps: the mock provider is this family's scripted producer, so the
 * dev daemon has to serve it.
 */
export function registerAgentTodosHandlers(
  registry: HandlerRegistry,
  deps: { service: AgentTodosService },
): void {
  registry.register("agent_todos_list_request", (ctx) => {
    const agentId = typeof ctx.message.agentId === "string" ? ctx.message.agentId : "";
    const result = deps.service.list(agentId);
    return result.ok
      ? { type: "agent_todos_list_response", snapshot: result.snapshot }
      : { type: "agent_todos_list_response", ok: false, error: result.error };
  });
}
