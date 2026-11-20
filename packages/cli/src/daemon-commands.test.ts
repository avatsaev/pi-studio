import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { CliContext } from "./cli-core.js";
import { connectDaemon } from "./connection.js";
import {
  type DaemonRuntime,
  daemonStatus,
  persistRelayEnvOverrides,
  rotateDaemonKeypair,
  setDaemonPassword,
  stopDaemon,
  waitForDaemon,
} from "./daemon-control.js";
import { ensureLocalDaemonAndPair, printPairing } from "./daemon-commands.js";
import { buildProgram } from "./program.js";
import { renderQrToTerminal } from "./qr.js";
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

  it("writes config.json owner-only (0600) and re-tightens a pre-existing looser file", () => {
    const home = tmpHome();
    setDaemonPassword(home, "pw", fakeRuntime());
    const path = join(home, "config.json");
    expect(statSync(path).mode & 0o777).toBe(0o600);

    chmodSync(path, 0o644); // simulate a config written before 0600 was enforced
    setDaemonPassword(home, "pw2", fakeRuntime());
    expect(statSync(path).mode & 0o777).toBe(0o600);
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

// ─── rotate-key ───────────────────────────────────────────────────────────────

describe("rotateDaemonKeypair", () => {
  it("removes the keypair so the daemon mints a fresh identity on next boot", () => {
    const home = tmpHome();
    const path = join(home, "daemon-keypair.json");
    writeFileSync(path, JSON.stringify({ publicKeyB64: "LEAKED", secretKeyB64: "S" }));
    expect(readDaemonPublicKey(home)).toBe("LEAKED");

    expect(rotateDaemonKeypair(home)).toBe(true);
    expect(existsSync(path)).toBe(false);
    expect(readDaemonPublicKey(home)).toBeNull();
  });

  it("reports false when there was no keypair to revoke", () => {
    expect(rotateDaemonKeypair(tmpHome())).toBe(false);
  });

  it("invalidates the leaked pairing link: the next boot's link carries a different offer key", async () => {
    const home = tmpHome();
    writeFileSync(
      join(home, "daemon-keypair.json"),
      JSON.stringify({ publicKeyB64: "LEAKED", secretKeyB64: "S" }),
    );
    const leakedLink = buildPairingUrl(readDaemonPublicKey(home)!, { host: "127.0.0.1:6767" });

    rotateDaemonKeypair(home);
    // Stand in for the daemon's own boot-time regeneration
    // (server/src/daemon/bootstrap.ts#resolveDaemonKeypair regenerates when the file is missing).
    writeFileSync(
      join(home, "daemon-keypair.json"),
      JSON.stringify({ publicKeyB64: "FRESH", secretKeyB64: "S2" }),
    );

    const { ctx, out } = ctxWith(home, fakeRuntime({ probe: async () => true }));
    const code = await printPairing(ctx, home, "127.0.0.1:6767");
    expect(code).toBe(0);
    const printed = out.join("\n");
    expect(printed).toContain("FRESH");
    expect(printed).not.toContain("LEAKED");
    expect(printed).not.toContain(leakedLink);
  });

  it("leaves config.json (password hash, relay config) untouched — only the identity rotates", () => {
    const home = tmpHome();
    writeFileSync(join(home, "daemon-keypair.json"), JSON.stringify({ publicKeyB64: "K" }));
    setDaemonPassword(home, "pw", fakeRuntime());
    const before = readFileSync(join(home, "config.json"), "utf8");

    rotateDaemonKeypair(home);
    expect(readFileSync(join(home, "config.json"), "utf8")).toBe(before);
  });
});

// ─── --json (command level) ───────────────────────────────────────────────────────

const HOST = "127.0.0.1:6767";

function writeKeypair(home: string, key = "KEY123"): void {
  writeFileSync(join(home, "daemon-keypair.json"), JSON.stringify({ publicKeyB64: key }));
}

/** Drive the real root program (global options + exit handling) with a recording sink. */
async function runCli(
  home: string,
  daemon: DaemonRuntime,
  args: string[],
): Promise<{ out: string[]; err: string[]; code: number | undefined }> {
  const { ctx, out, err } = ctxWith(home, daemon);
  let code: number | undefined;
  const program = buildProgram(ctx, (c) => {
    code = c;
  });
  await program.parseAsync(["node", "pi-studio", "-H", HOST, ...args]);
  return { out, err, code };
}

describe("daemon --json", () => {
  it("start --json prints one line with started:true and no QR when it spawns a daemon", async () => {
    const home = tmpHome();
    writeKeypair(home);
    let probes = 0;
    const { out, err, code } = await runCli(
      home,
      fakeRuntime({ probe: async () => probes++ > 0 }),
      ["--json", "daemon", "start"],
    );
    expect(code).toBe(0);
    expect(err).toEqual([]);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0] as string)).toEqual({
      up: true,
      started: true,
      host: "127.0.0.1",
      port: 6767,
      pairingUrl: buildPairingUrl("KEY123", { host: HOST }),
      relay: null,
    });
  });

  it("start --json reports started:false (exit 0) when a daemon is already running", async () => {
    const home = tmpHome();
    writeKeypair(home);
    let spawned = false;
    const { out, code } = await runCli(
      home,
      fakeRuntime({ probe: async () => true, start: async () => ((spawned = true), 1) }),
      ["--json", "daemon", "start"],
    );
    expect(code).toBe(0);
    expect(spawned).toBe(false);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0] as string)).toMatchObject({ up: true, started: false });
  });

  it("start --json reports the relay endpoint the link routes through", async () => {
    const home = tmpHome();
    writeKeypair(home);
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({
        version: 1,
        daemon: { relay: { enabled: true, endpoint: "relay.molagent.ai", useTls: true } },
      }),
    );
    const { out } = await runCli(home, fakeRuntime({ probe: async () => true }), [
      "--json",
      "daemon",
      "start",
    ]);
    const parsed = JSON.parse(out[0] as string);
    expect(parsed.relay).toBe("relay.molagent.ai");
    expect(parsed.pairingUrl).toContain("relay=relay.molagent.ai");
  });

  it("start --json prints the not_healthy shape on stdout and exits non-zero", async () => {
    vi.useFakeTimers();
    try {
      const home = tmpHome();
      writeKeypair(home);
      const pending = runCli(home, fakeRuntime({ probe: async () => false }), [
        "--json",
        "daemon",
        "start",
      ]);
      await vi.advanceTimersByTimeAsync(60_000);
      const { out, err, code } = await pending;
      expect(code).toBe(1);
      expect(err).toEqual([]);
      expect(out).toHaveLength(1);
      expect(JSON.parse(out[0] as string)).toEqual({
        up: false,
        host: "127.0.0.1",
        port: 6767,
        error: "not_healthy",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("start --json with a healthy daemon but no key file prints no_keypair and exits non-zero", async () => {
    const { out, err, code } = await runCli(tmpHome(), fakeRuntime({ probe: async () => true }), [
      "--json",
      "daemon",
      "start",
    ]);
    expect(code).toBe(1);
    expect(err).toEqual([]);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0] as string)).toEqual({
      up: true,
      started: false,
      host: "127.0.0.1",
      port: 6767,
      error: "no_keypair",
    });
  });

  it("restart --json prints exactly one line (the start result)", async () => {
    const home = tmpHome();
    writeKeypair(home);
    writeFileSync(join(home, "pi-studio.pid"), "9999", "utf8");
    let probes = 0;
    const { out, code } = await runCli(home, fakeRuntime({ probe: async () => probes++ > 0 }), [
      "--json",
      "daemon",
      "restart",
    ]);
    expect(code).toBe(0);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0] as string)).toMatchObject({ up: true, started: true });
  });

  it("pair --json prints pairingUrl and relay, no QR", async () => {
    const home = tmpHome();
    writeKeypair(home);
    const { out, code } = await runCli(home, fakeRuntime(), ["--json", "daemon", "pair"]);
    expect(code).toBe(0);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0] as string)).toEqual({
      pairingUrl: buildPairingUrl("KEY123", { host: HOST }),
      relay: null,
    });
  });

  it("pair --json before any daemon has run prints no_keypair on stdout and exits non-zero", async () => {
    const { out, err, code } = await runCli(tmpHome(), fakeRuntime(), ["--json", "daemon", "pair"]);
    expect(code).toBe(1);
    expect(err).toEqual([]);
    expect(out).toEqual([JSON.stringify({ error: "no_keypair" })]);
  });

  it("stop --json prints stopped:true / stopped:false with today's exit codes", async () => {
    const home = tmpHome();
    writeFileSync(join(home, "pi-studio.pid"), "9999", "utf8");
    const stopped = await runCli(home, fakeRuntime(), ["--json", "daemon", "stop"]);
    expect(stopped.code).toBe(0);
    expect(stopped.out).toEqual([JSON.stringify({ stopped: true })]);

    const none = await runCli(tmpHome(), fakeRuntime(), ["--json", "daemon", "stop"]);
    expect(none.code).toBe(1);
    expect(none.out).toEqual([JSON.stringify({ stopped: false })]);
  });

  it("without --json, start and pair output is unchanged byte for byte", async () => {
    const home = tmpHome();
    writeKeypair(home);
    const url = buildPairingUrl("KEY123", { host: HOST });
    const qr = await renderQrToTerminal(url);

    let probes = 0;
    const start = await runCli(home, fakeRuntime({ probe: async () => probes++ > 0 }), [
      "daemon",
      "start",
    ]);
    expect(start.out).toEqual([
      "starting local daemon at 127.0.0.1:6767 …",
      "daemon listening at 127.0.0.1:6767",
      qr,
      `Pairing link: ${url}`,
    ]);

    const running = await runCli(home, fakeRuntime({ probe: async () => true }), [
      "daemon",
      "start",
    ]);
    expect(running.out).toEqual([
      "daemon already running at 127.0.0.1:6767",
      qr,
      `Pairing link: ${url}`,
    ]);

    const pair = await runCli(home, fakeRuntime(), ["daemon", "pair"]);
    expect(pair.out).toEqual([qr, `Pairing link: ${url}`]);

    const noKey = await runCli(tmpHome(), fakeRuntime(), ["daemon", "pair"]);
    expect(noKey.out).toEqual([]);
    expect(noKey.err).toEqual([
      "no daemon keypair found — start the daemon first (`pi-studio daemon start`).",
    ]);

    const stop = await runCli(tmpHome(), fakeRuntime(), ["daemon", "stop"]);
    expect(stop.out).toEqual(["no running daemon found"]);
  });

  it("rotate-key and onboard ignore --json", async () => {
    const url = buildPairingUrl("KEY123", { host: HOST });
    const qr = await renderQrToTerminal(url);

    const onboardHome = tmpHome();
    writeKeypair(onboardHome);
    const onboard = await runCli(onboardHome, fakeRuntime({ probe: async () => true }), [
      "--json",
      "onboard",
    ]);
    expect(onboard.out).toEqual([
      "daemon already running at 127.0.0.1:6767",
      qr,
      `Pairing link: ${url}`,
    ]);

    const rotateHome = tmpHome();
    writeKeypair(rotateHome);
    const rotate = await runCli(rotateHome, fakeRuntime({ probe: async () => true }), [
      "--json",
      "daemon",
      "rotate-key",
    ]);
    expect(rotate.out[0]).toContain("keypair rotated");
    expect(rotate.out.every((l) => !l.startsWith("{"))).toBe(true);
  });
});

// ─── desktop app contract ─────────────────────────────────────────────────────────

/** One stdout line, parsed as a JSON object. */
function onlyJsonObject(out: string[]): Record<string, unknown> {
  expect(out).toHaveLength(1);
  const parsed: unknown = JSON.parse(out[0] as string);
  expect(typeof parsed).toBe("object");
  expect(parsed).not.toBeNull();
  return parsed as Record<string, unknown>;
}

describe("desktop app contract: CLI output read by the desktop app", () => {
  it("--json daemon status prints one {up:boolean,host:string,port:number} line when up (exit 0)", async () => {
    const { out, code } = await runCli(tmpHome(), fakeRuntime({ probe: async () => true }), [
      "--json",
      "daemon",
      "status",
    ]);
    const o = onlyJsonObject(out);
    expect(o.up).toBe(true);
    expect(typeof o.host).toBe("string");
    expect(typeof o.port).toBe("number");
    expect(code).toBe(0);
  });

  it("--json daemon status prints the same fields when down (exit 1)", async () => {
    const { out, code } = await runCli(tmpHome(), fakeRuntime({ probe: async () => false }), [
      "--json",
      "daemon",
      "status",
    ]);
    const o = onlyJsonObject(out);
    expect(o.up).toBe(false);
    expect(typeof o.host).toBe("string");
    expect(typeof o.port).toBe("number");
    expect(code).toBe(1);
  });

  it("--json daemon start and restart: up/host/port typed as the app reads them", async () => {
    for (const cmd of ["start", "restart"]) {
      const home = tmpHome();
      writeKeypair(home);
      let probes = 0;
      const { out } = await runCli(home, fakeRuntime({ probe: async () => probes++ > 0 }), [
        "--json",
        "daemon",
        cmd,
      ]);
      const o = onlyJsonObject(out);
      expect(o.up).toBe(true);
      expect(typeof o.host).toBe("string");
      expect(typeof o.port).toBe("number");
      expect(typeof o.pairingUrl).toBe("string");
    }
  });

  it("--json daemon start and restart failure shapes carry up/host/port and a string error", async () => {
    for (const cmd of ["start", "restart"]) {
      // not_healthy: the daemon never comes up.
      vi.useFakeTimers();
      try {
        const pending = runCli(tmpHome(), fakeRuntime({ probe: async () => false }), [
          "--json",
          "daemon",
          cmd,
        ]);
        await vi.advanceTimersByTimeAsync(60_000);
        const { out, code } = await pending;
        const o = onlyJsonObject(out);
        expect(o.up).toBe(false);
        expect(typeof o.host).toBe("string");
        expect(typeof o.port).toBe("number");
        expect(typeof o.error).toBe("string");
        expect(code).toBe(1);
      } finally {
        vi.useRealTimers();
      }

      // no_keypair: healthy, but no key file.
      const { out, code } = await runCli(tmpHome(), fakeRuntime({ probe: async () => true }), [
        "--json",
        "daemon",
        cmd,
      ]);
      const o = onlyJsonObject(out);
      expect(o.up).toBe(true);
      expect(typeof o.host).toBe("string");
      expect(typeof o.port).toBe("number");
      expect(typeof o.error).toBe("string");
      expect(code).toBe(1);
    }
  });

  it("--json daemon stop: stopped is a boolean", async () => {
    const home = tmpHome();
    writeFileSync(join(home, "pi-studio.pid"), "9999", "utf8");
    const yes = await runCli(home, fakeRuntime(), ["--json", "daemon", "stop"]);
    expect(typeof onlyJsonObject(yes.out).stopped).toBe("boolean");
    const no = await runCli(tmpHome(), fakeRuntime(), ["--json", "daemon", "stop"]);
    expect(typeof onlyJsonObject(no.out).stopped).toBe("boolean");
  });

  it("--version prints one line that is a semantic version and nothing else", async () => {
    const { ctx } = ctxWith(tmpHome(), fakeRuntime());
    const program = buildProgram(ctx, () => {});
    let stdout = "";
    let stderr = "";
    program.configureOutput({
      writeOut: (s) => void (stdout += s),
      writeErr: (s) => void (stderr += s),
    });
    await expect(program.parseAsync(["node", "pi-studio", "--version"])).rejects.toMatchObject({
      code: "commander.version",
    });
    expect(stderr).toBe("");
    expect(stdout).toMatch(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\n$/);
  });
});
