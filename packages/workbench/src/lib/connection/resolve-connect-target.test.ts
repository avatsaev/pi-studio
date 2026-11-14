import { describe, expect, it } from "vitest";
import nacl from "tweetnacl";
import { resolveConnectTarget } from "./resolve-connect-target.js";

function fakeOfferUrl(params: Record<string, string>): string {
  const keypair = nacl.box.keyPair();
  const publicKeyB64 = Buffer.from(keypair.publicKey).toString("base64");
  const query = new URLSearchParams({ offer: publicKeyB64, ...params });
  return `https://app.pi-studio.sh/#${query.toString()}`;
}

describe("resolveConnectTarget", () => {
  it("treats a plain host/port as a direct connection, normalized to ws://", () => {
    expect(resolveConnectTarget("127.0.0.1:6767")).toEqual({
      mode: "direct",
      url: "ws://127.0.0.1:6767",
    });
  });

  it("treats a ws://, wss://, http://, https:// address as direct, normalized", () => {
    expect(resolveConnectTarget("http://daemon.local:6767")).toEqual({
      mode: "direct",
      url: "ws://daemon.local:6767",
    });
    expect(resolveConnectTarget("https://daemon.local:6767")).toEqual({
      mode: "direct",
      url: "wss://daemon.local:6767",
    });
  });

  it("routes a relay-carrying pairing link to relay mode with the daemon's public key", () => {
    const url = fakeOfferUrl({ relay: "relay.molagent.ai", relayTls: "1" });
    const target = resolveConnectTarget(url);
    expect(target.mode).toBe("relay");
    if (target.mode !== "relay") throw new Error("expected relay mode");
    expect(target.url).toBe("wss://relay.molagent.ai");
    expect(target.daemonPublicKey).toBeInstanceOf(Uint8Array);
    expect(target.daemonPublicKey.length).toBe(32);
  });

  it("routes a non-TLS relay link to ws://", () => {
    const url = fakeOfferUrl({ relay: "127.0.0.1:7000", relayTls: "0" });
    const target = resolveConnectTarget(url);
    expect(target.mode).toBe("relay");
    if (target.mode !== "relay") throw new Error("expected relay mode");
    expect(target.url).toBe("ws://127.0.0.1:7000");
  });

  it("routes a host-carrying pairing link to direct mode at that host", () => {
    const url = fakeOfferUrl({ host: "192.168.1.50:6767" });
    expect(resolveConnectTarget(url)).toEqual({ mode: "direct", url: "ws://192.168.1.50:6767" });
  });

  it("prefers relay over host when a pairing link somehow carries both", () => {
    const url = fakeOfferUrl({ relay: "relay.molagent.ai", relayTls: "1", host: "1.2.3.4:6767" });
    const target = resolveConnectTarget(url);
    expect(target.mode).toBe("relay");
  });

  it("falls back to direct/normalized when the input isn't a pairing link at all", () => {
    expect(resolveConnectTarget("not a url, just typed text")).toEqual({
      mode: "direct",
      url: "ws://not a url, just typed text",
    });
  });
});
