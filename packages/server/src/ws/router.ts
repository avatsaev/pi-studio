import { pongSchema } from "@av-pi-studio/protocol";

import type { Session } from "./session.js";

/**
 * Frame router + handler registry (architecture/websocket-protocol.md § Behavior, § Error Handling,
 * § RPC naming).
 *
 * Text frames are parsed as top-level envelopes: `ping` is answered with `pong` (liveness over the
 * data path — an RPC timeout is an operation failure and must NOT close the socket); `session`
 * envelopes are dispatched to a registered handler by message `type`. A handler that throws yields
 * an `rpc_error` correlated by `requestId`. Unknown types with a `requestId` get an `rpc_error`;
 * otherwise they are ignored.
 */

export interface RpcHandlerContext {
  session: Session;
  message: Record<string, unknown>;
  requestId?: string;
}

/** A handler returns a response message (wrapped + correlated by the router) or `undefined`. */
export type RpcHandler = (ctx: RpcHandlerContext) => unknown | Promise<unknown>;

export type BinaryHandler = (session: Session, bytes: Uint8Array) => void;

/** Registry of RPC handlers keyed by message type, with legacy flat-name aliases. */
export class HandlerRegistry {
  private readonly handlers = new Map<string, RpcHandler>();
  private readonly aliases = new Map<string, string>();

  /** Register a handler for a canonical (dotted) message type. */
  register(type: string, handler: RpcHandler): this {
    this.handlers.set(type, handler);
    return this;
  }

  /** Map a legacy flat name to a canonical type so both names resolve to the same handler. */
  registerAlias(alias: string, canonical: string): this {
    this.aliases.set(alias, canonical);
    return this;
  }

  get(type: string): RpcHandler | undefined {
    return this.handlers.get(type) ?? this.handlers.get(this.aliases.get(type) ?? "");
  }
}

function sendRpcError(session: Session, requestId: string, code: string, message: string): void {
  session.send({ type: "session", message: { type: "rpc_error", requestId, code, message } });
}

async function dispatchSessionMessage(
  session: Session,
  message: Record<string, unknown>,
  registry: HandlerRegistry,
): Promise<void> {
  const type = typeof message.type === "string" ? message.type : undefined;
  const requestId = typeof message.requestId === "string" ? message.requestId : undefined;
  if (!type) return;

  const handler = registry.get(type);
  if (!handler) {
    // Unknown type → rpc_error if it expected a reply, otherwise ignore (handler policy).
    if (requestId)
      sendRpcError(session, requestId, "unknown_message_type", `no handler for ${type}`);
    return;
  }

  try {
    const result = await handler({ session, message, requestId });
    if (result !== undefined) {
      const response =
        requestId &&
        typeof result === "object" &&
        result !== null &&
        (result as Record<string, unknown>).requestId === undefined
          ? { ...(result as Record<string, unknown>), requestId }
          : result;
      session.send({ type: "session", message: response });
    }
  } catch (error) {
    // A handler failure (including a timeout) is an operation error, never a dead socket.
    if (requestId) {
      sendRpcError(session, requestId, "handler_error", (error as Error)?.message ?? String(error));
    }
  }
}

/** Route a text frame received after the handshake. */
export async function routeTextFrame(
  session: Session,
  text: string,
  registry: HandlerRegistry,
): Promise<void> {
  let envelope: unknown;
  try {
    envelope = JSON.parse(text);
  } catch {
    return; // ignore non-JSON
  }
  if (!envelope || typeof envelope !== "object") return;
  const env = envelope as Record<string, unknown>;

  switch (env.type) {
    case "ping": {
      const now = Date.now();
      const pong = pongSchema.safeParse({
        type: "pong",
        requestId: env.requestId,
        clientSentAt: env.clientSentAt,
        serverReceivedAt: now,
        serverSentAt: Date.now(),
      });
      if (pong.success) session.send(pong.data);
      return;
    }
    case "pong":
      return; // liveness ack from client — nothing to do
    case "session": {
      const message = env.message;
      if (message && typeof message === "object") {
        await dispatchSessionMessage(session, message as Record<string, unknown>, registry);
      }
      return;
    }
    default:
      return; // unknown top-level type → ignore
  }
}

/** Route a binary frame (terminal/file streams). Decoding handlers are registered by later sprints. */
export function routeBinaryFrame(
  session: Session,
  bytes: Uint8Array,
  binaryHandler?: BinaryHandler,
): void {
  binaryHandler?.(session, bytes);
}
