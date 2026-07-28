import { expandHome } from "./resolve-path.js";

import type { Logger } from "../logging/logger.js";
import type { HandlerRegistry } from "../ws/router.js";
import type { SessionSubscriptions } from "../ws/session-subscriptions.js";
import type { FileWatchService } from "./file-watch-service.js";

/**
 * `file_watch_subscribe`/`file_watch_unsubscribe` (architecture/websocket-protocol.md § push/
 * subscription families, § passthrough fallback). Modelled directly on
 * `registerGitCheckoutHandlers`: the push carries only `{ type: "file_changed", path }` — no
 * content, since a watched file may be a multi-MB trajectory and the client already has the
 * chunked binary download path for the bytes. `path` is the *resolved* path the client subscribed
 * with, so client-side matching is a plain string compare.
 *
 * Deliberately outside `messages.ts`'s discriminated union, like the sibling `checkout_*` family —
 * both validate through `sessionMessageBaseSchema`'s passthrough fallback.
 */

/** Per-session cap on live `file_watch_subscribe` RPCs. `fs.watch` consumes an inotify handle per
 *  directory and the kernel enforces a global `fs.inotify.max_user_watches`; a client that
 *  subscribes in a loop (a bug in a tree-expansion effect is the realistic case, not an attacker)
 *  would otherwise exhaust it and break watching for the whole machine, not just this daemon. */
export const MAX_FILE_WATCHES_PER_SESSION = 128;

const FILE_WATCH_KEY_PREFIX = "file_watch:";

export interface FileWatchRpcDeps {
  fileWatchService: FileWatchService;
  /** Per-session subscription registry (task-005) — disposes a subscription's `fs.watch` when the
   *  session's socket closes, not just on an explicit unsubscribe. */
  subscriptions: SessionSubscriptions;
  logger?: Logger;
}

export function registerFileWatchHandlers(registry: HandlerRegistry, deps: FileWatchRpcDeps): void {
  const { fileWatchService, subscriptions, logger } = deps;

  registry.register("file_watch_subscribe", (ctx) => {
    const rawPath = String(ctx.message.path ?? "");
    const resolved = expandHome(rawPath);
    const session = ctx.session;
    const key = `${FILE_WATCH_KEY_PREFIX}${resolved}`;

    const activeWatchKeys = subscriptions
      .keysOf(session)
      .filter((k) => k.startsWith(FILE_WATCH_KEY_PREFIX));
    // A resubscribe of an already-watched path replaces in place (SessionSubscriptions.add's own
    // contract) rather than adding a new watch, so it must never count against the cap.
    if (!activeWatchKeys.includes(key) && activeWatchKeys.length >= MAX_FILE_WATCHES_PER_SESSION) {
      logger?.warn(
        { path: resolved, count: activeWatchKeys.length },
        "file-watch: session hit MAX_FILE_WATCHES_PER_SESSION, refusing new subscription",
      );
      return {
        type: "file_watch_subscribe_response",
        path: resolved,
        ok: false,
        error: "too_many_watches",
      };
    }

    const unsub = fileWatchService.subscribe(resolved, () => {
      session.send({ type: "session", message: { type: "file_changed", path: resolved } });
    });
    subscriptions.add(session, key, unsub);
    return { type: "file_watch_subscribe_response", path: resolved, ok: true };
  });

  registry.register("file_watch_unsubscribe", (ctx) => {
    const rawPath = String(ctx.message.path ?? "");
    const resolved = expandHome(rawPath);
    subscriptions.remove(ctx.session, `${FILE_WATCH_KEY_PREFIX}${resolved}`);
    return { type: "file_watch_unsubscribe_response", path: resolved, ok: true };
  });
}
