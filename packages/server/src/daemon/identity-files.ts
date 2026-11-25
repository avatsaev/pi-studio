import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import nacl from "tweetnacl";

import type { Logger } from "../logging/logger.js";

/**
 * The daemon's two identity files in `$PI_STUDIO_HOME`: `server-id` (the stable id clients see) and
 * `daemon-keypair.json` (the Curve25519 pair behind every pairing link). Losing either is never
 * silent: a file that cannot be used is set aside as `<name>.corrupt-<UTC timestamp>`, one error is
 * logged and a new value is written atomically. A missing file is created quietly.
 *
 * Synchronous, like `startDaemon`, which needs both values before it listens — so these do not use
 * the async helpers of `persistence/atomic-store.ts` (same temp-file-then-rename, same file names).
 */

/** The daemon's Curve25519 pair for pairing (architecture/relay-e2ee.md § Pairing), as base64. */
export interface DaemonKeypair {
  publicKeyB64: string;
  secretKeyB64: string;
}

const SERVER_ID_FILE = "server-id";
const KEYPAIR_FILE = "daemon-keypair.json";

/** `20261125T143012Z`: a UTC timestamp that is a valid file name on every platform. */
function fileTimestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

/**
 * Write `text` to `path` through a temp file in the same directory (created with `mode`, fsynced),
 * then rename it over `path`: a crash leaves the previous file or the new one, never half of one.
 */
function writeFileAtomicSync(path: string, text: string, mode: number): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    const fd = openSync(tmp, "wx", mode);
    try {
      writeFileSync(fd, text, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

/**
 * Rename a damaged `path` to `<name>.corrupt-<UTC timestamp>` (`-1`, `-2`… when that name is taken)
 * and log one error: the path, where it went, why, and what that costs (`consequence`). Returns
 * false, after logging that error instead, when the file cannot be set aside — it must then stay as
 * it is, so the caller writes nothing over it.
 */
function setAsideSync(path: string, reason: string, consequence: string, logger: Logger): boolean {
  const base = `${path}.corrupt-${fileTimestamp(new Date())}`;
  let target = base;
  for (let n = 1; existsSync(target); n++) target = `${base}-${n}`;
  try {
    renameSync(path, target);
  } catch (error) {
    logger.error(
      { path, reason, err: errorText(error) },
      `damaged file could not be set aside and is left as it is; ${consequence}`,
    );
    return false;
  }
  logger.error({ path, quarantinedTo: target, reason }, `damaged file set aside; ${consequence}`);
  return true;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A read failed because nothing is there (also when the home directory itself is not one). */
function isAbsent(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** Read a stable server id from `<home>/server-id`, generating + persisting one if absent. */
export function resolveServerId(home: string, logger: Logger, override?: string): string {
  if (override) return override;
  if (process.env.PI_STUDIO_SERVER_ID) return process.env.PI_STUDIO_SERVER_ID;
  const path = join(home, SERVER_ID_FILE);

  let damaged: string | undefined;
  try {
    const value = readFileSync(path, "utf8").trim();
    if (value) return value;
    damaged = "empty";
  } catch (error) {
    if (!isAbsent(error)) {
      damaged = `unreadable: ${errorText(error)}`;
    }
  }
  const id = randomUUID();
  if (damaged && !setAsideSync(path, damaged, "a new server id is used", logger)) return id;

  try {
    writeFileAtomicSync(path, id, 0o644);
  } catch (error) {
    logger.error(
      { path, err: errorText(error) },
      "server id could not be written; this run uses an id that changes at the next start",
    );
  }
  return id;
}

/** A new random pair; nothing is written. */
export function generateDaemonKeypair(): DaemonKeypair {
  const { publicKey, secretKey } = nacl.box.keyPair();
  return {
    publicKeyB64: Buffer.from(publicKey).toString("base64"),
    secretKeyB64: Buffer.from(secretKey).toString("base64"),
  };
}

/** Write `keypair` to `<home>/daemon-keypair.json` atomically, owner-only (0600): it holds the secret key. */
export function writeDaemonKeypair(home: string, keypair: DaemonKeypair): void {
  writeFileAtomicSync(join(home, KEYPAIR_FILE), JSON.stringify(keypair), 0o600);
}

/** The pair in `text`, or why it is not one. */
function parseKeypair(text: string): DaemonKeypair | string {
  let parsed: Partial<Record<keyof DaemonKeypair, unknown>> | null;
  try {
    parsed = JSON.parse(text) as Partial<Record<keyof DaemonKeypair, unknown>> | null;
  } catch (error) {
    return `invalid JSON: ${errorText(error)}`;
  }
  const publicKeyB64 = parsed?.publicKeyB64;
  const secretKeyB64 = parsed?.secretKeyB64;
  if (typeof publicKeyB64 !== "string" || !publicKeyB64) return "publicKeyB64 is missing";
  if (typeof secretKeyB64 !== "string" || !secretKeyB64) return "secretKeyB64 is missing";
  return { publicKeyB64, secretKeyB64 };
}

/**
 * Read (or generate + persist) the daemon's stable Curve25519 keypair for pairing. Stored as base64
 * at `<home>/daemon-keypair.json`; the CLI's `readDaemonPublicKey()` reads the same file/shape to
 * build the pairing QR URL.
 *
 * A file that cannot be used is set aside and replaced by a new pair, with an error that says every
 * pairing link is revoked: a pairing link's `offer=` key IS the credential for a relay connection.
 * A write that fails is logged and the pair is used for this run only.
 */
export function resolveDaemonKeypair(home: string, logger: Logger): DaemonKeypair {
  const path = join(home, KEYPAIR_FILE);

  let damaged: string | undefined;
  try {
    const parsed = parseKeypair(readFileSync(path, "utf8"));
    if (typeof parsed !== "string") {
      // Contains the secret key — re-tighten files written before mode 0600 was enforced.
      try {
        chmodSync(path, 0o600);
      } catch {
        /* best-effort */
      }
      return parsed;
    }
    damaged = parsed;
  } catch (error) {
    if (!isAbsent(error)) {
      damaged = `unreadable: ${errorText(error)}`;
    }
  }
  const keypair = generateDaemonKeypair();
  if (
    damaged &&
    !setAsideSync(path, damaged, "pairing links are revoked and devices must pair again", logger)
  ) {
    return keypair;
  }

  try {
    writeDaemonKeypair(home, keypair);
  } catch (error) {
    logger.error(
      { path, err: errorText(error) },
      "daemon key pair could not be written; this run uses a pair that changes at the next start, so pairing links stop working then",
    );
  }
  return keypair;
}
