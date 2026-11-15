/**
 * Relay protocol 2 control vocabulary (architecture/relay-protocol.md §§ 1–3): frames, close
 * codes, limits and timers. Pure and browser-safe — no `ws`, no `node:*` imports.
 */
import nacl from "tweetnacl";

export interface RelayDaemonRegisterFrame {
  type: "relay_daemon_register";
  v: 2;
  sessionId: string;
}
export interface RelayRegisteredFrame {
  type: "relay_registered";
}
export interface RelayClientConnectFrame {
  type: "relay_client_connect";
  v: 2;
  sessionId: string;
}
export interface RelayDialFrame {
  type: "relay_dial";
  connectionId: string;
}
export interface RelayDaemonAttachFrame {
  type: "relay_daemon_attach";
  v: 2;
  sessionId: string;
  connectionId: string;
}
export interface RelayPairedFrame {
  type: "relay_paired";
  connectionId: string;
}

export type ControlFrame =
  | RelayDaemonRegisterFrame
  | RelayRegisteredFrame
  | RelayClientConnectFrame
  | RelayDialFrame
  | RelayDaemonAttachFrame
  | RelayPairedFrame;

/** Frames a daemon or client receives from the relay. */
export type RelayFrame = RelayRegisteredFrame | RelayDialFrame | RelayPairedFrame;

export type FirstFrame =
  | { kind: "daemon_register"; sessionId: string }
  | { kind: "client_connect"; sessionId: string }
  | { kind: "daemon_attach"; sessionId: string; connectionId: string }
  | { kind: "legacy"; sessionId: string }
  | { kind: "invalid" };

const HEX32 = /^[0-9a-f]{32}$/;

export function isValidSessionId(value: unknown): value is string {
  return typeof value === "string" && HEX32.test(value);
}

export function isValidConnectionId(value: unknown): value is string {
  return typeof value === "string" && HEX32.test(value);
}

export function encodeControlFrame(frame: ControlFrame): string {
  return JSON.stringify(frame);
}

function parseObject(data: string): Record<string, unknown> | null {
  if (typeof data !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

const INVALID: FirstFrame = { kind: "invalid" };

/** Classify the first frame of a socket. Never throws. */
export function parseFirstFrame(data: string): FirstFrame {
  const obj = parseObject(data);
  if (!obj) return INVALID;
  switch (obj.type) {
    case "relay_register":
      return { kind: "legacy", sessionId: String(obj.sessionId) };
    case "relay_daemon_register":
      if (obj.v !== 2 || !isValidSessionId(obj.sessionId)) return INVALID;
      return { kind: "daemon_register", sessionId: obj.sessionId };
    case "relay_client_connect":
      if (obj.v !== 2 || !isValidSessionId(obj.sessionId)) return INVALID;
      return { kind: "client_connect", sessionId: obj.sessionId };
    case "relay_daemon_attach":
      if (obj.v !== 2 || !isValidSessionId(obj.sessionId) || !isValidConnectionId(obj.connectionId))
        return INVALID;
      return { kind: "daemon_attach", sessionId: obj.sessionId, connectionId: obj.connectionId };
    default:
      return INVALID;
  }
}

/** Parse a frame received from the relay. `null` for unknown or malformed frames (ignored). */
export function parseRelayFrame(data: string): RelayFrame | null {
  const obj = parseObject(data);
  if (!obj) return null;
  switch (obj.type) {
    case "relay_registered":
      return { type: "relay_registered" };
    case "relay_dial":
      return isValidConnectionId(obj.connectionId)
        ? { type: "relay_dial", connectionId: obj.connectionId }
        : null;
    case "relay_paired":
      return isValidConnectionId(obj.connectionId)
        ? { type: "relay_paired", connectionId: obj.connectionId }
        : null;
    default:
      return null;
  }
}

/** Close code and reason name (the reason string of the close frame is the name). */
export const RELAY_CLOSE = {
  PROTOCOL_ERROR: { code: 4100, reason: "protocol_error" },
  IDENTIFY_TIMEOUT: { code: 4101, reason: "identify_timeout" },
  DAEMON_OFFLINE: { code: 4102, reason: "daemon_offline" },
  DAEMON_UNRESPONSIVE: { code: 4103, reason: "daemon_unresponsive" },
  TOO_MANY_CLIENTS: { code: 4104, reason: "too_many_clients" },
  DAEMON_OUTDATED: { code: 4105, reason: "daemon_outdated" },
  UNKNOWN_CONNECTION: { code: 4106, reason: "unknown_connection" },
  REPLACED: { code: 4107, reason: "replaced" },
  PING_TIMEOUT: { code: 4108, reason: "ping_timeout" },
  PEER_CLOSED: { code: 4109, reason: "peer_closed" },
  CHANNEL_ERROR: { code: 4200, reason: "channel_error" },
} as const;

/** True when an application may send `code` in a close frame (so the relay may forward it). */
export function isForwardableCloseCode(code: number): boolean {
  return (
    (code >= 1000 && code <= 1003) ||
    (code >= 1007 && code <= 1014) ||
    (code >= 3000 && code <= 4999)
  );
}

const KIB = 1024;
const MIB = 1024 * KIB;

export const RELAY_DEFAULTS = {
  maxClientsPerDaemon: 32,
  maxFrameBytes: 100 * MIB,
  identifyTimeoutMs: 10_000,
  attachTimeoutMs: 10_000,
  registrationAnswerTimeoutMs: 10_000,
  keyExchangeTimeoutMs: 10_000,
  connectTimeoutMs: 15_000,
  pingIntervalMs: 30_000,
  silenceTimeoutMs: 90_000,
  backoffInitialMs: 1_000,
  backoffMaxMs: 30_000,
  backoffJitter: 0.2,
  replacedWaitMs: 30_000,
  flowHighWaterBytes: 1 * MIB,
  flowLowWaterBytes: 256 * KIB,
} as const;

/** A new connection id: 128 random bits as 32 lowercase hex characters. */
export function newConnectionId(randomBytes: (n: number) => Uint8Array = nacl.randomBytes): string {
  const bytes = randomBytes(16);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += (bytes[i] as number).toString(16).padStart(2, "0");
  return hex;
}
