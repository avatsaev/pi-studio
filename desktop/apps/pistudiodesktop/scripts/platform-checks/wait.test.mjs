import { describe, expect, it } from "vitest";

import { Abort, waitFor } from "./wait.mjs";

describe("waitFor", () => {
  it("returns the first truthy value", async () => {
    let calls = 0;
    await expect(waitFor("x", () => (++calls >= 3 ? "done" : null), { timeoutMs: 1000, intervalMs: 1 })).resolves.toBe("done");
  });

  it("keeps trying after an error and names the last one on timeout", async () => {
    await expect(waitFor("the thing", () => Promise.reject(new Error("not yet")), { timeoutMs: 30, intervalMs: 5 })).rejects.toThrow(
      "timed out after 30 ms waiting for the thing (last error: not yet)",
    );
  });

  it("stops at once on Abort", async () => {
    let calls = 0;
    await expect(
      waitFor("x", () => {
        calls += 1;
        throw new Abort("cannot happen");
      }, { timeoutMs: 5000, intervalMs: 1 }),
    ).rejects.toThrow("cannot happen");
    expect(calls).toBe(1);
  });
});
