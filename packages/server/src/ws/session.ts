import { supports } from "@av-pi-studio/protocol";
import type { WebSocket } from "ws";

/** `WebSocket.OPEN` (the `ws` package's readyState for an open socket). */
const WS_OPEN = 1;

/** What a connection receives of `agent_stream` frames (`hello.agentStreams`). */
export type AgentStreamMode = "all" | "none";

/**
 * The sessions that may receive an `agent_stream` frame: everyone except `"none"` sessions. Every
 * place that sends one MUST pass its audience through here (an absent mode counts as `"all"`).
 */
export function agentStreamRecipients(sessions: Iterable<Session>): Session[] {
  const out: Session[] = [];
  for (const session of sessions) {
    if (session.agentStreams !== "none") out.push(session);
  }
  return out;
}

/**
 * A per-connection session (architecture/websocket-protocol.md § Behavior). Holds the client
 * identity, the (rehydrated) capability set, and the socket. The wire boundary asks exactly one
 * question — `session.supports(flag)` — using the protocol gating helper.
 */
export class Session {
  readonly id: string;
  readonly clientId: string;
  readonly clientType: string;
  /** The hello's `platform` (e.g. `"desktop"`), verbatim when the client sent one. Informational. */
  readonly platform: string | undefined;
  /** The hello's `agentStreams` mode; fixed for the life of the connection. */
  readonly agentStreams: AgentStreamMode;
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
    platform?: string;
    agentStreams?: AgentStreamMode;
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
    this.platform = opts.platform;
    this.agentStreams = opts.agentStreams ?? "all";
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

  /**
   * Bytes queued on the socket and not yet flushed, or `undefined` when the socket cannot say (the
   * relay's stand-in socket forwards each frame into an encrypted channel and has no queue to
   * read). Bulk senders pace themselves on it; `undefined` means "do not pace".
   */
  get bufferedAmount(): number | undefined {
    const queued = (this.socket as { bufferedAmount?: unknown }).bufferedAmount;
    return typeof queued === "number" ? queued : undefined;
  }

  /** False once the socket is closing or closed. A socket with no `readyState` (relay) is open. */
  get isOpen(): boolean {
    const state = (this.socket as { readyState?: unknown }).readyState;
    return typeof state !== "number" || state === WS_OPEN;
  }

  close(code?: number, reason?: string): void {
    this.socket.close(code, reason);
  }
}
