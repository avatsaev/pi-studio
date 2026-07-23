import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { CliContext } from "./cli-core.js";
import { connectDaemon } from "./connection.js";
import {
  type DaemonRuntime,
  daemonStatus,
  persistRelayEnvOverrides,
  setDaemonPassword,
  stopDaemon,
  waitForDaemon,
} from "./daemon-control.js";
import { ensureLocalDaemonAndPair, printPairing } from "./daemon-commands.js";
import { buildPairingUrl, readDaemonPublicKey } from "./pairing.js";
import { bcryptHasher } from "./daemon-control.js";
import bcrypt from "bcryptjs";

function fakeRuntime(overrides: Partial<DaemonRuntime> = {}): DaemonRuntime {
  return {
    probe: async () => false,
    hash: (p) => `hashed:${p}`,
    kill: () => true,
    start: async () => 4242,
    ...overrides,
  };
}

function ctxWith(
  home: string,
  daemon: DaemonRuntime,
): { ctx: CliContext; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const ctx: CliContext = {
    connect: (opts) => connectDaemon(opts),
    sink: { write: (l) => out.push(l), error: (l) => err.push(l) },
    daemon,
    connectOverrides: { home },
  };
  return { ctx, out, err };
}

function tmpHome(): string {
  return mkdtempSync(join(tmpdir(), "pi-cli-daemon-"));
}

const noSleep = () => Promise.resolve();

describe("bcryptHasher", () => {
  it("produces a hash the daemon's bcrypt.compare accepts", () => {
    const hash = bcryptHasher("s3cret");
    expect(hash).not.toBe("s3cret");
    expect(bcrypt.compareSync("s3cret", hash)).toBe(true);
    expect(bcrypt.compareSync("wrong", hash)).toBe(false);
  });
});

// ─── status ──────────────────────────────────────────────────────────────────

describe("daemonStatus", () => {
  it("reports up when the probe succeeds", async () => {
    const res = await daemonStatus(fakeRuntime({ probe: async () => true }), "127.0.0.1:6767");
    expect(res).toEqual({ up: true, host: "127.0.0.1", port: 6767 });
  });
  it("reports down when the probe fails", async () => {
    const res = await daemonStatus(fakeRuntime({ probe: async () => false }), "h:1");
    expect(res.up).toBe(false);
  });
});

// ─── set-password ──────────────────────────────────────────────────────────────

describe("setDaemonPassword", () => {
  it("writes a hashed password into config.json (daemon.auth.password)", () => {
    const home = tmpHome();
    setDaemonPassword(home, "hunter2", fakeRuntime());
    const config = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
    expect(config.daemon.auth.password).toBe("hashed:hunter2");
    expect(config.version).toBe(1);
  });

  it("preserves existing config keys", () => {
    const home = tmpHome();
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({ version: 1, daemon: { listen: "0.0.0.0:6767" }, app: { baseUrl: "x" } }),
    );
    setDaemonPassword(home, "pw", fakeRuntime());
    const config = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
    expect(config.daemon.listen).toBe("0.0.0.0:6767");
    expect(config.app.baseUrl).toBe("x");
    expect(config.daemon.auth.password).toBe("hashed:pw");
  });
});

// ─── relay env persistence ──────────────────────────────────────────────────────

describe("persistRelayEnvOverrides", () => {
  it("does nothing when no PI_STUDIO_RELAY_* env var is set", () => {
    const home = tmpHome();
    persistRelayEnvOverrides(home, {});
    expect(() => readFileSync(join(home, "config.json"), "utf8")).toThrow();
  });

  it("writes daemon.relay into a fresh config.json", () => {
    const home = tmpHome();
    persistRelayEnvOverrides(home, {
      PI_STUDIO_RELAY_ENABLED: "true",
      PI_STUDIO_RELAY_ENDPOINT: "relay.molagent.ai",
      PI_STUDIO_RELAY_USE_TLS: "true",
    });
    const config = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
    expect(config.daemon.relay).toEqual({
      enabled: true,
      endpoint: "relay.molagent.ai",
      useTls: true,
    });
    expect(config.version).toBe(1);
  });

  it("preserves existing config keys and merges into an existing daemon.relay block", () => {
    const home = tmpHome();
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({
        version: 1,
        daemon: { listen: "0.0.0.0:6767", relay: { enabled: false, endpoint: "old.example" } },
        app: { baseUrl: "x" },
      }),
    );
    persistRelayEnvOverrides(home, { PI_STUDIO_RELAY_ENABLED: "true" });
    const config = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
    expect(config.daemon.listen).toBe("0.0.0.0:6767");
    expect(config.app.baseUrl).toBe("x");
    expect(config.daemon.relay).toEqual({ enabled: true, endpoint: "old.example" });
  });

  it("a later invocation with no relay env vars leaves a previously persisted relay config untouched", () => {
    const home = tmpHome();
    persistRelayEnvOverrides(home, {
      PI_STUDIO_RELAY_ENABLED: "true",
      PI_STUDIO_RELAY_ENDPOINT: "r.example",
    });
    persistRelayEnvOverrides(home, {});
    const config = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
    expect(config.daemon.relay).toEqual({ enabled: true, endpoint: "r.example" });
  });
});

// ─── stop ───────────────────────────────────────────────────────────────────────

describe("stopDaemon", () => {
  it("returns false when there is no pid file", () => {
    expect(stopDaemon(tmpHome(), fakeRuntime())).toBe(false);
  });
  it("signals the recorded pid", () => {
    const home = tmpHome();
    // Matches the real writer: `writeFileSync(pidPath, String(process.pid), "utf8")`
    // (packages/server/src/daemon/bootstrap.ts writePidLock) — plain text, not JSON.
    writeFileSync(join(home, "pi-studio.pid"), "9999", "utf8");
    let killed: number | undefined;
    const ok = stopDaemon(home, fakeRuntime({ kill: (pid) => ((killed = pid), true) }));
    expect(ok).toBe(true);
    expect(killed).toBe(9999);
  });
});

// ─── pairing ────────────────────────────────────────────────────────────────────

describe("pairing", () => {
  it("builds a pairing URL with the key in the fragment", () => {
    const url = buildPairingUrl("PUBKEYB64", { host: "127.0.0.1:6767" });
    expect(url).toContain("#");
    expect(url.split("#")[1]).toContain("offer=PUBKEYB64");
    // The key must be after the fragment marker (never sent to the origin).
    expect(url.split("#")[0]).not.toContain("PUBKEYB64");
  });

  it("defaults to the production web-client origin, not an unreachable placeholder", () => {
    const url = buildPairingUrl("PUBKEYB64", { host: "127.0.0.1:6767" });
    expect(url.split("#")[0]).toBe("https://app.molagent.ai/");
  });

  it("carries relay info instead of host when relay info is given", () => {
    const url = buildPairingUrl("PUBKEYB64", {
      host: "127.0.0.1:6767",
      relay: { endpoint: "relay.molagent.ai", useTls: true },
    });
    const fragment = url.split("#")[1] as string;
    expect(fragment).toContain("relay=relay.molagent.ai");
    expect(fragment).toContain("relayTls=1");
    expect(fragment).not.toContain("host=");
  });

  it("reads the daemon public key from daemon-keypair.json", () => {
    const home = tmpHome();
    writeFileSync(join(home, "daemon-keypair.json"), JSON.stringify({ publicKeyB64: "ABC" }));
    expect(readDaemonPublicKey(home)).toBe("ABC");
  });

  it("printPairing renders a QR + link when a keypair exists", async () => {
    const home = tmpHome();
    writeFileSync(join(home, "daemon-keypair.json"), JSON.stringify({ publicKeyB64: "KEY123" }));
    const { ctx, out } = ctxWith(home, fakeRuntime());
    const code = await printPairing(ctx, home, "127.0.0.1:6767");
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("Pairing link:");
    expect(out.join("\n")).toContain("offer=KEY123");
  });

  it("printPairing carries the relay endpoint (not host) when daemon.relay.enabled in config.json", async () => {
    const home = tmpHome();
    writeFileSync(join(home, "daemon-keypair.json"), JSON.stringify({ publicKeyB64: "KEY123" }));
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({
        version: 1,
        daemon: { relay: { enabled: true, endpoint: "relay.molagent.ai", useTls: true } },
      }),
    );
    const { ctx, out } = ctxWith(home, fakeRuntime());
    const code = await printPairing(ctx, home, "127.0.0.1:6767");
    expect(code).toBe(0);
    const printed = out.join("\n");
    expect(printed).toContain("relay=relay.molagent.ai");
    expect(printed).toContain("relayTls=1");
    expect(printed).not.toContain("host=");
    expect(printed).toContain("routed via relay relay.molagent.ai");
  });

  it("printPairing uses config.app.baseUrl instead of the default placeholder host", async () => {
    const home = tmpHome();
    writeFileSync(join(home, "daemon-keypair.json"), JSON.stringify({ publicKeyB64: "KEY123" }));
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({ version: 1, app: { baseUrl: "http://localhost:8080" } }),
    );
    const { ctx, out } = ctxWith(home, fakeRuntime());
    const code = await printPairing(ctx, home, "127.0.0.1:6767");
    expect(code).toBe(0);
    const printed = out.join("\n");
    expect(printed).toContain("Pairing link: http://localhost:8080/#offer=KEY123");
    expect(printed).not.toContain("app.pi-studio.sh");
  });

  it("printPairing prefers publicEndpoint/publicUseTls over endpoint/useTls when both are set", async () => {
    const home = tmpHome();
    writeFileSync(join(home, "daemon-keypair.json"), JSON.stringify({ publicKeyB64: "KEY123" }));
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({
        version: 1,
        daemon: {
          relay: {
            enabled: true,
            endpoint: "internal-relay:7000",
            useTls: false,
            publicEndpoint: "relay.molagent.ai",
            publicUseTls: true,
          },
        },
      }),
    );
    const { ctx, out } = ctxWith(home, fakeRuntime());
    await printPairing(ctx, home, "127.0.0.1:6767");
    const printed = out.join("\n");
    expect(printed).toContain("relay=relay.molagent.ai");
    expect(printed).toContain("relayTls=1");
  });

  it("printPairing falls back to host when relay is not enabled", async () => {
    const home = tmpHome();
    writeFileSync(join(home, "daemon-keypair.json"), JSON.stringify({ publicKeyB64: "KEY123" }));
    const { ctx, out } = ctxWith(home, fakeRuntime());
    await printPairing(ctx, home, "127.0.0.1:6767");
    const printed = out.join("\n");
    expect(printed).toContain("host=127.0.0.1%3A6767");
    expect(printed).not.toContain("relay=");
  });

  it("printPairing errors when no keypair exists", async () => {
    const home = tmpHome();
    const { ctx, err } = ctxWith(home, fakeRuntime());
    const code = await printPairing(ctx, home, undefined);
    expect(code).not.toBe(0);
    expect(err.join("\n")).toContain("no daemon keypair");
  });
});

// ─── waitForDaemon / ensureLocalDaemonAndPair ─────────────────────────────────────

describe("waitForDaemon", () => {
  it("returns true once the probe succeeds", async () => {
    let calls = 0;
    const ok = await waitForDaemon(fakeRuntime({ probe: async () => ++calls >= 3 }), "h", 1, {
      sleep: noSleep,
      attempts: 5,
    });
    expect(ok).toBe(true);
    expect(calls).toBe(3);
  });
  it("returns false when never healthy", async () => {
    const ok = await waitForDaemon(fakeRuntime(), "h", 1, { sleep: noSleep, attempts: 3 });
    expect(ok).toBe(false);
  });
});

describe("ensureLocalDaemonAndPair", () => {
  it("starts a daemon when none is running, then pairs", async () => {
    const home = tmpHome();
    writeFileSync(join(home, "daemon-keypair.json"), JSON.stringify({ publicKeyB64: "K" }));
    let started = false;
    let probeCalls = 0;
    const runtime = fakeRuntime({
      // down on first probe, up afterwards (simulating a successful spawn).
      probe: async () => probeCalls++ > 0,
      start: async () => ((started = true), 123),
    });
    const { ctx, out } = ctxWith(home, runtime);
    const code = await ensureLocalDaemonAndPair(ctx, { home }, { sleep: noSleep });
    expect(code).toBe(0);
    expect(started).toBe(true);
    expect(out.join("\n")).toContain("starting local daemon");
    expect(out.join("\n")).toContain("Pairing link:");
  });

  it("persists PI_STUDIO_RELAY_* env vars into config.json (features/cli.md § daemon start)", async () => {
    const home = tmpHome();
    writeFileSync(join(home, "daemon-keypair.json"), JSON.stringify({ publicKeyB64: "K" }));
    const runtime = fakeRuntime({ probe: async () => false, start: async () => 123 });
    const { ctx } = ctxWith(home, runtime);
    const prev = {
      PI_STUDIO_RELAY_ENABLED: process.env.PI_STUDIO_RELAY_ENABLED,
      PI_STUDIO_RELAY_ENDPOINT: process.env.PI_STUDIO_RELAY_ENDPOINT,
      PI_STUDIO_RELAY_USE_TLS: process.env.PI_STUDIO_RELAY_USE_TLS,
    };
    process.env.PI_STUDIO_RELAY_ENABLED = "true";
    process.env.PI_STUDIO_RELAY_ENDPOINT = "relay.molagent.ai";
    process.env.PI_STUDIO_RELAY_USE_TLS = "true";
    try {
      await ensureLocalDaemonAndPair(ctx, { home }, { sleep: noSleep });
    } finally {
      for (const [key, value] of Object.entries(prev)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    const config = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
    expect(config.daemon.relay).toEqual({
      enabled: true,
      endpoint: "relay.molagent.ai",
      useTls: true,
    });
  });

  it("forwards --pi-home to runtime.start", async () => {
    const home = tmpHome();
    writeFileSync(join(home, "daemon-keypair.json"), JSON.stringify({ publicKeyB64: "K" }));
    let receivedPiHome: string | undefined;
    const runtime = fakeRuntime({
      probe: async () => false,
      start: async (opts) => ((receivedPiHome = opts.piHome), 123),
    });
    const { ctx } = ctxWith(home, runtime);
    await ensureLocalDaemonAndPair(ctx, { home, piHome: "/custom/.pi" }, { sleep: noSleep });
    expect(receivedPiHome).toBe("/custom/.pi");
  });

  it("skips spawning when a daemon is already running", async () => {
    const home = tmpHome();
    writeFileSync(join(home, "daemon-keypair.json"), JSON.stringify({ publicKeyB64: "K" }));
    let started = false;
    const runtime = fakeRuntime({
      probe: async () => true,
      start: async () => ((started = true), 1),
    });
    const { ctx, out } = ctxWith(home, runtime);
    const code = await ensureLocalDaemonAndPair(ctx, { home }, { sleep: noSleep });
    expect(code).toBe(0);
    expect(started).toBe(false);
    expect(out.join("\n")).toContain("already running");
  });
});
