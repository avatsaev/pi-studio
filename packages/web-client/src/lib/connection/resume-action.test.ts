import { describe, expect, it } from "vitest";

import type { ConnectionState } from "@av-pi-studio/client";

import { resolveResumeAction } from "./resume-action.js";

describe("resolveResumeAction", () => {
  it("never resurrects an explicit disconnect (managerActive: false), for every status", () => {
    const statuses: ConnectionState[] = ["idle", "connecting", "open", "closing", "closed"];
    for (const status of statuses) {
      for (const probeInFlight of [false, true]) {
        expect(resolveResumeAction({ status, managerActive: false, probeInFlight })).toBe("none");
      }
    }
  });

  it("closed + active -> reconnect-now, regardless of probeInFlight", () => {
    expect(
      resolveResumeAction({ status: "closed", managerActive: true, probeInFlight: false }),
    ).toBe("reconnect-now");
    expect(
      resolveResumeAction({ status: "closed", managerActive: true, probeInFlight: true }),
    ).toBe("reconnect-now");
  });

  it("open + active + no probe in flight -> probe", () => {
    expect(resolveResumeAction({ status: "open", managerActive: true, probeInFlight: false })).toBe(
      "probe",
    );
  });

  it("open + active + probe already in flight -> none (single-probe guard)", () => {
    expect(resolveResumeAction({ status: "open", managerActive: true, probeInFlight: true })).toBe(
      "none",
    );
  });

  it("connecting or closing -> none, regardless of probeInFlight", () => {
    for (const status of ["connecting", "closing"] as const) {
      expect(resolveResumeAction({ status, managerActive: true, probeInFlight: false })).toBe(
        "none",
      );
      expect(resolveResumeAction({ status, managerActive: true, probeInFlight: true })).toBe(
        "none",
      );
    }
  });

  it("idle -> none, regardless of probeInFlight", () => {
    expect(resolveResumeAction({ status: "idle", managerActive: true, probeInFlight: false })).toBe(
      "none",
    );
    expect(resolveResumeAction({ status: "idle", managerActive: true, probeInFlight: true })).toBe(
      "none",
    );
  });
});
