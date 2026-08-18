import { describe, expect, it, vi } from "vitest";
import { randomId } from "./random-id.js";

describe("randomId", () => {
  it("produces RFC 4122 v4 UUID-shaped ids when crypto.getRandomValues is available", () => {
    const id = randomId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("never repeats across many calls", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => randomId()));
    expect(ids.size).toBe(1000);
  });

  it("falls back to a timestamp+random id when crypto is unavailable (insecure context)", () => {
    const original = globalThis.crypto;
    // Simulates a plain-http/non-secure-context environment, where `crypto.getRandomValues` (and
    // `crypto.randomUUID`) are absent — the exact condition that broke `crypto.randomUUID()`
    // call sites when `pi-studio web` is reached over a LAN IP instead of localhost.
    // @ts-expect-error -- deliberately deleting a global for the test
    delete globalThis.crypto;
    try {
      const id = randomId();
      expect(id).toMatch(/^id-[0-9a-z]+-[0-9a-z]+$/);
    } finally {
      globalThis.crypto = original;
    }
  });

  it("does not call crypto.randomUUID directly", () => {
    const spy = vi.spyOn(globalThis.crypto, "randomUUID");
    randomId();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
