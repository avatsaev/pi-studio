import { pongSchema } from "@av-pi-studio/protocol";

import type { Logger } from "../logging/logger.js";
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
  /**
   * Run `fn` once the router has sent this handler's reply. A handler that must put frames on the
   * wire strictly after its answer (a download's binary stream) schedules them here instead of
   * sending them from inside the awaited handler. Not run when the handler throws; a throwing `fn`
   * is logged and never reaches the client as an `rpc_error`.
   */
  afterReply(fn: () => void): void;
}

/** A handler returns a response message (wrapped + correlated by the router) or `undefined`. */
export type RpcHandler = (ctx: RpcHandlerContext) => unknown | Promise<unknown>;

export type BinaryHandler = (session: Session, bytes: Uint8Array) => void;

/** Registry of RPC handlers keyed by message type. */
export class HandlerRegistry {
  private readonly handlers = new Map<string, RpcHandler>();
  private accepting = true;

  /**
   * @param logger Optional operational logger. When present, every dispatched RPC is logged at
   * `debug` (type, requestId, clientId, durationMs) and handler failures at `warn` — one
   * instrumentation point covering the entire RPC surface instead of per-handler logging.
   */
  constructor(readonly logger?: Logger) {}

  /** Register a handler for a canonical (dotted) message type. */
  register(type: string, handler: RpcHandler): this {
    this.handlers.set(type, handler);
    return this;
  }

  get(type: string): RpcHandler | undefined {
    return this.handlers.get(type);
  }

  /** False once {@link stopAccepting} was called. */
  get isAccepting(): boolean {
    return this.accepting;
  }

  /**
   * Shutdown began: every later session message is refused — a request gets `rpc_error`
   * `shutting_down`, anything else is dropped — and no handler runs. A `ping` is still answered.
   * Requests already running finish. Irreversible.
   */
  stopAccepting(): void {
    this.accepting = false;
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

  if (!registry.isAccepting) {
    if (requestId) sendRpcError(session, requestId, "shutting_down", "the daemon is shutting down");
    return;
  }

  const handler = registry.get(type);
  if (!handler) {
    // Unknown type → rpc_error if it expected a reply, otherwise ignore (handler policy).
    if (requestId)
      sendRpcError(session, requestId, "unknown_message_type", `no handler for ${type}`);
    registry.logger?.debug({ type, requestId, clientId: session.clientId }, "rpc: no handler");
    return;
  }

  const startedAt = Date.now();
  try {
    const afterReply: Array<() => void> = [];
    const result = await handler({
      session,
      message,
      requestId,
      afterReply: (fn) => afterReply.push(fn),
    });
    registry.logger?.debug(
      { type, requestId, clientId: session.clientId, durationMs: Date.now() - startedAt },
      "rpc ok",
    );
    try {
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
    } finally {
      // Hooks run even when the send threw (a closed socket) so they can release what they hold.
      for (const fn of afterReply) {
        try {
          fn();
        } catch (error) {
          registry.logger?.warn(
            { type, requestId, clientId: session.clientId, err: (error as Error)?.message },
            "rpc after-reply hook failed",
          );
        }
      }
    }
  } catch (error) {
    // A handler failure (including a timeout) is an operation error, never a dead socket.
    registry.logger?.warn(
      {
        type,
        requestId,
        clientId: session.clientId,
        durationMs: Date.now() - startedAt,
        err: (error as Error)?.message ?? String(error),
      },
      "rpc handler error",
    );
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
