import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

import nacl from "tweetnacl";
import { z } from "zod";

import { ensureDirectoryLayout } from "../persistence/atomic-store.js";

/**
 * Daemon single-owner identity primitives (architecture/daemon-bootstrap.md § Behavior,
 * architecture/relay-e2ee.md § Data & Persistence). Exactly one daemon may own a given
 * `$PI_STUDIO_HOME`, enforced by the PID lock.
 */

type Env = Record<string, string | undefined>;

/** Resolve the state directory: `PI_STUDIO_HOME` env or `~/.pi-studio`. */
export function resolvePiStudioHome(env: Env = process.env): string {
  const fromEnv = env.PI_STUDIO_HOME?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : join(homedir(), ".pi-studio");
}

/** Resolve home and create the on-disk directory layout. Returns the resolved home. */
export async function initPiStudioHome(env: Env = process.env): Promise<string> {
  const home = resolvePiStudioHome(env);
  await ensureDirectoryLayout(home);
  return home;
}

// ---------------------------------------------------------------------------
// PID lock
// ---------------------------------------------------------------------------

/** Thrown when another live daemon already owns this `$PI_STUDIO_HOME`. */
export class DaemonLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DaemonLockError";
  }
}

export interface PidLockInfo {
  pid: number;
  startedAt: string;
  listen?: string;
}

export interface PidLock {
  readonly info: PidLockInfo;
  /** Remove the PID file if it still belongs to this lock. */
  release(): void;
}

/** True if `pid` references a live process (EPERM counts as alive). */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export interface AcquirePidLockOptions {
  listen?: string;
  /** Override the current pid (testing). */
  pid?: number;
  /** Override the liveness check (testing). */
  isAlive?: (pid: number) => boolean;
}

/**
 * Acquire the daemon PID lock at `pidPath`. If the file exists and records a *live* foreign PID,
 * throws {@link DaemonLockError}. A stale (dead PID) or corrupt lock is reclaimed. Returns a handle
 * whose `release()` removes the file iff it still belongs to this lock.
 */
export function acquirePidLock(pidPath: string, options: AcquirePidLockOptions = {}): PidLock {
  const pid = options.pid ?? process.pid;
  const isAlive = options.isAlive ?? isProcessAlive;

  if (existsSync(pidPath)) {
    try {
      const existing = JSON.parse(readFileSync(pidPath, "utf8")) as Partial<PidLockInfo>;
      if (typeof existing.pid === "number" && existing.pid !== pid && isAlive(existing.pid)) {
        throw new DaemonLockError(
          `another daemon is running (pid ${existing.pid}) for this PI_STUDIO_HOME`,
        );
      }
    } catch (error) {
      if (error instanceof DaemonLockError) throw error;
      // Corrupt/unreadable lock file → reclaim.
    }
  }

  const info: PidLockInfo = {
    pid,
    startedAt: new Date().toISOString(),
    ...(options.listen ? { listen: options.listen } : {}),
  };
  writeFileSync(pidPath, `${JSON.stringify(info, null, 2)}\n`, "utf8");

  return {
    info,
    release(): void {
      try {
        const current = JSON.parse(readFileSync(pidPath, "utf8")) as Partial<PidLockInfo>;
        if (current.pid === pid) unlinkSync(pidPath);
      } catch {
        // Already gone or unreadable — nothing to release.
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Server id
// ---------------------------------------------------------------------------

/**
 * Load or create the stable daemon id (`srv_<base64url>`), persisted as plain text. An explicit
 * `PI_STUDIO_SERVER_ID` env var overrides the persisted value.
 */
export function loadOrCreateServerId(home: string, env: Env = process.env): string {
  const override = env.PI_STUDIO_SERVER_ID?.trim();
  if (override && override.length > 0) return override;

  const path = join(home, "server-id");
  if (existsSync(path)) {
    const value = readFileSync(path, "utf8").trim();
    if (value.length > 0) return value;
  }
  const id = `srv_${randomBytes(16).toString("base64url")}`;
  writeFileSync(path, id, "utf8");
  return id;
}

// ---------------------------------------------------------------------------
// Daemon keypair (libsodium box / Curve25519)
// ---------------------------------------------------------------------------

export const daemonKeypairSchema = z.object({
  v: z.literal(2),
  publicKeyB64: z.string(),
  secretKeyB64: z.string(),
});
export type DaemonKeypair = z.infer<typeof daemonKeypairSchema>;

function isValidKeypair(kp: DaemonKeypair): boolean {
  return (
    Buffer.from(kp.publicKeyB64, "base64").length === nacl.box.publicKeyLength &&
    Buffer.from(kp.secretKeyB64, "base64").length === nacl.box.secretKeyLength
  );
}

/**
 * Load or create the daemon's persistent Curve25519 box keypair at `daemon-keypair.json` (mode
 * `0600`). An unreadable/invalid file is regenerated (which invalidates existing relay pairings).
 */
export function loadOrCreateDaemonKeypair(home: string): DaemonKeypair {
  const path = join(home, "daemon-keypair.json");
  if (existsSync(path)) {
    try {
      const parsed = daemonKeypairSchema.parse(JSON.parse(readFileSync(path, "utf8")));
      if (isValidKeypair(parsed)) return parsed;
    } catch {
      // fall through to regenerate
    }
  }

  const pair = nacl.box.keyPair();
  const keypair: DaemonKeypair = {
    v: 2,
    publicKeyB64: Buffer.from(pair.publicKey).toString("base64"),
    secretKeyB64: Buffer.from(pair.secretKey).toString("base64"),
  };
  writeFileSync(path, `${JSON.stringify(keypair, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600); // enforce regardless of umask
  return keypair;
}
