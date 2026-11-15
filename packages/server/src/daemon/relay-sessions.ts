/**
 * One daemon `Session` per relay connection (architecture/relay-protocol.md § 5, § Behavior —
 * Daemon; features/relay-multi-client.md § Public contract 2).
 *
 * A {@link RelayConnection} behaves like a direct socket, so this module is the relay twin of the
 * direct `hello` path in `ws/ws-server.ts`: the first text record must be a valid `hello` (else the
 * connection closes with 1008), which creates the session, rehydrates/persists capabilities by
 * `clientId`, and answers `status`/`server_info`. Later records go to the same router and binary
 * handlers direct sessions use. When the connection closes, `deps.onSessionClose` runs — the same
 * disposal function a direct close runs; there is no second disposal list here.
 */
import { randomUUID } from "node:crypto";

import { helloSchema, serverInfoPayloadSchema, statusSchema } from "@av-pi-studio/protocol";
import type { WebSocket } from "ws";

import type { Logger } from "../logging/logger.js";
import type { CapabilityStore } from "../ws/capability-store.js";
import type { BinaryHandler, HandlerRegistry } from "../ws/router.js";
import { Session } from "../ws/session.js";
import type { RelayConnection } from "./relay-connection.js";

/** `WebSocket.OPEN` / `WebSocket.CLOSED` readyState values. */
const WS_OPEN = 1;
const WS_CLOSED = 3;

export interface RelaySessionDeps {
  registry: HandlerRegistry;
  routeTextFrame: (session: Session, text: string, registry: HandlerRegistry) => Promise<void>;
  routeBinaryFrame: (session: Session, bytes: Uint8Array, binaryHandler?: BinaryHandler) => void;
  /** Handler for post-handshake binary records (terminal input, file uploads). */
  binaryHandler: BinaryHandler;
  capabilityStore: CapabilityStore;
  /** The `server_info` payload fields; parsed with `serverInfoPayloadSchema` before sending. */
  buildServerInfo: () => Record<string, unknown>;
  /** Called once the handshake completes and the `server_info` reply is sent. */
  onSessionOpen: (session: Session) => void;
  /** Called once when the connection closes, if a session was created. */
  onSessionClose: (session: Session) => void;
  logger: Logger;
}

/** The slice of `ws.WebSocket` a `Session` uses, backed by a relay connection. */
function socketFacade(conn: RelayConnection): WebSocket {
  const facade = {
    send: (data: string | Uint8Array): void => {
      if (typeof data === "string") conn.sendText(data);
      else conn.sendBinary(data);
    },
    close: (code?: number, reason?: string): void => conn.close(code, reason),
    get bufferedAmount(): number {
      return conn.bufferedAmount;
    },
    get readyState(): number {
      return conn.isOpen ? WS_OPEN : WS_CLOSED;
    },
  };
  return facade as unknown as WebSocket;
}

/** Wire `conn` to its own daemon session; see the module comment. */
export function attachRelaySession(conn: RelayConnection, deps: RelaySessionDeps): void {
  const { logger } = deps;
  const connectedAt = Date.now();
  let session: Session | null = null;

  conn.onText((text) => {
    if (session !== null) {
      void deps.routeTextFrame(session, text, deps.registry);
      return;
    }

    // First text record must be a valid JSON `hello` (same reasons as the direct path).
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      logger.warn(
        { connectionId: conn.connectionId },
        "relay handshake failed: invalid hello JSON",
      );
      conn.close(1008, "invalid hello");
      return;
    }
    const hello = helloSchema.safeParse(parsed);
    if (!hello.success) {
      logger.warn(
        { connectionId: conn.connectionId },
        "relay handshake failed: first frame not a valid hello",
      );
      conn.close(1008, "first frame must be hello");
      return;
    }

    // Persist on hello; rehydrate stored caps when the hello omits them.
    const stored = deps.capabilityStore.get(hello.data.clientId);
    const capabilities = hello.data.capabilities ?? stored ?? {};
    deps.capabilityStore.set(hello.data.clientId, capabilities);

    const created = new Session({
      id: randomUUID(),
      clientId: hello.data.clientId,
      clientType: hello.data.clientType,
      platform: hello.data.platform,
      agentStreams: hello.data.agentStreams,
      capabilities,
      socket: socketFacade(conn),
      appVersion: hello.data.appVersion,
      transport: "relay",
    });
    session = created;

    const payload = serverInfoPayloadSchema.parse(deps.buildServerInfo());
    created.send(statusSchema.parse({ type: "status", payload }));
    deps.onSessionOpen(created);
    logger.info(
      {
        clientId: created.clientId,
        clientType: created.clientType,
        via: "relay",
        connectionId: conn.connectionId,
      },
      "ws client connected",
    );
  });

  conn.onBinary((bytes) => {
    if (session === null) return; // binary records before `hello` have no session to target
    deps.routeBinaryFrame(session, bytes, deps.binaryHandler);
  });

  conn.onClose((code) => {
    if (session === null) return;
    const closed = session;
    try {
      deps.onSessionClose(closed);
    } catch (err) {
      logger.warn(
        { err, clientId: closed.clientId },
        "onSessionClose callback threw; session teardown continues",
      );
    }
    logger.info(
      {
        clientId: closed.clientId,
        clientType: closed.clientType,
        via: "relay",
        connectionId: conn.connectionId,
        code,
        durationMs: Date.now() - connectedAt,
      },
      "ws client disconnected",
    );
  });
}
