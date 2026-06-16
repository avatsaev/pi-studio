import { describe, expect, it } from "vitest";

import {
  clientTypeSchema,
  helloSchema,
  pongSchema,
  serverInfoPayloadSchema,
  sessionEnvelopeSchema,
  statusSchema,
  topLevelEnvelopeSchema,
} from "./messages.js";

describe("hello handshake", () => {
  it("accepts all four clientType values", () => {
    for (const clientType of ["mobile", "browser", "cli", "mcp"] as const) {
      const result = helloSchema.safeParse({
        type: "hello",
        clientId: "c1",
        clientType,
        protocolVersion: 1,
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects an unknown clientType", () => {
    expect(clientTypeSchema.safeParse("desktop").success).toBe(false);
    expect(
      helloSchema.safeParse({
        type: "hello",
        clientId: "c1",
        clientType: "robot",
        protocolVersion: 1,
      }).success,
    ).toBe(false);
  });

  it("accepts an optional capabilities map", () => {
    const result = helloSchema.safeParse({
      type: "hello",
      clientId: "c1",
      clientType: "cli",
      protocolVersion: 1,
      appVersion: "0.1.0",
      capabilities: { custom_mode_icons: true },
    });
    expect(result.success).toBe(true);
  });
});

describe("server_info / status", () => {
  const validPayload = {
    status: "server_info",
    serverId: "srv_abc",
    capabilities: {},
    features: { providersSnapshot: true },
  };

  it("requires serverId, capabilities, and features", () => {
    expect(serverInfoPayloadSchema.safeParse(validPayload).success).toBe(true);
    for (const missing of ["serverId", "capabilities", "features"]) {
      const clone: Record<string, unknown> = { ...validPayload };
      delete clone[missing];
      expect(serverInfoPayloadSchema.safeParse(clone).success).toBe(false);
    }
  });

  it("wraps server_info in a status envelope", () => {
    expect(statusSchema.safeParse({ type: "status", payload: validPayload }).success).toBe(true);
  });
});

describe("pong liveness", () => {
  it("includes requestId and server timestamps", () => {
    const result = pongSchema.safeParse({
      type: "pong",
      requestId: "r1",
      clientSentAt: 1000,
      serverReceivedAt: 1001,
      serverSentAt: 1002,
    });
    expect(result.success).toBe(true);
  });

  it("requires server timestamps", () => {
    expect(pongSchema.safeParse({ type: "pong", requestId: "r1" }).success).toBe(false);
  });
});

describe("top-level envelope union", () => {
  it("discriminates on type", () => {
    expect(
      topLevelEnvelopeSchema.safeParse({
        type: "hello",
        clientId: "c",
        clientType: "cli",
        protocolVersion: 1,
      }).success,
    ).toBe(true);
    expect(
      topLevelEnvelopeSchema.safeParse({
        type: "session",
        message: { type: "create_agent_request", requestId: "r" },
      }).success,
    ).toBe(true);
  });

  it("rejects unknown top-level envelope types", () => {
    expect(topLevelEnvelopeSchema.safeParse({ type: "totally_unknown" }).success).toBe(false);
  });

  it("session envelope wraps a typed message", () => {
    expect(
      sessionEnvelopeSchema.safeParse({ type: "session", message: { type: "agent_update" } })
        .success,
    ).toBe(true);
    expect(
      sessionEnvelopeSchema.safeParse({ type: "session", message: { no_type: true } }).success,
    ).toBe(false);
  });
});
