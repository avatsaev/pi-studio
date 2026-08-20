import type { ProviderAuthType } from "@av-pi-studio/protocol";

import type { Logger } from "../../logging/logger.js";
import type { HandlerRegistry } from "../../ws/router.js";
import type { ProviderAuthService } from "./provider-auth-service.js";

/**
 * Wires the five `provider_auth_*` RPCs (swe/features/provider-auth-rpc.md § Public Contract) onto
 * `ProviderAuthService`. Modelled directly on `registerFileWatchHandlers`/
 * `registerGitCheckoutHandlers`: a thin adapter that stamps no policy of its own — ownership,
 * idempotency, and every error code already live in the service (task-003). This module's only
 * job is coercing wire input defensively, since the router never validates a session message's
 * shape before dispatch (see `ws/router.ts`'s `routeTextFrame`).
 *
 * Unlike its two siblings, this module does **not** touch `SessionSubscriptions` itself —
 * `ProviderAuthService` owns that entry directly (constructed with a `subscriptions` dep in
 * `bootstrap.ts`). See `provider-auth-service.ts`'s class doc comment for why: the RPC layer
 * deciding whether to `subscriptions.add()` based on the *result* of an awaited `login()` call has
 * a real race against the fire-and-forget flow settling before that await returns, which can leave
 * a stale disposer that's added after the flow it names already ended. Registering and clearing the
 * subscription inside `login()`/`settleFlow()`'s own synchronous stretches removes that race by
 * construction.
 *
 * Production-bootstrap only (`daemon/bootstrap.ts`) — `dev-bootstrap.ts` must never call this; the
 * dev daemon's minimal handler set answers `unknown_message_type` for all five types instead.
 */

export interface ProviderAuthRpcDeps {
  providerAuthService: ProviderAuthService;
  logger?: Logger;
}

function isProviderAuthType(value: unknown): value is ProviderAuthType {
  return value === "api_key" || value === "oauth";
}

export function registerProviderAuthHandlers(
  registry: HandlerRegistry,
  deps: ProviderAuthRpcDeps,
): void {
  const { providerAuthService, logger } = deps;

  registry.register("provider_auth_list_request", async () => {
    const payload = await providerAuthService.listProviders();
    return { type: "provider_auth_list_response", payload };
  });

  registry.register("provider_auth_login_request", async (ctx) => {
    const provider = String(ctx.message.provider ?? "");
    const authType = ctx.message.authType;
    if (!isProviderAuthType(authType)) {
      logger?.debug(
        { provider, authType },
        "provider-auth: login request with unsupported authType",
      );
      return {
        type: "provider_auth_login_response",
        payload: { ok: false, error: "unsupported_auth_type" },
      };
    }
    // Provider existence is the service's own call (`unknown_provider`) — this handler adds no
    // second opinion on top of it.
    const payload = await providerAuthService.login(ctx.session, provider, authType);
    return { type: "provider_auth_login_response", payload };
  });

  registry.register("provider_auth_respond_request", (ctx) => {
    const flowId = String(ctx.message.flowId ?? "");
    const promptId = String(ctx.message.promptId ?? "");
    const value = typeof ctx.message.value === "string" ? ctx.message.value : "";
    const payload = providerAuthService.respond(ctx.session, flowId, promptId, value);
    return { type: "provider_auth_respond_response", payload };
  });

  registry.register("provider_auth_cancel_request", (ctx) => {
    const flowId = String(ctx.message.flowId ?? "");
    const payload = providerAuthService.cancel(ctx.session, flowId);
    return { type: "provider_auth_cancel_response", payload };
  });

  registry.register("provider_auth_logout_request", async (ctx) => {
    const provider = String(ctx.message.provider ?? "");
    const payload = await providerAuthService.logout(provider);
    return { type: "provider_auth_logout_response", payload };
  });
}
