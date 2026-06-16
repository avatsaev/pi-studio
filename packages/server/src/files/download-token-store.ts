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
 * TODO(verify): exact TTL / single-use semantics — modeled as 60s TTL, consumed on first use.
 */

interface TokenEntry {
  path: string;
  expiresAt: number;
  used: boolean;
}

export class DownloadTokenStore {
  private readonly tokens: LRUCache<string, TokenEntry>;

  constructor(
    private readonly ttlMs = 60_000,
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
