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
  /** Epoch ms of the handshake. A wall-clock fact for the connected-clients list. */
  readonly connectedAt: number;
  /** The hello's `appVersion`, verbatim; a connection fact (never persisted as a capability). */
  readonly appVersion: string | undefined;
  /** Socket peer address; direct sessions only (the relay has no peer address). */
  readonly remoteAddress: string | undefined;
  readonly transport: "direct" | "relay";
  private readonly socket: WebSocket;

  constructor(opts: {
    id: string;
    clientId: string;
    clientType: string;
    capabilities: Record<string, boolean>;
    socket: WebSocket;
    connectedAt?: number;
    appVersion?: string;
    remoteAddress?: string;
    transport?: "direct" | "relay";
  }) {
    this.id = opts.id;
    this.clientId = opts.clientId;
    this.clientType = opts.clientType;
    this.capabilities = opts.capabilities;
    this.connectedAt = opts.connectedAt ?? Date.now();
    this.appVersion = opts.appVersion;
    this.remoteAddress = opts.remoteAddress;
    this.transport = opts.transport ?? "direct";
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
