import { describe, expect, it } from "vitest";
import { DAEMON_UPDATE_HINT, outdatedDaemonNotice, parseVersion } from "./outdated-daemon.js";

describe("parseVersion", () => {
  it("reads major.minor.patch numerically", () => {
    expect(parseVersion("0.0.119")).toEqual([0, 0, 119]);
    expect(parseVersion(" v1.20.3 ")).toEqual([1, 20, 3]);
  });

  it("ignores a pre-release or build suffix", () => {
    expect(parseVersion("0.0.119-beta.1")).toEqual([0, 0, 119]);
    expect(parseVersion("1.2.3+sha.4")).toEqual([1, 2, 3]);
  });

  it("rejects anything else", () => {
    for (const bad of ["", "dev", "1.2", "1.2.x", "1.2.3.4", "a.b.c"]) {
      expect(parseVersion(bad)).toBeNull();
    }
  });
});

describe("outdatedDaemonNotice", () => {
  const MIN = "0.0.119";

  it("names both versions and how to update for an older daemon", () => {
    expect(outdatedDaemonNotice(MIN, "0.0.117")).toBe(
      `This daemon is 0.0.117; this app expects 0.0.119 or newer. ${DAEMON_UPDATE_HINT}`,
    );
    expect(DAEMON_UPDATE_HINT).toContain("npm i -g @av-pi-studio/cli");
  });

  it("gives a notice for older daemons, comparing numerically per part", () => {
    expect(outdatedDaemonNotice(MIN, "0.0.118")).not.toBeNull();
    // As text "0.0.9" > "0.0.119"; as a version it is older.
    expect(outdatedDaemonNotice(MIN, "0.0.9")).toContain("This daemon is 0.0.9;");
  });

  it("gives none for the minimum or newer", () => {
    for (const version of ["0.0.119", "0.0.120", "0.1.0", "1.0.0"]) {
      expect(outdatedDaemonNotice(MIN, version)).toBeNull();
    }
  });

  it("says the daemon did not report a version when it is absent or unparsable", () => {
    const expected = `This daemon did not report a version; this app expects 0.0.119 or newer. ${DAEMON_UPDATE_HINT}`;
    expect(outdatedDaemonNotice(MIN, undefined)).toBe(expected);
    expect(outdatedDaemonNotice(MIN, "unknown")).toBe(expected);
    expect(outdatedDaemonNotice(MIN, "")).toBe(expected);
  });

  it("gives none without a usable minimum", () => {
    expect(outdatedDaemonNotice(undefined, "0.0.1")).toBeNull();
    expect(outdatedDaemonNotice(undefined, undefined)).toBeNull();
    expect(outdatedDaemonNotice("latest", "0.0.1")).toBeNull();
  });
});
