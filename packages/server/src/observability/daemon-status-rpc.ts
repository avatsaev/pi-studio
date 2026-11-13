import type { HandlerRegistry } from "../ws/router.js";
import type { DaemonStatusService } from "./daemon-status-service.js";

/**
 * Wires the `daemon_status_*` request family (swe/features/daemon-status-rpc.md) onto
 * `DaemonStatusService`: a thin adapter with no policy of its own. Domain results travel in
 * `payload`; `requestId` is stamped by the router. Registered in both bootstraps; advertised by the
 * `daemonObservability` server feature.
 */
export function registerDaemonStatusHandlers(
  registry: HandlerRegistry,
  deps: { service: DaemonStatusService },
): void {
  registry.register("daemon_status_request", () => ({
    type: "daemon_status_response",
    payload: deps.service.oneShot(),
  }));
  registry.register("daemon_status_subscribe_request", (ctx) => ({
    type: "daemon_status_subscribe_response",
    payload: deps.service.subscribe(ctx.session),
  }));
  registry.register("daemon_status_unsubscribe_request", (ctx) => {
    deps.service.unsubscribe(ctx.session);
    return { type: "daemon_status_unsubscribe_response", payload: { ok: true } };
  });
}
