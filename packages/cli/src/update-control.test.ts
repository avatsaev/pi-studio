import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  CURRENT_VERSION,
  PACKAGE_NAME,
  currentBinaryDaemonStarter,
  defaultUpdateRuntime,
} from "./update-control.js";

// The engine's own tests (version comparison, ENOTEMPTY retry) live in
// packages/server/src/update/npm.test.ts.

describe("CURRENT_VERSION / PACKAGE_NAME", () => {
  it("reads the real package.json version, not a hardcoded placeholder", () => {
    expect(CURRENT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(CURRENT_VERSION).not.toBe("0.0.0");
  });

  it("targets the published CLI package", () => {
    expect(PACKAGE_NAME).toBe("@av-pi-studio/cli");
  });
});

describe("defaultUpdateRuntime", () => {
  it("wires the server engine's npm lookup and install", () => {
    const runtime = defaultUpdateRuntime();
    expect(typeof runtime.getLatestVersion).toBe("function");
    expect(typeof runtime.installGlobal).toBe("function");
  });
});

describe("defaultUpdateRuntime on Node", () => {
  it("has no binary update runtime (the npm path stays the only one)", () => {
    expect(defaultUpdateRuntime().binary).toBeUndefined();
  });
});

describe("currentBinaryDaemonStarter", () => {
  it("starts bin/current/pi-studio's __daemon with the address and home, detached", async () => {
    const home = mkdtempSync(join(tmpdir(), "pi-studio-starter-"));
    try {
      const dir = join(home, "bin/versions/9.9.9");
      mkdirSync(dir, { recursive: true });
      symlinkSync(join("versions", "9.9.9"), join(home, "bin/current"));
      const out = join(home, "args.txt");
      writeFileSync(
        join(dir, "pi-studio"),
        `#!/bin/sh\necho "$1 $2 $PI_STUDIO_LISTEN $PI_STUDIO_HOME $PI_STUDIO_PI_HOME" > ${out}\n`,
        { mode: 0o755 },
      );
      const pid = await currentBinaryDaemonStarter({
        home,
        listen: "127.0.0.1:7777",
        piHome: "/pi",
      });
      expect(pid).toBeGreaterThan(0);
      await vi.waitFor(() => expect(existsSync(out)).toBe(true));
      const [command, json, listen, envHome, piHome] = readFileSync(out, "utf8").trim().split(" ");
      expect(command).toBe("__daemon");
      expect(JSON.parse(json ?? "")).toEqual({ host: "127.0.0.1", port: 7777, home });
      expect([listen, envHome, piHome]).toEqual(["127.0.0.1:7777", home, "/pi"]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
