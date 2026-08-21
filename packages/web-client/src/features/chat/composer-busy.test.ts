import { describe, expect, it } from "vitest";

import { isComposerBusy } from "./composer-busy.js";

describe("isComposerBusy", () => {
  it("before a turn is running, tracks `sending` alone", () => {
    expect(isComposerBusy(false, true, false)).toBe(true);
    expect(isComposerBusy(false, false, false)).toBe(false);
    // `steering` is irrelevant while not running — nothing to steer yet.
    expect(isComposerBusy(false, false, true)).toBe(false);
  });

  it("once running, tracks `steering` alone — `sending` can no longer lock or unlock the composer", () => {
    // A dialog-blocked turn: `sending` may still be true (the original send() RPC has not
    // settled) or may have already flipped false (a client-side RpcTimeoutError rejected it,
    // sprint-068/task-002) — the composer's busy state must not depend on either.
    expect(isComposerBusy(true, true, false)).toBe(false);
    expect(isComposerBusy(true, false, false)).toBe(false);
    expect(isComposerBusy(true, true, true)).toBe(true);
    expect(isComposerBusy(true, false, true)).toBe(true);
  });
});
