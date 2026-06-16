import { chmodSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  acquirePidLock,
  DaemonLockError,
  daemonKeypairSchema,
  loadOrCreateDaemonKeypair,
  loadOrCreateServerId,
  resolvePiStudioHome,
} from "./identity.js";

async function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pi-studio-identity-"));
}

describe("resolvePiStudioHome", () => {
  it("prefers PI_STUDIO_HOME, else ~/.pi-studio", () => {
    expect(resolvePiStudioHome({ PI_STUDIO_HOME: "/custom/home" })).toBe("/custom/home");
    expect(resolvePiStudioHome({})).toMatch(/\.pi-studio$/);
  });
});

describe("acquirePidLock", () => {
  it("fails to acquire when a live foreign daemon owns the home", async () => {
    const home = await tempHome();
    const pidPath = join(home, "pi-studio.pid");
    acquirePidLock(pidPath, { pid: 4242, isAlive: () => true });
    expect(() => acquirePidLock(pidPath, { pid: 9999, isAlive: () => true })).toThrow(
      DaemonLockError,
    );
  });

  it("reclaims a stale lock (dead PID) and continues", async () => {
    const home = await tempHome();
    const pidPath = join(home, "pi-studio.pid");
    acquirePidLock(pidPath, { pid: 4242, isAlive: () => true });
    const lock = acquirePidLock(pidPath, { pid: 9999, isAlive: () => false });
    expect(lock.info.pid).toBe(9999);
    expect(JSON.parse(readFileSync(pidPath, "utf8")).pid).toBe(9999);
  });

  it("reclaims a corrupt lock file", async () => {
    const home = await tempHome();
    const pidPath = join(home, "pi-studio.pid");
    writeFileSync(pidPath, "{ not json", "utf8");
    const lock = acquirePidLock(pidPath, { pid: 5, isAlive: () => true, listen: "127.0.0.1:6767" });
    expect(lock.info.listen).toBe("127.0.0.1:6767");
  });

  it("release() removes the file only when it still owns the lock", async () => {
    const home = await tempHome();
    const pidPath = join(home, "pi-studio.pid");
    const lock = acquirePidLock(pidPath, { pid: 5, isAlive: () => true });
    lock.release();
    expect(() => readFileSync(pidPath, "utf8")).toThrow();
  });
});

describe("loadOrCreateServerId", () => {
  it("is stable across calls for the same home", async () => {
    const home = await tempHome();
    const a = loadOrCreateServerId(home, {});
    const b = loadOrCreateServerId(home, {});
    expect(a).toBe(b);
    expect(a).toMatch(/^srv_[A-Za-z0-9_-]+$/);
  });

  it("is overridden by PI_STUDIO_SERVER_ID", async () => {
    const home = await tempHome();
    expect(loadOrCreateServerId(home, { PI_STUDIO_SERVER_ID: "srv_custom" })).toBe("srv_custom");
  });
});

describe("loadOrCreateDaemonKeypair", () => {
  it("creates a v2 keypair file at mode 0600", async () => {
    const home = await tempHome();
    const kp = loadOrCreateDaemonKeypair(home);
    expect(daemonKeypairSchema.safeParse(kp).success).toBe(true);
    expect(Buffer.from(kp.publicKeyB64, "base64").length).toBe(32);
    const mode = statSync(join(home, "daemon-keypair.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("is stable across calls and regenerates an unreadable file", async () => {
    const home = await tempHome();
    const first = loadOrCreateDaemonKeypair(home);
    expect(loadOrCreateDaemonKeypair(home)).toEqual(first);

    const path = join(home, "daemon-keypair.json");
    chmodSync(path, 0o600);
    writeFileSync(path, "garbage-not-json", "utf8");
    const regenerated = loadOrCreateDaemonKeypair(home);
    expect(daemonKeypairSchema.safeParse(regenerated).success).toBe(true);
    expect(regenerated.secretKeyB64).not.toBe(first.secretKeyB64);
  });
});
