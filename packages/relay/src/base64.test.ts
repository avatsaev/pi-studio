import { describe, expect, it } from "vitest";

import { decodeBase64, encodeBase64 } from "./base64.js";

describe("base64 codec", () => {
  it("round-trips arbitrary byte lengths (0, 1, 2, 3 mod-3 remainders)", () => {
    for (const len of [0, 1, 2, 3, 4, 5, 24, 100]) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = (i * 37 + 11) % 256;
      expect(Array.from(decodeBase64(encodeBase64(bytes)))).toEqual(Array.from(bytes));
    }
  });

  it("matches Node's Buffer base64 encoding for a known vector", () => {
    const bytes = new TextEncoder().encode("hello, relay!");
    expect(encodeBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("rejects invalid characters", () => {
    expect(() => decodeBase64("not valid base64!!")).toThrow();
  });
});
