import { describe, expect, it } from "vitest";
import nacl from "tweetnacl";
import { connectionTargetKey, isConnectedToDaemon } from "./connection-store.js";

function relayOfferUrl(publicKey: Uint8Array): string {
  const publicKeyB64 = Buffer.from(publicKey).toString("base64");
  const fragment = new URLSearchParams({
    offer: publicKeyB64,
    relay: "relay.example.test",
    relayTls: "1",
  });
  return `https://app.pi-studio.sh/#${fragment.toString()}`;
}

describe("connection target identity", () => {
  it("treats equivalent direct-address forms as the same daemon", () => {
    expect(connectionTargetKey("http://daemon.local:6767")).toBe(
      connectionTargetKey("ws://daemon.local:6767"),
    );
  });

  it("distinguishes daemons that share one relay endpoint", () => {
    const first = relayOfferUrl(nacl.box.keyPair().publicKey);
    const second = relayOfferUrl(nacl.box.keyPair().publicKey);

    expect(connectionTargetKey(first)).not.toBe(connectionTargetKey(second));
  });

  it("only reports a matching target as connected while the socket is open", () => {
    const input = "daemon.local:6767";
    const target = connectionTargetKey(input);

    expect(isConnectedToDaemon("connecting", target, input)).toBe(false);
    expect(isConnectedToDaemon("open", target, input)).toBe(true);
    expect(isConnectedToDaemon("open", target, "other.local:6767")).toBe(false);
  });
});
