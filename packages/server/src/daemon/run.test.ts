import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { silentLogger } from "../logging/logger.js";
import { connectTestClient, listeningPort, messageOf } from "../test-support/daemon-test-client.js";
import type { DaemonHandle } from "./bootstrap.js";
import { runDaemon, type ProcessHost } from "./run.js";

/**
 * `runDaemon` is the process entry (`main.ts`, the CLI's detached starter): signals close the
 * daemon cleanly and exit, a self-update exits after its shutdown. The process is a fake host, so
 * nothing here signals or ends the test process.
 */

interface FakeHost extends ProcessHost {
  handlers: Record<string, () => void>;
  exits: number[];
  exited: Promise<number>;
}

function fakeHost(): FakeHost {
  const exited = Promise.withResolvers<number>();
  const host: FakeHost = {
    handlers: {},
    exits: [],
    exited: exited.promise,
    on: (signal, listener) => {
      host.handlers[signal] = listener;
    },
    exit: (code) => {
      host.exits.push(code);
      exited.resolve(code);
    },
  };
  return host;
}

let handle: DaemonHandle | undefined;

afterEach(async () => {
  await handle?.close();
  handle = undefined;
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "pi-studio-run-"));
  const piHome = mkdtempSync(join(tmpdir(), "pi-studio-run-pihome-"));
  writeFileSync(
    join(home, "config.json"),
    JSON.stringify({ daemon: { piHome, extensions: { autoSync: false } } }),
    "utf8",
  );
  return home;
}

describe("runDaemon", () => {
  it.each(["SIGTERM", "SIGINT"] as const)(
    "%s closes the daemon cleanly (not listening, pid file removed), then exits 0",
    async (signal) => {
      const host = fakeHost();
      const home = tempHome();
      handle = runDaemon({ host: "127.0.0.1", port: 0, home, logger: silentLogger() }, host);
      await listeningPort(handle.httpServer);
      const pidFile = join(home, "pi-studio.pid");
      expect(existsSync(pidFile)).toBe(true);

      host.handlers[signal]?.();
      expect(await host.exited).toBe(0);

      expect(handle.httpServer.listening).toBe(false);
      expect(existsSync(pidFile)).toBe(false);
      expect(host.exits).toEqual([0]);
    },
  );

  it("exits through the host after a self-update's shutdown", async () => {
    const host = fakeHost();
    const home = tempHome();
    handle = runDaemon(
      {
        host: "127.0.0.1",
        port: 0,
        home,
        logger: silentLogger(),
        updateTestSeams: {
          service: {
            detectInstallKind: async () => "npm-global",
            fetchLatest: async () => "99.0.0",
            npmOnPath: async () => true,
            globalFolder: async () => "/fake/npm/root",
            canWriteGlobalFolder: async () => true,
            platform: "linux",
          },
          pipeline: {
            install: async () => undefined,
            updateExtensions: async () => undefined,
            spawnHelper: () => undefined,
            pause: async () => undefined,
          },
        },
      },
      host,
    );
    const client = await connectTestClient(await listeningPort(handle.httpServer));
    try {
      await client.rpc("daemon_update_check_request");
      expect(messageOf(await client.rpc("daemon_update_apply_request")).ok).toBe(true);
      expect(await host.exited).toBe(0);
      expect(handle.httpServer.listening).toBe(false);
    } finally {
      await client.close();
    }
  });
});
