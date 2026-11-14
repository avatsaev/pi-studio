import { describe, expect, it } from "vitest";
import { normalizeDaemonUrl } from "./normalize-url.js";

describe("normalizeDaemonUrl", () => {
  it("maps http:// to ws:// and https:// to wss://", () => {
    expect(normalizeDaemonUrl("http://127.0.0.1:6767")).toBe("ws://127.0.0.1:6767");
    expect(normalizeDaemonUrl("https://daemon.example.com:6767")).toBe(
      "wss://daemon.example.com:6767",
    );
  });

  it("passes ws:// and wss:// through unchanged", () => {
    expect(normalizeDaemonUrl("ws://127.0.0.1:6767")).toBe("ws://127.0.0.1:6767");
    expect(normalizeDaemonUrl("wss://daemon.example.com:6767")).toBe(
      "wss://daemon.example.com:6767",
    );
  });

  it("assumes ws:// for a bare host or host:port", () => {
    expect(normalizeDaemonUrl("127.0.0.1:6767")).toBe("ws://127.0.0.1:6767");
    expect(normalizeDaemonUrl("workstation.local")).toBe("ws://workstation.local");
  });

  it("trims surrounding whitespace and trailing slashes", () => {
    expect(normalizeDaemonUrl("  http://host:6767/  ")).toBe("ws://host:6767");
    expect(normalizeDaemonUrl("host:6767/")).toBe("ws://host:6767");
  });

  it("is case-insensitive on the scheme", () => {
    expect(normalizeDaemonUrl("HTTP://host:6767")).toBe("ws://host:6767");
    expect(normalizeDaemonUrl("HTTPS://host:6767")).toBe("wss://host:6767");
  });

  it("leaves an empty input empty", () => {
    expect(normalizeDaemonUrl("")).toBe("");
    expect(normalizeDaemonUrl("   ")).toBe("");
  });

  it("leaves an unknown scheme untouched for the transport to reject", () => {
    expect(normalizeDaemonUrl("ftp://host:6767")).toBe("ftp://host:6767");
  });
});
