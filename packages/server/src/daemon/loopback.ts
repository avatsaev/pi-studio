/** True for hosts that only accept connections from this machine. */
export function isLoopbackHost(host: string): boolean {
  const h = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (h === "::1" || h === "localhost" || h.endsWith(".localhost")) return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/** Code of the error a daemon (or `pi-studio daemon start`) raises when it refuses an open bind. */
export const UNPROTECTED_BIND_CODE = "unprotected_bind";

/**
 * True when `host` accepts connections from beyond this machine and no password is configured
 * (`PI_STUDIO_PASSWORD` wins over `daemon.auth.password`, as in `resolvePasswordHash`). Such a bind
 * is refused: anyone who can reach the port would control every agent and terminal.
 */
export function isUnprotectedBind(
  host: string,
  passwords: { configPassword?: string; envPassword?: string },
): boolean {
  const password = passwords.envPassword?.trim() || passwords.configPassword?.trim();
  return !isLoopbackHost(host) && !password;
}

/** The refusal message; names both ways to set a password and the loopback alternative. */
export function unprotectedBindMessage(host: string, port: number): string {
  return `refusing to listen on ${host}:${port}: it is reachable beyond this machine and no password is set — set PI_STUDIO_PASSWORD or daemon.auth.password in config.json (\`pi-studio daemon set-password\`), or bind 127.0.0.1`;
}

/** The error raised for a refused bind (`code` is `UNPROTECTED_BIND_CODE`). */
export function unprotectedBindError(host: string, port: number): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error(unprotectedBindMessage(host, port));
  err.code = UNPROTECTED_BIND_CODE;
  return err;
}
