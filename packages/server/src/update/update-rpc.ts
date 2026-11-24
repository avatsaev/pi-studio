import type { HandlerRegistry } from "../ws/router.js";
import type { UpdateService } from "./update-service.js";

/**
 * The `daemon_update_*` request family (features/self-update.md § RPCs and the broadcast). A thin
 * adapter: every decision lives in `UpdateService`. Authenticated sessions only, no role; a client
 * can never name a package or a version. A failed check is in `status.checkError`, never an
 * `rpc_error`. `requestId` is stamped by the router.
 */
export function registerDaemonUpdateHandlers(
  registry: HandlerRegistry,
  deps: { service: UpdateService },
): void {
  const { service } = deps;

  registry.register("daemon_update_status_request", async () => {
    await service.ready();
    return { type: "daemon_update_status_response", status: service.status() };
  });
  registry.register("daemon_update_check_request", async () => ({
    type: "daemon_update_check_response",
    status: await service.check("manual"),
  }));
  registry.register("daemon_update_apply_request", () => {
    const result = service.apply();
    return { type: "daemon_update_apply_response", ...result };
  });
  registry.register("daemon_update_set_auto_check_request", async (ctx) => {
    if (typeof ctx.message.enabled !== "boolean") {
      throw new Error("daemon_update_set_auto_check_request: `enabled` must be a boolean");
    }
    return {
      type: "daemon_update_set_auto_check_response",
      status: await service.setAutoCheck(ctx.message.enabled),
    };
  });
}
