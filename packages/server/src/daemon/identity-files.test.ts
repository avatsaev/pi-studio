import type * as NodeFs from "node:fs";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recordingLogger } from "../test-support/recording-logger.js";
import {
  generateDaemonKeypair,
  resolveDaemonKeypair,
  resolveServerId,
  writeDaemonKeypair,
} from "./identity-files.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

const actualRename = (await vi.importActual<typeof NodeFs>("node:fs")).renameSync;

function tmpHome(): string {
  return mkdtempSync(join(tmpdir(), "pi-studio-identity-"));
}

/** The names in `home` that hold a set-aside copy of `name`. */
function setAside(home: string, name: string): string[] {
  return readdirSync(home).filter((entry) => entry.startsWith(`${name}.corrupt-`));
}

beforeEach(() => {
  vi.stubEnv("PI_STUDIO_SERVER_ID", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(renameSync).mockImplementation(actualRename);
});

describe("resolveDaemonKeypair", () => {
  it("creates a missing key pair quietly, owner-only", () => {
    const home = tmpHome();
    const { logger, lines } = recordingLogger();

    const keypair = resolveDaemonKeypair(home, logger);

    const path = join(home, "daemon-keypair.json");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(keypair);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(home)).toEqual(["daemon-keypair.json"]);
    expect(lines).toEqual([]);
  });

  it("returns the stored pair on the next start, and tightens a file written with wider rights", () => {
    const home = tmpHome();
    const path = join(home, "daemon-keypair.json");
    const first = resolveDaemonKeypair(home, recordingLogger().logger);
    chmodSync(path, 0o644);
    const { logger, lines } = recordingLogger();

    expect(resolveDaemonKeypair(home, logger)).toEqual(first);

    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(lines).toEqual([]);
  });

  it.each([
    ["is not JSON", "{ truncated"],
    ["is empty", ""],
    ["has no secret key", JSON.stringify({ publicKeyB64: "PUB" })],
    ["holds a non-string key", JSON.stringify({ publicKeyB64: "PUB", secretKeyB64: 7 })],
    ["is JSON null", "null"],
  ])("a key pair file that %s is set aside whole, replaced, and logged once", (_name, bytes) => {
    const home = tmpHome();
    const path = join(home, "daemon-keypair.json");
    writeFileSync(path, bytes);
    const { logger, lines } = recordingLogger();

    const keypair = resolveDaemonKeypair(home, logger);

    const [aside, ...rest] = setAside(home, "daemon-keypair.json");
    expect(rest).toEqual([]);
    expect(readFileSync(join(home, aside!), "utf8")).toBe(bytes);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(keypair);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(home)).toHaveLength(2);
    expect(lines).toEqual([
      expect.objectContaining({
        level: "error",
        msg: expect.stringMatching(/pairing links are revoked and devices must pair again/),
        obj: expect.objectContaining({ path, quarantinedTo: join(home, aside!) }),
      }),
    ]);
  });

  it("a key pair that cannot be written is logged, and the pair is used for this run", () => {
    const home = tmpHome();
    const blocker = join(home, "blocker");
    writeFileSync(blocker, "a file, so nothing can be created below it");
    const { logger, lines } = recordingLogger();

    const keypair = resolveDaemonKeypair(join(blocker, "home"), logger);

    expect(keypair.publicKeyB64).toEqual(expect.any(String));
    expect(lines).toEqual([
      expect.objectContaining({
        level: "error",
        msg: expect.stringContaining("key pair could not be written"),
      }),
    ]);
  });

  it("a damaged file that cannot be set aside stays as it is and nothing is written over it", () => {
    const home = tmpHome();
    const path = join(home, "daemon-keypair.json");
    writeFileSync(path, "{ truncated");
    vi.mocked(renameSync).mockImplementation(() => {
      throw new Error("rename refused");
    });
    const { logger, lines } = recordingLogger();

    const keypair = resolveDaemonKeypair(home, logger);

    expect(keypair.publicKeyB64).toEqual(expect.any(String));
    expect(readFileSync(path, "utf8")).toBe("{ truncated");
    expect(readdirSync(home)).toEqual(["daemon-keypair.json"]);
    expect(lines).toEqual([
      expect.objectContaining({ level: "error", obj: expect.objectContaining({ path }) }),
    ]);
  });
});

describe("writeDaemonKeypair (crash simulation)", () => {
  it("a crash before the rename leaves the previous file whole and no temp file", () => {
    const home = tmpHome();
    const path = join(home, "daemon-keypair.json");
    const previous = JSON.stringify(generateDaemonKeypair());
    writeFileSync(path, previous);
    vi.mocked(renameSync).mockImplementation((from, to) => {
      if (String(from).endsWith(".tmp")) throw new Error("crash before rename");
      actualRename(from, to);
    });

    expect(() => writeDaemonKeypair(home, generateDaemonKeypair())).toThrow("crash before rename");

    expect(readFileSync(path, "utf8")).toBe(previous);
    expect(readdirSync(home)).toEqual(["daemon-keypair.json"]);
  });

  it("replaces the previous file in one step, owner-only", () => {
    const home = tmpHome();
    const path = join(home, "daemon-keypair.json");
    writeFileSync(path, "old");
    chmodSync(path, 0o644);
    const next = generateDaemonKeypair();

    writeDaemonKeypair(home, next);

    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(next);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(home)).toEqual(["daemon-keypair.json"]);
  });
});

describe("resolveServerId", () => {
  it("creates a missing id quietly and returns the same one on the next start", () => {
    const home = tmpHome();
    const { logger, lines } = recordingLogger();

    const id = resolveServerId(home, logger);

    expect(readFileSync(join(home, "server-id"), "utf8")).toBe(id);
    expect(resolveServerId(home, logger)).toBe(id);
    expect(readdirSync(home)).toEqual(["server-id"]);
    expect(lines).toEqual([]);
  });

  it("an override wins and nothing is written", () => {
    const home = tmpHome();

    expect(resolveServerId(home, recordingLogger().logger, "srv_fixed")).toBe("srv_fixed");

    expect(readdirSync(home)).toEqual([]);
  });

  it.each([
    ["empty", ""],
    ["blank", "  \n"],
  ])("an %s id file is set aside, replaced, and logged once", (_name, bytes) => {
    const home = tmpHome();
    const path = join(home, "server-id");
    writeFileSync(path, bytes);
    const { logger, lines } = recordingLogger();

    const id = resolveServerId(home, logger);

    const [aside, ...rest] = setAside(home, "server-id");
    expect(rest).toEqual([]);
    expect(readFileSync(join(home, aside!), "utf8")).toBe(bytes);
    expect(readFileSync(path, "utf8")).toBe(id);
    expect(id).not.toBe("");
    expect(lines).toEqual([
      expect.objectContaining({
        level: "error",
        obj: expect.objectContaining({ path, quarantinedTo: join(home, aside!) }),
      }),
    ]);
  });

  it("an id that cannot be read is set aside and replaced", () => {
    const home = tmpHome();
    const path = join(home, "server-id");
    mkdirSync(path);
    const { logger, lines } = recordingLogger();

    const id = resolveServerId(home, logger);

    expect(setAside(home, "server-id")).toHaveLength(1);
    expect(readFileSync(path, "utf8")).toBe(id);
    expect(lines.filter((l) => l.level === "error")).toHaveLength(1);
  });

  it("a home where the id cannot be written: the failure is logged and the id is used for this run", () => {
    const home = tmpHome();
    const blocker = join(home, "blocker");
    writeFileSync(blocker, "a file, so nothing can be created below it");
    const { logger, lines } = recordingLogger();

    const id = resolveServerId(join(blocker, "home"), logger);

    expect(id).toEqual(expect.any(String));
    expect(id).not.toBe("");
    expect(lines).toEqual([
      expect.objectContaining({
        level: "error",
        msg: expect.stringContaining("server id could not be written"),
      }),
    ]);
  });
});
