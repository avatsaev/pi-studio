import type { ViewerSettingsGetResponse, ViewerSettingsSetResponse } from "@av-pi-studio/protocol";

import type { Logger } from "../logging/logger.js";
import type { HandlerRegistry } from "../ws/router.js";
import type { Session } from "../ws/session.js";
import {
  applyViewerSettingsPatch,
  loadViewerSettings,
  saveViewerSettings,
  type ViewerSettingsPatch,
} from "./viewer-settings-state.js";

/**
 * `viewer_settings_get`/`_set` RPCs + the `viewer_settings_update` broadcast
 * (docs/MOLVIEWER_DECOUPLING.md § 4.4). Thin orchestration only — every decision (merge
 * semantics, defaults, fallback direction) lives in `viewer-settings-state.ts`.
 */

export interface ViewerSettingsRpcDeps {
  home: string;
  broadcast: (sessions: Iterable<Session>, message: unknown) => void;
  getActiveSessions: () => Iterable<Session>;
  logger?: Logger;
}

/** `ctx.message` is an unvalidated `Record<string, unknown>` (`ws/router.ts`), so the handler
 *  must check `patch`'s shape itself rather than trust the wire schema a conforming client used —
 *  same posture as `extensions-rpc.ts`'s `isSlugArray`. */
function isViewerSettingsPatch(value: unknown): value is ViewerSettingsPatch {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
    const e = entry as Record<string, unknown>;
    if ("enabled" in e && typeof e.enabled !== "boolean") return false;
    if (
      "config" in e &&
      e.config !== undefined &&
      (typeof e.config !== "object" || e.config === null || Array.isArray(e.config))
    ) {
      return false;
    }
    return true;
  });
}

export function registerViewerSettingsHandlers(
  registry: HandlerRegistry,
  deps: ViewerSettingsRpcDeps,
): void {
  const { home, broadcast, getActiveSessions, logger } = deps;

  // Serializes every successful `set`'s read-modify-write so two concurrent patches to two
  // different viewer ids never race and lose one's update. "Last write wins" is the semantic
  // rule for a single boolean; a lost update across two different ids is a bug wearing that
  // semantic's clothes, not the semantic itself. A rejected link (a write failure) must not wedge
  // the queue for later callers, so the chained promise always resolves regardless of outcome —
  // only the caller's own awaited `run` promise carries the rejection.
  let queue: Promise<unknown> = Promise.resolve();
  function enqueueSet(task: () => Promise<ViewerSettingsGetResponse["payload"]["settings"]>) {
    const run = queue.then(task, task);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  registry.register(
    "viewer_settings_get_request",
    async (): Promise<Omit<ViewerSettingsGetResponse, "requestId">> => {
      const settings = await loadViewerSettings(home, logger);
      return { type: "viewer_settings_get_response", payload: { settings } };
    },
  );

  registry.register(
    "viewer_settings_set_request",
    async (ctx): Promise<Omit<ViewerSettingsSetResponse, "requestId">> => {
      const patch = ctx.message.patch;

      // A malformed `patch` is a domain failure, never a silent partial apply or a thrown
      // `rpc_error` (transport-level only). The wire schema declares no `ok`/`error` channel on
      // this response (unlike `provider_auth_*`/`extension_packs_*`), so the domain-failure
      // answer is the current, unchanged document — a no-op the caller can observe by comparing
      // it to the patch it sent. Only a client bypassing the protocol schema
      // (`patch: Record<string, viewerSettingsPatchEntrySchema>`) can reach this path.
      if (!isViewerSettingsPatch(patch)) {
        logger?.warn({ patch }, "viewer_settings_set_request: rejecting malformed patch");
        const settings = await loadViewerSettings(home, logger);
        return { type: "viewer_settings_set_response", payload: { settings } };
      }

      const settings = await enqueueSet(async () => {
        const current = await loadViewerSettings(home, logger);
        const next = applyViewerSettingsPatch(current, patch);
        await saveViewerSettings(home, next);
        return next;
      });

      // Broadcast BEFORE answering (slash-command-operations.ts:216-221 ordering) — including the
      // caller — so no session, not even this one, ever observes a success while its own cached
      // copy is stale.
      broadcast(getActiveSessions(), { type: "viewer_settings_update", settings });

      return { type: "viewer_settings_set_response", payload: { settings } };
    },
  );
}
