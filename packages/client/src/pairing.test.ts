import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePairingUrl } from "./pairing.js";

describe("parsePairingUrl", () => {
  it("ignores a coexisting agent deep-link key", () => {
    const base = "https://x/#offer=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA%3D&host=h%3A1";
    const offer = parsePairingUrl(base);
    expect(offer).not.toBeNull();
    expect(parsePairingUrl(`${base}&agent=abc`)).toEqual(offer);
    expect(parsePairingUrl(`${base.replace("#", "#agent=abc&")}`)).toEqual(offer);
  });
});

interface PairingVector {
  name: string;
  input: string;
  sdk: {
    keyBytes: number;
    host: string | null;
    relay: { endpoint: string; useTls: boolean } | null;
  } | null;
}

/** The cases the desktop's Rust parser (`model::pairing`) reads too. */
const vectors = JSON.parse(
  readFileSync(new URL("./pairing-link.vectors.json", import.meta.url), "utf8"),
) as PairingVector[];

describe("pairing-link.vectors.json", () => {
  it("is not truncated", () => {
    expect(vectors.length).toBeGreaterThanOrEqual(15);
  });

  for (const v of vectors) {
    it(v.name, () => {
      const offer = parsePairingUrl(v.input);
      if (v.sdk === null) {
        expect(offer).toBeNull();
        return;
      }
      expect(offer).not.toBeNull();
      expect(offer?.publicKey.length).toBe(v.sdk.keyBytes);
      expect(offer?.host ?? null).toBe(v.sdk.host);
      expect(offer?.relay ?? null).toEqual(v.sdk.relay);
    });
  }
});
