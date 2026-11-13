import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startDaemon, type DaemonHandle } from "./bootstrap.js";
import { DEFAULT_DAEMON_LISTEN } from "./index.js";
import { isLoopbackHost } from "./loopback.js";
import { persistedConfigSchema } from "../config/daemon-config.js";
import type { Logger } from "../logging/logger.js";

let handle: DaemonHandle | undefined;
const savedEnv = { listen: process.env.PI_STUDIO_LISTEN, pw: process.env.PI_STUDIO_PASSWORD };

afterEach(async () => {
  await handle?.close();
  handle = undefined;
  for (const [k, v] of [
    ["PI_STUDIO_LISTEN", savedEnv.listen],
    ["PI_STUDIO_PASSWORD", savedEnv.pw],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  process.exitCode = undefined;
});

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

function makeHome(daemon: Record<string, unknown> = {}): string {
  const home = mkdtempSync(join(tmpdir(), "pi-studio-listen-"));
  const piHome = mkdtempSync(join(tmpdir(), "pi-studio-listen-pihome-"));
  writeFileSync(
    join(home, "config.json"),
    JSON.stringify({ daemon: { piHome, extensions: { autoSync: false }, ...daemon } }),
  );
  return home;
}

const noop = (): void => {};

function capture(): { logger: Logger; warns: unknown[] } {
  const warns: unknown[] = [];
  const logger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: (obj: unknown) => void warns.push(obj),
    error: noop,
    fatal: noop,
    child: () => logger,
  } as unknown as Logger;
  return { logger, warns };
}

describe("daemon listen address", () => {
  it("config schema default equals DEFAULT_DAEMON_LISTEN", () => {
    expect(persistedConfigSchema.parse({}).daemon.listen).toBe(DEFAULT_DAEMON_LISTEN);
  });

  it("binds loopback by default (no env, no opts)", async () => {
    delete process.env.PI_STUDIO_LISTEN;
    const port = await freePort();
    handle = startDaemon({
      home: makeHome({ listen: `127.0.0.1:${port}` }),
      logger: capture().logger,
    });
    expect(handle.listen).toEqual({ host: "127.0.0.1", port });
    const dflt = persistedConfigSchema.parse({}).daemon.listen;
    expect(dflt.startsWith("127.0.0.1:")).toBe(true);
  });

  it("PI_STUDIO_LISTEN beats config; explicit opts beat both", async () => {
    const [a, b, c] = [await freePort(), await freePort(), await freePort()];
    process.env.PI_STUDIO_LISTEN = `127.0.0.1:${b}`;
    handle = startDaemon({
      home: makeHome({ listen: `127.0.0.1:${a}` }),
      logger: capture().logger,
    });
    expect(handle.listen.port).toBe(b);
    await handle.close();
    handle = startDaemon({
      home: makeHome({ listen: `127.0.0.1:${a}` }),
      port: c,
      logger: capture().logger,
    });
    expect(handle.listen.port).toBe(c);
  });

  it("invalid daemon.listen fails startup via onFatalError, no process.exit", () => {
    delete process.env.PI_STUDIO_LISTEN;
    let fatal: Error | undefined;
    expect(() =>
      startDaemon({
        home: makeHome({ listen: "nonsense" }),
        logger: capture().logger,
        onFatalError: (e) => (fatal = e),
      }),
    ).toThrow(/Invalid listen address/);
    expect(fatal?.message).toMatch(/Invalid listen address/);
  });
});

describe("unprotected bind warning", () => {
  it.each([
    ["127.0.0.1", true],
    ["127.1.2.3", true],
    ["::1", true],
    ["localhost", true],
    ["foo.localhost", true],
    ["0.0.0.0", false],
    ["::", false],
    ["192.168.1.2", false],
    ["example.com", false],
  ])("isLoopbackHost(%s) = %s", (host, expected) => {
    expect(isLoopbackHost(host)).toBe(expected);
  });

  it("warns exactly once on 0.0.0.0 without password", async () => {
    delete process.env.PI_STUDIO_PASSWORD;
    const { logger, warns } = capture();
    handle = startDaemon({ home: makeHome(), host: "0.0.0.0", port: 0, logger });
    expect(warns).toHaveLength(1);
    expect(handle.exposedWithoutPassword).toBe(true);
  });

  it("no warning with password or on loopback", async () => {
    process.env.PI_STUDIO_PASSWORD = "secret";
    const a = capture();
    handle = startDaemon({ home: makeHome(), host: "0.0.0.0", port: 0, logger: a.logger });
    expect(a.warns).toHaveLength(0);
    await handle.close();
    delete process.env.PI_STUDIO_PASSWORD;
    const b = capture();
    handle = startDaemon({ home: makeHome(), host: "127.0.0.1", port: 0, logger: b.logger });
    expect(b.warns).toHaveLength(0);
    expect(handle.exposedWithoutPassword).toBe(false);
  });
});
