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
    // The send's request is answered at acceptance, at which point the session becomes `running`
    // (`composer-send.ts`): a Steer is offered and only a steer in flight locks it. A turn blocked
    // on a pending extension dialog stays `running` for as long as it takes.
    expect(isComposerBusy(true, true, false)).toBe(false);
    expect(isComposerBusy(true, false, false)).toBe(false);
    expect(isComposerBusy(true, true, true)).toBe(true);
    expect(isComposerBusy(true, false, true)).toBe(true);
  });
});
