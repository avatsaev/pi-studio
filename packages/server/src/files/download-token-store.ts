import { randomUUID } from "node:crypto";

import { LRUCache } from "lru-cache";

/**
 * Short-lived, single-use download tokens (features/file-explorer-transfer.md § Behavior (download)).
 * Tokens authorize a binary download stream for one resolved path. Transient in-memory only.
 *
 * Storage is an `LRUCache` so a flood of issued-but-never-consumed tokens can't grow unbounded — the
 * oldest entries are evicted past `maxTokens`. Single-use + TTL expiry remain explicit (and use the
 * injectable `now` clock) so the semantics stay deterministic and testable.
 *
 * **The TTL is a cleanup device, not an authorization control** — a token never leaves the
 * authenticated (and, over relay, E2EE) session it was issued to, and `maxTokens` is what actually
 * bounds memory. It is therefore deliberately generous, because the clock starts when the daemon
 * ISSUES the token while the client cannot use it until the response has crossed the wire, and both
 * share one socket with every in-flight download's `Chunk` frames. Open a second file while a large
 * one is still streaming on a slow link and the token response queues behind that backlog: at
 * 250 KB/s a 20 MB transfer in front of it delays delivery by ~100s, so the old 60s TTL handed the
 * client an already-expired token and the download failed with `invalid_or_expired_token` (relay
 * made this routine — base64-inflated frames plus an extra hop — but any saturated link does it).
 * Ten minutes of head-of-line blocking means the connection is already unusable, so nothing legible
 * is lost by not expiring sooner.
 */

interface TokenEntry {
  path: string;
  expiresAt: number;
  used: boolean;
}

export class DownloadTokenStore {
  private readonly tokens: LRUCache<string, TokenEntry>;

  constructor(
    private readonly ttlMs = 10 * 60_000,
    private readonly now: () => number = () => Date.now(),
    maxTokens = 10_000,
  ) {
    this.tokens = new LRUCache<string, TokenEntry>({ max: maxTokens });
  }

  /** Issue a single-use token for `path`. */
  issue(path: string): { token: string; expiresAt: number } {
    const token = randomUUID();
    const expiresAt = this.now() + this.ttlMs;
    this.tokens.set(token, { path, expiresAt, used: false });
    return { token, expiresAt };
  }

  /** Validate + consume a token. Returns the path, or null if invalid/expired/already used. */
  consume(token: string): string | null {
    const entry = this.tokens.get(token);
    if (!entry) return null;
    if (entry.used || entry.expiresAt < this.now()) {
      this.tokens.delete(token);
      return null;
    }
    entry.used = true;
    this.tokens.delete(token); // single-use
    return entry.path;
  }
}
