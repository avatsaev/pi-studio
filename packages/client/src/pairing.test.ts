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
