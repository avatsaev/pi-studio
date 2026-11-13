import type { HandlerRegistry } from "../ws/router.js";
import type { DaemonLogsService } from "./daemon-logs-service.js";

/**
 * Wires the `daemon_logs_*` request family (swe/features/daemon-log-streaming.md) onto
 * `DaemonLogsService`. Invalid `minLevel`/`tail` are domain failures in `payload`, never
 * `rpc_error`. `requestId` is stamped by the router. Registered in both bootstraps; advertised by the
 * `daemonObservability` server feature.
 */
export function registerDaemonLogsHandlers(
  registry: HandlerRegistry,
  deps: { service: DaemonLogsService },
): void {
  registry.register("daemon_logs_subscribe_request", (ctx) => ({
    type: "daemon_logs_subscribe_response",
    payload: deps.service.subscribe(ctx.session, ctx.message.minLevel, ctx.message.tail),
  }));
  registry.register("daemon_logs_unsubscribe_request", (ctx) => {
    deps.service.unsubscribe(ctx.session);
    return { type: "daemon_logs_unsubscribe_response", payload: { ok: true } };
  });
}
