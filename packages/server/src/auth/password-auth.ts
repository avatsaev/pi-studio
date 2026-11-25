import type { IncomingMessage } from "node:http";

import bcrypt from "bcryptjs";

/**
 * Optional shared-secret password auth (architecture/auth-security.md § Password auth, § Behavior).
 *
 * The password is sourced from `daemon.auth.password` (config) or `PI_STUDIO_PASSWORD` (env) and is
 * **stored bcrypt-hashed**. When configured, every WS upgrade needs subprotocol
 * `pi-studio.bearer.<password>` (browsers cannot set custom WS headers). The HTTP server serves only
 * the unauthenticated `GET /api/health`.
 *
 * The daemon never stores or transmits provider API keys — there is nothing here to persist beyond
 * the password hash.
 */

export const WS_BEARER_SUBPROTOCOL_PREFIX = "pi-studio.bearer.";

/** True if `value` is already a bcrypt hash (`$2a$` / `$2b$` / `$2y$`). */
export function isBcryptHash(value: string): boolean {
  return /^\$2[aby]\$\d{2}\$/.test(value);
}

/**
 * Resolve the stored bcrypt hash from config/env (env wins). A plaintext secret is hashed; an
 * already-hashed value is used as-is. Returns `undefined` when no password is configured.
 */
export function resolvePasswordHash(opts: {
  configPassword?: string;
  envPassword?: string;
}): string | undefined {
  const raw = opts.envPassword?.trim() || opts.configPassword?.trim();
  if (!raw) return undefined;
  return isBcryptHash(raw) ? raw : bcrypt.hashSync(raw, 10);
}

/**
 * Extract the password from a `Sec-WebSocket-Protocol` header carrying
 * `pi-studio.bearer.<password>` (the header is a comma-separated list of offered subprotocols).
 */
export function bearerFromSubprotocol(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const entry of header.split(",")) {
    const proto = entry.trim();
    if (proto.startsWith(WS_BEARER_SUBPROTOCOL_PREFIX)) {
      return proto.slice(WS_BEARER_SUBPROTOCOL_PREFIX.length);
    }
  }
  return undefined;
}

export interface PasswordAuth {
  /** Whether a password is configured. When false, all requests are allowed. */
  readonly enabled: boolean;
  /** Verify a presented plaintext token against the stored hash. */
  verify(token: string | undefined): boolean;
  /** Authenticate a WS upgrade via the `pi-studio.bearer.<password>` subprotocol. */
  authenticateUpgrade(req: Pick<IncomingMessage, "headers">): boolean;
}

/** Build a {@link PasswordAuth} from a (possibly undefined) stored bcrypt hash. */
export function createPasswordAuth(passwordHash: string | undefined): PasswordAuth {
  const enabled = passwordHash !== undefined;

  const verify = (token: string | undefined): boolean => {
    if (!enabled) return true;
    if (!token) return false;
    return bcrypt.compareSync(token, passwordHash as string);
  };

  return {
    enabled,
    verify,
    authenticateUpgrade(req): boolean {
      if (!enabled) return true;
      const header = req.headers["sec-websocket-protocol"];
      const value = Array.isArray(header) ? header.join(",") : header;
      return verify(bearerFromSubprotocol(value));
    },
  };
}
