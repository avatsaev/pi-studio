import { describe, expect, it } from "vitest";

import { prepareBinaryDaemon, preparePiRuntime } from "./binary-runtime.js";

/**
 * The compiled binary's start-up steps are no-ops on Node: Pi's Bun runtime setup renames the
 * process and silences its warnings, which Node must never get (the binary itself is proven by the
 * live check, `packages/server/docs/binary-live-results.md`).
 */
describe("binary runtime preparation on Node", () => {
  it("preparePiRuntime and prepareBinaryDaemon leave the process alone", async () => {
    const title = process.title;
    const emitWarning = process.emitWarning;

    await preparePiRuntime();
    await prepareBinaryDaemon();

    expect(process.title).toBe(title);
    expect(process.emitWarning).toBe(emitWarning);
  });
});
