import { createServer } from "node:http";
import bcrypt from "bcryptjs";
import { WebSocket } from "ws";

import { WS_BEARER_SUBPROTOCOL_PREFIX, createPasswordAuth } from "../auth/password-auth.js";
import { silentLogger } from "../logging/logger.js";
import { HandlerRegistry, routeTextFrame } from "../ws/router.js";
import type { Session } from "../ws/session.js";
import { createWebSocketServer } from "../ws/ws-server.js";
import { listeningPort, messageOf } from "./daemon-test-client.js";

/**
 * Password-protected `createWebSocketServer` + `HandlerRegistry` harness for "authenticated only"
 * tests of an RPC family (sprint-084/085). Tests only; not part of the daemon runtime.
 */

export const AUTH_TEST_PASSWORD = "hunter2";

export interface AuthGatedServer {
  port: number;
  close(): Promise<void>;
}

/** Starts a protected server; `register` receives the registry and the live session set. */
export async function startAuthGatedServer(
  register: (registry: HandlerRegistry, sessions: () => Session[]) => void,
): Promise<AuthGatedServer> {
  const http = createServer();
  const registry = new HandlerRegistry(silentLogger());
  const wsHandle = createWebSocketServer(http, {
    serverId: "srv-auth-test",
    version: "0.0.0-test",
    auth: createPasswordAuth(bcrypt.hashSync(AUTH_TEST_PASSWORD, 4)),
    onMessage: (session, frame) => {
      if ("text" in frame) void routeTextFrame(session, frame.text, registry);
    },
  });
  register(registry, () => [...wsHandle.sessions]);
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", () => resolve()));
  return {
    port: await listeningPort(http),
    close: async () => {
      await wsHandle.close();
      http.close();
    },
  };
}

/** HTTP status of the rejected upgrade for a socket that presents no password. */
export function unauthenticatedUpgradeStatus(port: number): Promise<number | "open"> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  return new Promise((resolve) => {
    ws.once("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
    ws.once("open", () => {
      ws.close();
      resolve("open");
    });
    ws.once("error", () => undefined);
  });
}

/** One authenticated hello + RPC round trip; resolves with the inner reply message. */
export async function authenticatedRpc(
  port: number,
  type: string,
  body: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, [
    `${WS_BEARER_SUBPROTOCOL_PREFIX}${AUTH_TEST_PASSWORD}`,
  ]);
  const reply = Promise.withResolvers<Record<string, unknown>>();
  ws.on("message", (data: Buffer) => {
    const frame = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
    if (frame.type === "status") {
      ws.send(
        JSON.stringify({ type: "session", message: { ...body, type, requestId: "auth-rpc" } }),
      );
    } else {
      reply.resolve(messageOf(frame));
    }
  });
  ws.once("open", () => {
    ws.send(
      JSON.stringify({
        type: "hello",
        clientId: "auth-client",
        clientType: "cli",
        protocolVersion: 1,
      }),
    );
  });
  ws.once("error", reply.reject);
  try {
    return await reply.promise;
  } finally {
    ws.close();
  }
}
