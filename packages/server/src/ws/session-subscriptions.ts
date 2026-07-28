import type { Session } from "./session.js";

/**
 * Per-session push-subscription registry (architecture/websocket-protocol.md § session lifecycle,
 * § push/subscription families). One place to hold every subscription a session has open —
 * `checkout_status:<cwd>` today, `file_watch:<path>` from task-006 — and one hook
 * (`disposeSession`) that releases all of them when the socket closes.
 *
 * Fixes a real leak: before this, `checkout_status_subscribe`'s `WorkspaceGitService` listener was
 * only ever released by an explicit unsubscribe RPC or a same-key resubscribe — never by a dropped
 * connection (`ws-server.ts`'s close handler had no hook to call into). A file-watch subscription
 * (task-006) would inherit the same leak and additionally pin an OS-level `fs.watch` handle, so this
 * is fixed first.
 *
 * Deliberately free of any domain knowledge (no cwd/path semantics) — callers namespace their own
 * keys, which is what lets one registry serve multiple subscription families.
 */
export class SessionSubscriptions {
  private readonly bySession = new WeakMap<Session, Map<string, () => void>>();

  /** Register `unsub` under `key` for `session`, disposing any existing entry for that key first
   *  (preserves e.g. `checkout_status_subscribe`'s replace-on-resubscribe semantics). */
  add(session: Session, key: string, unsub: () => void): void {
    let subs = this.bySession.get(session);
    if (!subs) {
      subs = new Map();
      this.bySession.set(session, subs);
    }
    disposeSafely(subs.get(key));
    subs.set(key, unsub);
  }

  /** Dispose and forget one key. Safe when absent. */
  remove(session: Session, key: string): void {
    const subs = this.bySession.get(session);
    const unsub = subs?.get(key);
    if (!unsub) return;
    subs?.delete(key);
    disposeSafely(unsub);
  }

  /** Dispose every subscription this session holds. Safe to call twice — a second call finds
   *  nothing left to dispose. */
  disposeSession(session: Session): void {
    const subs = this.bySession.get(session);
    if (!subs) return;
    for (const unsub of subs.values()) disposeSafely(unsub);
    this.bySession.delete(session);
  }
}

/** Runs `unsub` inside try/catch so one throwing disposer cannot strand its siblings. */
function disposeSafely(unsub: (() => void) | undefined): void {
  if (!unsub) return;
  try {
    unsub();
  } catch {
    // Intentionally swallowed — a subscription's own cleanup failing must never break another
    // subscription's cleanup, socket teardown, or session bookkeeping.
  }
}
