import { describe, expect, it } from "vitest";

import type { ConnectionState } from "@av-pi-studio/client";

import { resolveResumeAction } from "./resume-action.js";

describe("resolveResumeAction", () => {
  it("never resurrects an explicit disconnect (managerActive: false), for every status", () => {
    const statuses: ConnectionState[] = ["idle", "connecting", "open", "closing", "closed"];
    for (const status of statuses) {
      for (const managerStarted of [false, true]) {
        for (const probeInFlight of [false, true]) {
          expect(
            resolveResumeAction({ status, managerActive: false, managerStarted, probeInFlight }),
          ).toBe("none");
        }
      }
    }
  });

  it("closed + started -> reconnect-now, regardless of probeInFlight", () => {
    for (const probeInFlight of [false, true]) {
      expect(
        resolveResumeAction({
          status: "closed",
          managerActive: true,
          managerStarted: true,
          probeInFlight,
        }),
      ).toBe("reconnect-now");
    }
  });

  it("closed + never started (the first connect never opened) -> connect-again", () => {
    for (const probeInFlight of [false, true]) {
      expect(
        resolveResumeAction({
          status: "closed",
          managerActive: true,
          managerStarted: false,
          probeInFlight,
        }),
      ).toBe("connect-again");
    }
  });

  it("open + active + no probe in flight -> probe", () => {
    expect(
      resolveResumeAction({
        status: "open",
        managerActive: true,
        managerStarted: true,
        probeInFlight: false,
      }),
    ).toBe("probe");
  });

  it("open + active + probe already in flight -> none (single-probe guard)", () => {
    expect(
      resolveResumeAction({
        status: "open",
        managerActive: true,
        managerStarted: true,
        probeInFlight: true,
      }),
    ).toBe("none");
  });

  it("connecting, closing or idle -> none, whether or not the manager started", () => {
    for (const status of ["connecting", "closing", "idle"] as const) {
      for (const managerStarted of [false, true]) {
        for (const probeInFlight of [false, true]) {
          expect(
            resolveResumeAction({ status, managerActive: true, managerStarted, probeInFlight }),
          ).toBe("none");
        }
      }
    }
  });
});
