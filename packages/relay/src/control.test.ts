import { describe, expect, it } from "vitest";
import {
  encodeControlFrame,
  isForwardableCloseCode,
  newConnectionId,
  parseFirstFrame,
  parseRelayFrame,
  RELAY_CLOSE,
  RELAY_DEFAULTS,
} from "./control.js";

const S = "a".repeat(32);
const C = "0123456789abcdef".repeat(2);

describe("control frames", () => {
  it("round-trips the socket-opening frames", () => {
    expect(
      parseFirstFrame(encodeControlFrame({ type: "relay_daemon_register", v: 2, sessionId: S })),
    ).toEqual({ kind: "daemon_register", sessionId: S });
    expect(
      parseFirstFrame(encodeControlFrame({ type: "relay_client_connect", v: 2, sessionId: S })),
    ).toEqual({ kind: "client_connect", sessionId: S });
    expect(
      parseFirstFrame(
        encodeControlFrame({ type: "relay_daemon_attach", v: 2, sessionId: S, connectionId: C }),
      ),
    ).toEqual({ kind: "daemon_attach", sessionId: S, connectionId: C });
  });

  it("round-trips the relay frames and ignores unknown ones", () => {
    for (const f of [
      { type: "relay_registered" },
      { type: "relay_dial", connectionId: C },
      { type: "relay_paired", connectionId: C },
    ] as const) {
      expect(parseRelayFrame(encodeControlFrame(f))).toEqual(f);
    }
    expect(parseRelayFrame('{"type":"nope"}')).toBeNull();
    expect(parseRelayFrame("garbage")).toBeNull();
    expect(parseRelayFrame('{"type":"relay_dial","connectionId":"x"}')).toBeNull();
  });

  it("marks bad first frames invalid without throwing", () => {
    const bad = [
      "not json",
      "[]",
      "null",
      "42",
      JSON.stringify({ type: "relay_client_connect", v: 1, sessionId: S }),
      JSON.stringify({ type: "relay_client_connect", sessionId: S }),
      JSON.stringify({ type: "relay_client_connect", v: 2, sessionId: "a".repeat(31) }),
      JSON.stringify({ type: "relay_client_connect", v: 2, sessionId: "A".repeat(32) }),
      JSON.stringify({ type: "relay_daemon_attach", v: 2, sessionId: S, connectionId: "zz" }),
      JSON.stringify({ type: "mystery", v: 2, sessionId: S }),
    ];
    for (const b of bad) expect(parseFirstFrame(b)).toEqual({ kind: "invalid" });
  });

  it("recognises the legacy registration", () => {
    expect(parseFirstFrame('{"type":"relay_register","sessionId":"whatever"}')).toEqual({
      kind: "legacy",
      sessionId: "whatever",
    });
  });
});

describe("RELAY_CLOSE", () => {
  it("matches the spec", () => {
    const table = Object.fromEntries(Object.values(RELAY_CLOSE).map((c) => [c.code, c.reason]));
    expect(table).toEqual({
      4100: "protocol_error",
      4101: "identify_timeout",
      4102: "daemon_offline",
      4103: "daemon_unresponsive",
      4104: "too_many_clients",
      4105: "daemon_outdated",
      4106: "unknown_connection",
      4107: "replaced",
      4108: "ping_timeout",
      4109: "peer_closed",
      4200: "channel_error",
    });
    expect(Object.values(RELAY_CLOSE).some((c) => c.code === 4000)).toBe(false);
  });

  it("isForwardableCloseCode", () => {
    for (const c of [1004, 1005, 1006, 1015, 2999]) expect(isForwardableCloseCode(c)).toBe(false);
    for (const c of [1000, 1003, 1007, 1008, 1014, 3000, 4000, 4999]) {
      expect(isForwardableCloseCode(c)).toBe(true);
    }
    expect(isForwardableCloseCode(5000)).toBe(false);
  });
});

describe("RELAY_DEFAULTS", () => {
  it("equals the spec", () => {
    expect(RELAY_DEFAULTS).toEqual({
      maxClientsPerDaemon: 32,
      maxFrameBytes: 104_857_600,
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
      flowHighWaterBytes: 1_048_576,
      flowLowWaterBytes: 262_144,
    });
  });
});

describe("newConnectionId", () => {
  it("is 32 lowercase hex chars and random", () => {
    const a = newConnectionId();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(newConnectionId()).not.toBe(a);
    expect(newConnectionId(() => new Uint8Array(16).fill(255))).toBe("f".repeat(32));
  });
});
