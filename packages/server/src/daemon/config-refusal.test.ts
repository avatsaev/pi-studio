import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createConnection, createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CONFIG_UNREADABLE_CODE, ConfigUnreadableError } from "../config/daemon-config.js";
import { recordingLogger } from "../test-support/recording-logger.js";
import { startDaemon } from "./bootstrap.js";

afterEach(() => {
  process.exitCode = undefined;
});

/** A truncated config.json that carried a password hash: the case the refusal exists for. */
const TRUNCATED = '{ "daemon": { "auth": { "password": "$2a$10$abcdefghijklmnopqrstuv"';

async function freePort(): Promise<number> {
  const { promise, resolve } = Promise.withResolvers<number>();
  const server = createServer();
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address() as AddressInfo;
    server.close(() => resolve(port));
  });
  return promise;
}

function canConnect(port: number): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const socket = createConnection({ port, host: "127.0.0.1" });
  socket.once("connect", () => socket.destroy(() => resolve(true)));
  socket.once("error", () => resolve(false));
  return promise;
}

describe("a damaged config.json at start", () => {
  it("refuses: logs, sets the exit code, calls onFatalError, never listens, writes no PID file, keeps the bytes", async () => {
    const home = mkdtempSync(join(tmpdir(), "pi-studio-config-refusal-"));
    const configPath = join(home, "config.json");
    writeFileSync(configPath, TRUNCATED);
    const before = readFileSync(configPath);
    const port = await freePort();
    const { logger, lines } = recordingLogger();
    let fatal: NodeJS.ErrnoException | undefined;

    expect(() =>
      startDaemon({
        home,
        host: "127.0.0.1",
        port,
        logger,
        onFatalError: (e) => (fatal = e),
      }),
    ).toThrow(ConfigUnreadableError);

    expect(fatal?.code).toBe(CONFIG_UNREADABLE_CODE);
    expect(fatal?.message).toContain(configPath);
    expect(lines.filter((l) => l.level === "error")).toEqual([
      expect.objectContaining({
        msg: expect.stringContaining(configPath),
        obj: { path: configPath, code: CONFIG_UNREADABLE_CODE },
      }),
    ]);
    expect(process.exitCode).toBe(1);
    expect(await canConnect(port)).toBe(false);
    expect(existsSync(join(home, "pi-studio.pid"))).toBe(false);
    expect(readFileSync(configPath).equals(before)).toBe(true);
    expect(readdirSync(home)).toEqual(["config.json"]);
  });

  it("refuses a config that fails the schema the same way", () => {
    const home = mkdtempSync(join(tmpdir(), "pi-studio-config-refusal-"));
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({ agents: { providers: { other: {} } } }),
    );
    const { logger, lines } = recordingLogger();
    let fatal: NodeJS.ErrnoException | undefined;

    expect(() =>
      startDaemon({ home, logger, port: 0, host: "127.0.0.1", onFatalError: (e) => (fatal = e) }),
    ).toThrow(/agents\.providers\.other/);

    expect(fatal?.code).toBe(CONFIG_UNREADABLE_CODE);
    expect(lines.some((l) => l.level === "error")).toBe(true);
    expect(process.exitCode).toBe(1);
  });
});
