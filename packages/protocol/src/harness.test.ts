import { describe, expect, it } from "vitest";

import { PROTOCOL_PACKAGE } from "./index.js";

// Trivial test proving the Vitest harness runs across the workspace.
describe("protocol harness", () => {
  it("exposes the package marker", () => {
    expect(PROTOCOL_PACKAGE).toBe("@av-pi-studio/protocol");
  });
});
