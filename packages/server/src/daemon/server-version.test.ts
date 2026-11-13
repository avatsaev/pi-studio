import { afterEach, describe, expect, it } from "vitest";
import { type AddressInfo } from "node:net";
import { WebSocket } from "ws";

import { silentLogger } from "../logging/logger.js";
import { SERVER_VERSION } from "../version.js";
import { startDevDaemon, type DevBootstrapHandle } from "./dev-bootstrap.js";

let handle: DevBootstrapHandle | undefined;

afterEach(async () => {
  await handle?.close();
  handle = undefined;
});

describe("server_info.version (sprint-084/task-001)", () => {
  it("dev handshake reports SERVER_VERSION, not a placeholder", async () => {
    const dev = startDevDaemon({ host: "127.0.0.1", port: 0, logger: silentLogger() });
    handle = dev;
    const port = await new Promise<number>((resolve, reject) => {
      if (dev.httpServer.listening) resolve((dev.httpServer.address() as AddressInfo).port);
      else {
        dev.httpServer.once("listening", () =>
          resolve((dev.httpServer.address() as AddressInfo).port),
        );
        dev.httpServer.once("error", reject);
      }
    });
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const status = await new Promise<Record<string, unknown>>((resolve, reject) => {
      ws.once("open", () => {
        ws.send(
          JSON.stringify({ type: "hello", clientId: "v", clientType: "cli", protocolVersion: 1 }),
        );
      });
      ws.once("message", (data: Buffer) => resolve(JSON.parse(data.toString("utf8"))));
      ws.once("error", reject);
    });
    ws.close();
    const payload = status.payload as { version?: string };
    expect(payload.version).toBe(SERVER_VERSION);
    expect(payload.version).not.toBe("1.0.0");
    expect(payload.version).not.toBe("0.1.0-dev");
  });
});
