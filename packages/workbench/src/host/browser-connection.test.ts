import { describe, expect, it } from "vitest";
import nacl from "tweetnacl";
import { createBrowserTransport, LITE_REFUSAL, sameOriginDaemonUrl } from "./browser-connection.js";

const DEV_URL = "ws://localhost:5173/daemon-ws";

describe("browser host transport", () => {
  it("refuses a direct target with the Lite message", () => {
    expect(() => createBrowserTransport({ mode: "direct", url: "ws://box:6767" })).toThrow(
      LITE_REFUSAL,
    );
    expect(() => createBrowserTransport({ mode: "direct", url: DEV_URL })).toThrow(LITE_REFUSAL);
  });

  it("builds a relay transport for a relay pairing link", () => {
    const daemonPublicKey = nacl.box.keyPair().publicKey;
    const transport = createBrowserTransport({
      mode: "relay",
      url: "wss://relay.x",
      daemonPublicKey,
    });
    expect(transport).toBeDefined();
  });

  it("dials only the same-origin proxy under the developer switch", () => {
    expect(createBrowserTransport({ mode: "direct", url: DEV_URL }, DEV_URL)).toBeUndefined();
    expect(() => createBrowserTransport({ mode: "direct", url: "ws://box:6767" }, DEV_URL)).toThrow(
      LITE_REFUSAL,
    );
  });

  it("derives the same-origin URL from the page location", () => {
    expect(sameOriginDaemonUrl({ protocol: "http:", host: "localhost:5173" })).toBe(DEV_URL);
    expect(sameOriginDaemonUrl({ protocol: "https:", host: "a.b" })).toBe("wss://a.b/daemon-ws");
  });
});
