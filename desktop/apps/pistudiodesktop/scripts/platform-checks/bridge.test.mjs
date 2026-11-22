import { describe, expect, it } from "vitest";

import { barShowsConnected, cmdkeyTargets, describeConnection, keychainAccount, keychainScope, keychainSkipReason, logTail, openTransport, parseSecurityItem, stopAndContinue, waitForOpenTransport, wakeCount } from "./bridge.mjs";

const transport = (extra = {}) => ({ entryId: "local", state: "open", framesIn: 3, framesOut: 2, bytesIn: 900, bytesOut: 40, peakHeldIn: 100, peakHeldOut: 10, ...extra });
const view = (transports, extra = {}) => ({ connection: { secretStore: "file", transports, lastError: null, resumeSignals: { wake: 0, network: 0 }, ...extra } });

describe("keychainScope", () => {
  it("is FNV-1a 64 of the path's bytes, as crates/secrets pins it", () => {
    expect(keychainScope("")).toBe("cbf29ce484222325");
    expect(keychainScope("a")).toBe("af63dc4c8601ec8c");
    // The standard test vector for FNV-1a 64.
    expect(keychainScope("foobar")).toBe("85944171f73967e8");
  });

  it("is sixteen lower-case hex digits, also for a path with non-ASCII letters", () => {
    expect(keychainScope("/tmp/pi/config")).toMatch(/^[0-9a-f]{16}$/);
    expect(keychainScope("C:\\Users\\runner\\é")).toMatch(/^[0-9a-f]{16}$/);
    expect(keychainScope("/tmp/pi/config")).not.toBe(keychainScope("/tmp/pi/config2"));
  });

  it("names an account <scope>/<entry>/<kind>", () => {
    expect(keychainAccount("abc", "id1")).toBe("abc/id1/password");
    expect(keychainAccount("abc", "id1", "pairingLink")).toBe("abc/id1/pairingLink");
  });
});

describe("openTransport", () => {
  it("accepts one open transport for the entry with frames in", () => {
    expect(openTransport(view([transport()]), "local").ok).toBe(true);
  });

  it.each([
    ["none", view([]), "0 transports"],
    ["two", view([transport(), transport({ entryId: "b" })]), "2 transports"],
    ["another entry", view([transport({ entryId: "b" })]), "another entry"],
    ["connecting", view([transport({ state: "connecting" })]), "is connecting"],
    ["closing", view([transport({ state: "closing" })]), "is closing"],
    ["no frames", view([transport({ framesIn: 0 })]), "framesIn is 0"],
    ["no connection", {}, "no `connection`"],
  ])("refuses %s and says why", (_name, input, why) => {
    const result = openTransport(input, "local");
    expect(result.ok).toBe(false);
    expect(result.detail).toContain(why);
  });

  it("holds no address or secret in what it says", () => {
    const text = describeConnection(view([transport()], { lastError: { code: "upstream_lost", atMs: 1 } }));
    expect(text).toContain("local:open in=3/900B");
    expect(text).toContain("lastError upstream_lost");
    expect(text).not.toMatch(/ws:|127\.0\.0\.1/);
  });
});

describe("wakeCount", () => {
  it("reads the count, or null", () => {
    expect(wakeCount(view([], { resumeSignals: { wake: 2, network: 0 } }))).toBe(2);
    expect(wakeCount({})).toBeNull();
    expect(wakeCount(view([], { resumeSignals: {} }))).toBeNull();
  });
});

/** A control double whose `ui.inspect` answers come from `answers` (the last one repeats). */
function fakeControl(answers) {
  let at = 0;
  return { calls: () => at, inspect: async () => answers[Math.min(at++, answers.length - 1)] };
}

describe("waitForOpenTransport", () => {
  it("returns the connection once the transport opens", async () => {
    const control = fakeControl([view([transport({ state: "connecting", framesIn: 0 })]), view([transport()])]);
    const connection = await waitForOpenTransport(control, { entryId: "local", timeoutMs: 5000 });
    expect(connection.transports[0].state).toBe("open");
    expect(control.calls()).toBe(2);
  });

  it("says what it last saw when it times out", async () => {
    const control = fakeControl([view([], { lastError: { code: "page_timeout", atMs: 1 } })]);
    await expect(waitForOpenTransport(control, { entryId: "local", timeoutMs: 700 })).rejects.toThrow(/0 transports.*lastError page_timeout/);
  });
});

describe("stopAndContinue", () => {
  it("stops, holds, continues, and reports the wake before and after", async () => {
    const order = [];
    const control = fakeControl([view([], { resumeSignals: { wake: 4, network: 0 } }), view([], { resumeSignals: { wake: 4, network: 0 } }), view([], { resumeSignals: { wake: 5, network: 0 } })]);
    const result = await stopAndContinue({ control, stop: async () => order.push("stop"), resume: async () => order.push("resume"), holdMs: 30, waitMs: 5000 });
    expect(order).toEqual(["stop", "resume"]);
    expect(result).toMatchObject({ before: 4, after: 5 });
    expect(result.heldMs).toBeGreaterThanOrEqual(25);
  });

  it("fails when the count does not rise, and still continued the app", async () => {
    let resumed = false;
    const control = fakeControl([view([])]);
    await expect(stopAndContinue({ control, stop: async () => {}, resume: async () => { resumed = true; }, holdMs: 10, waitMs: 600 })).rejects.toThrow(/wake was 0 and is 0/);
    expect(resumed).toBe(true);
  });

  it("reports a resume that failed", async () => {
    let resumed = false;
    const control = fakeControl([view([])]);
    await expect(
      stopAndContinue({
        control,
        stop: async () => {},
        resume: async () => {
          resumed = true;
          throw new Error("resume failed");
        },
        holdMs: 10,
      }),
    ).rejects.toThrow("resume failed");
    expect(resumed).toBe(true);
  });

  it("continues the app when the stop threw half way, and reports the stop's error", async () => {
    let resumed = false;
    await expect(
      stopAndContinue({
        control: fakeControl([view([])]),
        stop: async () => {
          throw new Error("stop failed");
        },
        resume: async () => {
          resumed = true;
        },
        holdMs: 10,
      }),
    ).rejects.toThrow("stop failed");
    expect(resumed).toBe(true);
  });

  it("refuses a view without the signal", async () => {
    await expect(stopAndContinue({ control: fakeControl([{}]), stop: async () => {}, resume: async () => {}, holdMs: 1 })).rejects.toThrow("no connection.resumeSignals.wake");
  });
});

const SECURITY = `keychain: "/Users/runner/Library/Keychains/login.keychain-db"
version: 512
class: "genp"
attributes:
    0x00000007 <blob>="com.avatsaev.pi-studio"
    0x00000008 <blob>=<NULL>
    "acct"<blob>="0123456789abcdef/3f2b8a40-1111-4222-8333-444455557777/password"
    "cdat"<timedate>=0x32303236313132323133303030305A00  "20261122130000Z\\000"
    "mdat"<timedate>=0x32303236313132323133303130305A00  "20261122130100Z\\000"
    "svce"<blob>="com.avatsaev.pi-studio"
`;

describe("parseSecurityItem", () => {
  it("reads the service, the account and the dates", () => {
    expect(parseSecurityItem(SECURITY)).toEqual({
      service: "com.avatsaev.pi-studio",
      account: "0123456789abcdef/3f2b8a40-1111-4222-8333-444455557777/password",
      created: "20261122130000Z",
      modified: "20261122130100Z",
    });
  });

  it("answers nulls for text that is not an item", () => {
    expect(parseSecurityItem("security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.")).toEqual({ service: null, account: null, created: null, modified: null });
  });
});

const CMDKEY = `
Currently stored credentials:

    Target: LegacyGeneric:target=MicrosoftAccount:user=x
    Type: Generic
    User: x
    Saved for this logon only

    Target: LegacyGeneric:target=0123456789abcdef/3F2B8A40-1111-4222-8333-444455557777/password.com.avatsaev.pi-studio
    Type: Generic
    User: 0123456789abcdef/3f2b8a40-1111-4222-8333-444455557777/password
    Persistence: Local computer
`;

describe("cmdkeyTargets", () => {
  it("lists the targets that name the entry, whatever the case", () => {
    expect(cmdkeyTargets(CMDKEY.replace(/\n/g, "\r\n"), "3f2b8a40-1111-4222-8333-444455557777")).toEqual([
      "LegacyGeneric:target=0123456789abcdef/3F2B8A40-1111-4222-8333-444455557777/password.com.avatsaev.pi-studio",
    ]);
  });

  it("is empty when no target names the entry", () => {
    expect(cmdkeyTargets(CMDKEY, "ffffffff-1111-4222-8333-444455557777")).toEqual([]);
    expect(cmdkeyTargets("", "x")).toEqual([]);
  });
});

describe("keychainSkipReason", () => {
  it("takes a call that never answered for a prompt", () => {
    expect(keychainSkipReason(new Error("engine.execute: no reply in 30000 ms"))).toContain("waiting for a person");
  });

  it("takes the keychain's refusals for a runner that cannot do it", () => {
    expect(keychainSkipReason(new Error("engine.execute: secret_store_failed"))).toContain("refused");
    expect(keychainSkipReason(new Error("engine.execute: secret_unavailable"))).toContain("refused");
  });

  it("leaves any other error to fail the check", () => {
    expect(keychainSkipReason(new Error("engine.execute: invalid_address"))).toBeNull();
    expect(keychainSkipReason(new Error("the control socket closed"))).toBeNull();
  });
});

describe("logTail", () => {
  it("keeps the last lines on one line", () => {
    expect(logTail("a\nb\nc\nd\ne\n", 2)).toBe("d / e");
    expect(logTail("only")).toBe("only");
  });
});

describe("barShowsConnected", () => {
  it("reads the switcher's tooltip, with or without a host", () => {
    expect(barShowsConnected(["", "Stand-in · connected"], "Stand-in")).toBe(true);
    expect(barShowsConnected(["Stand-in · 127.0.0.1:5000 · connected"], "Stand-in")).toBe(true);
  });

  it("refuses another state, another entry and no button", () => {
    const titles = ["Stand-in · connecting…", "Stand-in · disconnected", "Stand-in · connection refused", "Stand-in · disconnecting…", "Other · connected", "Stand-in"];
    // Each title alone, so a failure shows which one.
    expect(titles.filter((title) => barShowsConnected([title], "Stand-in"))).toEqual([]);
    expect(barShowsConnected([], "Stand-in")).toBe(false);
  });
});
