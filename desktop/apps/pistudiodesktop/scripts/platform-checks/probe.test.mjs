import { describe, expect, it } from "vitest";

import { interpretProbe, PROBE_HTML } from "./probe.mjs";

const isolated = {
  scriptRan: true,
  origin: "null",
  href: "pi-preview://localhost/x",
  parentDocument: "blocked: SecurityError ...",
  ownTauriInternals: "ALLOWED: undefined",
  ipcFetch: "blocked: TypeError Load failed",
  ipcHttpFetch: "blocked: TypeError Load failed",
  popup: "ALLOWED: null window",
  localStorage: "blocked: SecurityError The operation is insecure.",
  remoteFetch: "blocked: TypeError Load failed",
  remoteImage: "blocked: not loaded",
};

describe("interpretProbe", () => {
  it("is 'origin works' when scripts ran and every attempt failed", () => {
    expect(interpretProbe(isolated)).toMatchObject({ verdict: "origin works", leaks: [] });
  });

  it("is 'scripts blocked' when the frame posted nothing", () => {
    expect(interpretProbe(null)).toMatchObject({ verdict: "scripts blocked", rows: [] });
    expect(interpretProbe({ scriptRan: false })).toMatchObject({ verdict: "scripts blocked" });
  });

  it("names each attempt that got through", () => {
    const leaky = { ...isolated, parentDocument: "ALLOWED: Pi Studio", popup: "ALLOWED: opened", ownTauriInternals: "ALLOWED: object" };
    expect(interpretProbe(leaky)).toMatchObject({ verdict: "scripts run but isolation broken", leaks: ["parentDocument", "ownTauriInternals", "popup"] });
  });

  it("counts a missing row as a leak: no finding is not a pass", () => {
    const { localStorage: _dropped, ...rest } = isolated;
    expect(interpretProbe(rest).leaks).toEqual(["localStorage"]);
  });
});

describe("PROBE_HTML", () => {
  it("is the spike's page: a meta policy, a script and a message to the parent", () => {
    expect(PROBE_HTML).toContain("Content-Security-Policy");
    expect(PROBE_HTML).toContain("parent.postMessage({ probe: r }");
  });
});
