import { describe, expect, it } from "vitest";

import { DEFAULT_DAEMON_PORT, parseEndpoint } from "./endpoint.js";

describe("parseEndpoint", () => {
  it("parses a bare host with the default port", () => {
    expect(parseEndpoint("localhost")).toMatchObject({
      kind: "direct",
      host: "localhost",
      port: DEFAULT_DAEMON_PORT,
      ssl: false,
    });
  });

  it("parses host:port", () => {
    expect(parseEndpoint("192.168.1.5:6800")).toMatchObject({
      kind: "direct",
      host: "192.168.1.5",
      port: 6800,
      ssl: false,
    });
  });

  it("parses tcp:// with ssl and password params", () => {
    const ep = parseEndpoint("tcp://example.com:7000?ssl=true&password=s3cret");
    expect(ep).toMatchObject({
      kind: "direct",
      host: "example.com",
      port: 7000,
      ssl: true,
      password: "s3cret",
    });
  });

  it("treats wss:// as ssl and ws:// as plaintext", () => {
    expect(parseEndpoint("wss://host:9000").ssl).toBe(true);
    expect(parseEndpoint("ws://host:9000").ssl).toBe(false);
  });

  it("parses a relay endpoint and extracts the relayId + password", () => {
    const ep = parseEndpoint("relay://relay.pi-studio.sh/chan-123?password=pw&ssl=1");
    expect(ep).toMatchObject({
      kind: "relay",
      host: "relay.pi-studio.sh",
      relayId: "chan-123",
      ssl: true,
      password: "pw",
    });
  });

  it("parses an IPv6 literal with a port", () => {
    expect(parseEndpoint("[::1]:6767")).toMatchObject({ host: "::1", port: 6767 });
  });

  it("throws on empty input", () => {
    expect(() => parseEndpoint("   ")).toThrow();
  });
});
