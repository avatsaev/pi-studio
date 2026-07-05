import { describe, expect, it } from "vitest";

import type { HostRuntimeSnapshot } from "../runtime/host-runtime.js";
import type { HostProfile } from "../runtime/host-profile.js";
import {
  decodePairingOffer,
  extractOfferFragment,
  importPairingOffer,
  pairScanAvailability,
} from "./pairing.js";
import { useThisComputer, welcomeActions, welcomeAutoRedirect } from "./welcome.js";

function snap(serverId: string, createdAtMs: number, status: HostRuntimeSnapshot["status"] = "online"): HostRuntimeSnapshot {
  const profile: HostProfile = {
    id: `p-${serverId}`,
    kind: "direct",
    label: serverId,
    url: `ws://${serverId}`,
    serverId,
    createdAtMs,
  };
  return { profile, status, serverId, features: {}, reconnectAttempt: 0 };
}

function offerFragment(): string {
  const offer = {
    v: 1,
    kind: "relay-offer",
    label: "Laptop",
    relayUrl: "wss://relay.example",
    sessionId: "sess-1",
    daemonPublicKeyB64: "pubkey",
    serverId: "srv-1",
  };
  return `#offer=${encodeURIComponent(JSON.stringify(offer))}`;
}

describe("welcomeActions", () => {
  it("web shows direct + paste-link, direct primary", () => {
    const actions = welcomeActions("web");
    expect(actions.map((a) => a.id)).toEqual(["direct-connection", "paste-pairing-link"]);
    expect(actions[0]?.primary).toBe(true);
  });

  it("native shows scan QR primary + direct + paste-link", () => {
    const actions = welcomeActions("native");
    expect(actions.map((a) => a.id)).toEqual(["scan-qr", "direct-connection", "paste-pairing-link"]);
    expect(actions[0]?.primary).toBe(true);
  });

  it("desktop adds Use this computer as primary", () => {
    const actions = welcomeActions("desktop");
    expect(actions.map((a) => a.id)).toEqual(["use-this-computer", "direct-connection", "paste-pairing-link"]);
    expect(actions[0]).toMatchObject({ id: "use-this-computer", primary: true });
  });
});

describe("welcomeAutoRedirect", () => {
  it("returns null with no online hosts", () => {
    expect(welcomeAutoRedirect([snap("srv-1", 1, "offline")])).toBe(null);
  });

  it("redirects to earliest online host root", () => {
    expect(welcomeAutoRedirect([snap("later", 20), snap("earlier", 10)])).toBe("/h/earlier");
  });
});

describe("useThisComputer", () => {
  it("switches daemon mode to embedded, starts local daemon, and routes to host root", async () => {
    const calls: string[] = [];
    const result = await useThisComputer({
      bridge: {
        setDaemonMode(mode) { calls.push(`mode:${mode}`); },
        async startLocalDaemon() { calls.push("start"); return { serverId: "local-srv" }; },
      },
    });
    expect(calls).toEqual(["mode:embedded", "start"]);
    expect(result).toEqual({ serverId: "local-srv", route: "/h/local-srv" });
  });
});

describe("pairing offer parsing", () => {
  it("extracts #offer fragment from URL", () => {
    expect(extractOfferFragment(`https://app.example/${offerFragment()}`)).toBeTruthy();
  });

  it("decodes URL-encoded JSON offer", () => {
    const result = decodePairingOffer(`https://app.example/${offerFragment()}`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.offer.relayUrl).toBe("wss://relay.example");
      expect(result.offer.daemonPublicKeyB64).toBe("pubkey");
    }
  });

  it("returns ok:false for missing offer", () => {
    const result = decodePairingOffer("https://app.example/");
    expect(result.ok).toBe(false);
  });

  it("returns ok:false for invalid schema", () => {
    const result = decodePairingOffer(`#offer=${encodeURIComponent(JSON.stringify({ relayUrl: "x" }))}`);
    expect(result.ok).toBe(false);
  });
});

describe("importPairingOffer", () => {
  it("probes, upserts, and routes to host root for onboarding source", async () => {
    const saved: HostProfile[] = [];
    const result = await importPairingOffer({
      urlOrFragment: offerFragment(),
      source: "onboarding",
      nowMs: 100,
      probe: async () => ({ serverId: "srv-probed", label: "Probed" }),
      upsert: (profile) => { saved.push(profile); },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.route).toBe("/h/srv-probed");
      expect(result.profile.kind).toBe("relay");
      expect(result.profile.label).toBe("Probed");
    }
    expect(saved[0]?.serverId).toBe("srv-probed");
  });

  it("routes to host settings connections for settings source", async () => {
    const result = await importPairingOffer({
      urlOrFragment: offerFragment(),
      source: "settings",
      probe: async () => ({ serverId: "srv-1" }),
      upsert: () => undefined,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.route).toBe("/settings/hosts/srv-1/connections");
  });

  it("returns failure when probe fails", async () => {
    const result = await importPairingOffer({
      urlOrFragment: offerFragment(),
      source: "onboarding",
      probe: async () => { throw new Error("probe failed"); },
      upsert: () => undefined,
    });
    expect(result.ok).toBe(false);
  });
});

describe("pairScanAvailability", () => {
  it("native uses camera; web/desktop unsupported", () => {
    expect(pairScanAvailability("native")).toBe("camera");
    expect(pairScanAvailability("web")).toBe("unsupported");
    expect(pairScanAvailability("desktop")).toBe("unsupported");
  });
});
