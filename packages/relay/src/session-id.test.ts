import { describe, expect, it } from "vitest";
import nacl from "tweetnacl";

import { deriveRelaySessionId } from "./session-id.js";

describe("deriveRelaySessionId", () => {
  it("is deterministic for the same public key", () => {
    const { publicKey } = nacl.box.keyPair();
    expect(deriveRelaySessionId(publicKey)).toBe(deriveRelaySessionId(publicKey));
  });

  it("differs across distinct public keys", () => {
    const a = nacl.box.keyPair().publicKey;
    const b = nacl.box.keyPair().publicKey;
    expect(deriveRelaySessionId(a)).not.toBe(deriveRelaySessionId(b));
  });

  it("is a 32-char lowercase hex string", () => {
    const { publicKey } = nacl.box.keyPair();
    const id = deriveRelaySessionId(publicKey);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });
});
