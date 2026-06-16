import type { Session } from "../ws/session.js";
import type { HandlerRegistry } from "../ws/router.js";
import { CheckoutDiffManager, type DiffRequest } from "./checkout-diff-manager.js";
import { WorkspaceGitService } from "./workspace-git-service.js";

/**
 * Wire the checkout status/diff streaming RPCs (features/git-checkout.md § Status & diff;
 * architecture/websocket-protocol.md § checkout_* families).
 *
 * Status/diff updates are pushed to the requesting session. `checkout_refresh_request` is only
 * registered when `features.checkoutRefresh` is advertised by the daemon.
 */

export interface GitCheckoutRpcDeps {
  gitService: WorkspaceGitService;
  diffManager: CheckoutDiffManager;
  /** Whether the daemon advertises `features.checkoutRefresh`. */
  checkoutRefreshEnabled: boolean;
}

export function registerGitCheckoutHandlers(
  registry: HandlerRegistry,
  deps: GitCheckoutRpcDeps,
): void {
  const { gitService, diffManager } = deps;
  // Track per-session status unsubscribers so a session can stop watching.
  const statusUnsubs = new Map<string, () => void>();

  registry.register("checkout_status_subscribe", (ctx) => {
    const cwd = String(ctx.message.cwd ?? "");
    const session = ctx.session;
    const key = `${sessionKey(session)}:${cwd}`;
    statusUnsubs.get(key)?.(); // replace an existing subscription for the same cwd
    const unsub = gitService.subscribe(cwd, (projection) => {
      session.send({
        type: "session",
        message: { type: "checkout_status_update", cwd, projection },
      });
    });
    statusUnsubs.set(key, unsub);
    return { type: "checkout_status_subscribe_response", cwd, ok: true };
  });

  registry.register("checkout_status_unsubscribe", (ctx) => {
    const cwd = String(ctx.message.cwd ?? "");
    const key = `${sessionKey(ctx.session)}:${cwd}`;
    statusUnsubs.get(key)?.();
    statusUnsubs.delete(key);
    return { type: "checkout_status_unsubscribe_response", cwd, ok: true };
  });

  registry.register("checkout_diff_subscribe", async (ctx) => {
    const request: DiffRequest = {
      cwd: String(ctx.message.cwd ?? ""),
      staged: Boolean(ctx.message.staged),
      path: ctx.message.path as string | undefined,
    };
    const session = ctx.session;
    const subscriptionId = await diffManager.subscribe(request, (update) => {
      session.send({ type: "session", message: update });
    });
    return { type: "checkout_diff_subscribe_response", subscriptionId };
  });

  registry.register("checkout_diff_unsubscribe", (ctx) => {
    const subscriptionId = String(ctx.message.subscriptionId ?? "");
    const ok = diffManager.unsubscribe(subscriptionId);
    return { type: "checkout_diff_unsubscribe_response", subscriptionId, ok };
  });

  // Feature-gated: only available when the daemon advertises checkoutRefresh.
  if (deps.checkoutRefreshEnabled) {
    registry.register("checkout_refresh_request", async (ctx) => {
      const cwd = String(ctx.message.cwd ?? "");
      const changed = await gitService.refresh(cwd);
      return { type: "checkout_refresh_response", cwd, changed };
    });
  }
}

function sessionKey(session: Session): string {
  return (session as unknown as { id?: string }).id ?? String(session);
}
