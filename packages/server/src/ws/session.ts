import { supports } from "@av-pi-studio/protocol";
import type { WebSocket } from "ws";

/**
 * A per-connection session (architecture/websocket-protocol.md § Behavior). Holds the client
 * identity, the (rehydrated) capability set, and the socket. The wire boundary asks exactly one
 * question — `session.supports(flag)` — using the protocol gating helper.
 */
export class Session {
  readonly id: string;
  readonly clientId: string;
  readonly clientType: string;
  capabilities: Record<string, boolean>;
  private readonly socket: WebSocket;

  constructor(opts: {
    id: string;
    clientId: string;
    clientType: string;
    capabilities: Record<string, boolean>;
    socket: WebSocket;
  }) {
    this.id = opts.id;
    this.clientId = opts.clientId;
    this.clientType = opts.clientType;
    this.capabilities = opts.capabilities;
    this.socket = opts.socket;
  }

  /** True if the client advertised support for `flag` (or it was rehydrated from a prior hello). */
  supports(flag: string): boolean {
    return supports(this.capabilities, flag);
  }

  /** Send a top-level envelope as a JSON text frame. */
  send(envelope: unknown): void {
    this.socket.send(JSON.stringify(envelope));
  }

  /** Send raw bytes as a binary frame (terminal/file streams). */
  sendBinary(bytes: Uint8Array): void {
    this.socket.send(bytes);
  }

  close(code?: number, reason?: string): void {
    this.socket.close(code, reason);
  }
}
