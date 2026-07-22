import {
  decodeTerminalFrame,
  tryDecodeFileTransferFrame,
  FileTransferOpcode,
  type ClientType,
  type ServerInfoPayload,
  type SessionMessage,
  type TerminalFrame,
  type FileTransferFrame,
} from "@av-pi-studio/protocol";

import type { Transport } from "./transport.js";
import { createWebSocketTransport } from "./transport.js";

/**
 * Low-level `DaemonClient` WebSocket driver: connect, hello handshake, framing, RPC correlation,
 * ping/pong liveness, and a pluggable transport abstraction.
 *
 * See architecture/client-app-runtime.md § Connection and architecture/websocket-protocol.md
 * § Connection & handshake, § Top-level envelopes.
 *
 * Out of scope here: the `Pi-StudioClient` facade (task-002), relay transport (sprint-013), and the
 * terminal-stream router (task-003) — though this driver exposes the hooks the router rides on.
 */

/** Connection lifecycle states. */
export type ConnectionState = "idle" | "connecting" | "open" | "closing" | "closed";

/** The default wire protocol version this client speaks. */
export const PROTOCOL_VERSION = 1;

/** Portable random id — `crypto.randomUUID` where available (browser secure context, RN Hermes
 * 0.74+, Node 16+), else a timestamp+random fallback for insecure/older contexts. */
export function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface DaemonClientOptions {
  url: string;
  clientId: string;
  clientType: ClientType;
  protocolVersion?: number;
  appVersion?: string;
  capabilities?: Record<string, boolean>;
  /** Inject a transport (tests/relay). Defaults to a direct WebSocket transport. */
  transport?: Transport;
  /** Default RPC timeout (ms). RPC timeouts are operation errors, NOT socket deaths. */
  rpcTimeoutMs?: number;
  /** Optional clock for deterministic tests. */
  now?: () => number;
}

/** A pending RPC awaiting its correlated response. */
interface PendingRpc {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

/** A failed RPC surfaced from a correlated `rpc_error`. */
export class RpcError extends Error {
  constructor(
    message: string,
    readonly requestId: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

/** A timed-out RPC. Distinguished from a dead socket per the protocol contract. */
export class RpcTimeoutError extends Error {
  constructor(readonly requestId: string) {
    super(`RPC ${requestId} timed out`);
    this.name = "RpcTimeoutError";
  }
}

export type SessionMessageHandler = (message: SessionMessage) => void;
export type TerminalFrameHandler = (frame: TerminalFrame) => void;
export type FileTransferFrameHandler = (frame: FileTransferFrame) => void;
export type StateChangeHandler = (state: ConnectionState) => void;

export class DaemonClient {
  private readonly transport: Transport;
  private readonly rpcTimeoutMs: number;
  private readonly now: () => number;

  private _state: ConnectionState = "idle";
  private _serverId: string | null = null;
  private _features: Record<string, unknown> = {};
  private _serverCapabilities: Record<string, unknown> = {};

  private readonly pending = new Map<string, PendingRpc>();
  private readonly sessionHandlers = new Set<SessionMessageHandler>();
  private readonly terminalHandlers = new Set<TerminalFrameHandler>();
  private readonly fileTransferHandlers = new Set<FileTransferFrameHandler>();
  private readonly stateHandlers = new Set<StateChangeHandler>();

  private helloResolve: ((info: ServerInfoPayload) => void) | null = null;
  private helloReject: ((error: Error) => void) | null = null;

  constructor(private readonly options: DaemonClientOptions) {
    this.transport = options.transport ?? createWebSocketTransport();
    this.rpcTimeoutMs = options.rpcTimeoutMs ?? 30_000;
    this.now = options.now ?? (() => Date.now());

    this.transport.onMessage = (data) => this.handleIncoming(data);
    this.transport.onClose = (code, reason) => this.handleClose(code, reason);
    this.transport.onError = () => {
      /* surfaced via close / rpc errors; do not treat as fatal on its own */
    };
  }

  // ─── Public accessors ─────────────────────────────────────────────────────

  get state(): ConnectionState {
    return this._state;
  }
  get serverId(): string | null {
    return this._serverId;
  }
  get features(): Record<string, unknown> {
    return this._features;
  }
  get serverCapabilities(): Record<string, unknown> {
    return this._serverCapabilities;
  }
  /** True iff the daemon advertised the given `server_info.features.*` flag truthy. */
  hasFeature(flag: string): boolean {
    return Boolean(this._features[flag]);
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Open the socket, send `hello`, and await `status`/`server_info`. Resolves with the
   * recorded server info (serverId + features).
   */
  async connect(): Promise<ServerInfoPayload> {
    this.setState("connecting");
    await this.transport.connect(this.options.url);

    const handshake = new Promise<ServerInfoPayload>((resolve, reject) => {
      this.helloResolve = resolve;
      this.helloReject = reject;
    });

    this.transport.sendText(
      JSON.stringify({
        type: "hello",
        clientId: this.options.clientId,
        clientType: this.options.clientType,
        protocolVersion: this.options.protocolVersion ?? PROTOCOL_VERSION,
        appVersion: this.options.appVersion,
        capabilities: this.options.capabilities,
      }),
    );

    const info = await handshake;
    this._serverId = info.serverId;
    this._features = info.features;
    this._serverCapabilities = info.capabilities;
    this.setState("open");
    return info;
  }

  /** Close the socket cleanly. */
  close(code = 1000, reason = ""): void {
    this.setState("closing");
    this.transport.close(code, reason);
  }

  // ─── RPC / send ───────────────────────────────────────────────────────────

  /**
   * Send a correlated session RPC. Resolves with the response `payload` when a session message
   * carrying the same `requestId` arrives, rejects with `RpcError` on a correlated `rpc_error`,
   * and rejects with `RpcTimeoutError` (operation error only, socket stays alive) on timeout.
   */
  request<T = unknown>(
    type: string,
    params: Record<string, unknown> = {},
    timeoutMs?: number,
  ): Promise<T> {
    const requestId = (params.requestId as string | undefined) ?? randomId();
    return new Promise<T>((resolve, reject) => {
      const timeout = timeoutMs ?? this.rpcTimeoutMs;
      const timer =
        timeout > 0
          ? setTimeout(() => {
              this.pending.delete(requestId);
              reject(new RpcTimeoutError(requestId));
            }, timeout)
          : null;
      this.pending.set(requestId, {
        resolve: (payload) => resolve(payload as T),
        reject,
        timer,
      });
      this.sendSession({ type, ...params, requestId } as unknown as SessionMessage);
    });
  }

  /** Send a fire-and-forget session message (wrapped in a `session` envelope). */
  sendSession(message: SessionMessage): void {
    this.transport.sendText(JSON.stringify({ type: "session", message }));
  }

  /** Send a raw binary frame (terminal / file-transfer). */
  sendBinary(data: Uint8Array): void {
    this.transport.sendBinary(data);
  }

  /**
   * Send a JSON `ping` and await the correlated `pong`. Liveness rides on the data path because
   * browser/RN WebSocket APIs do not expose RFC6455 ping.
   */
  ping(timeoutMs = 10_000): Promise<void> {
    const requestId = randomId();
    return new Promise<void>((resolve, reject) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(requestId);
              reject(new RpcTimeoutError(requestId));
            }, timeoutMs)
          : null;
      this.pending.set(requestId, {
        resolve: () => resolve(),
        reject,
        timer,
      });
      this.transport.sendText(
        JSON.stringify({ type: "ping", requestId, clientSentAt: this.now() }),
      );
    });
  }

  // ─── Subscriptions ──────────────────────────────────────────────────────────

  /** Subscribe to all inbound session messages (e.g. `agent_stream`, `agent_update`). */
  onSessionMessage(handler: SessionMessageHandler): () => void {
    this.sessionHandlers.add(handler);
    return () => this.sessionHandlers.delete(handler);
  }

  /** Subscribe to decoded inbound terminal binary frames. */
  onTerminalFrame(handler: TerminalFrameHandler): () => void {
    this.terminalHandlers.add(handler);
    return () => this.terminalHandlers.delete(handler);
  }

  /** Subscribe to decoded inbound file-transfer binary frames (download/upload chunks). */
  onFileTransferFrame(handler: FileTransferFrameHandler): () => void {
    this.fileTransferHandlers.add(handler);
    return () => this.fileTransferHandlers.delete(handler);
  }

  /** Subscribe to connection-state transitions. */
  onStateChange(handler: StateChangeHandler): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  private setState(next: ConnectionState): void {
    if (this._state === next) return;
    this._state = next;
    for (const handler of this.stateHandlers) handler(next);
  }

  private handleClose(_code: number, reason: string): void {
    // Reject the in-flight handshake if the socket closed before server_info.
    if (this.helloReject) {
      this.helloReject(new Error(`socket closed during handshake: ${reason}`));
      this.helloResolve = null;
      this.helloReject = null;
    }
    // Reject all pending RPCs — the socket is gone (distinct from an RPC timeout).
    for (const [, pending] of this.pending) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new Error(`socket closed: ${reason}`));
    }
    this.pending.clear();
    this.setState("closed");
  }

  private handleIncoming(data: string | ArrayBuffer | Blob): void {
    if (typeof data === "string") {
      this.handleTextFrame(data);
      return;
    }
    if (data instanceof ArrayBuffer) {
      this.handleBinaryFrame(new Uint8Array(data));
      return;
    }
    // Blob (browser) — read asynchronously.
    if (typeof (data as Blob).arrayBuffer === "function") {
      void (data as Blob).arrayBuffer().then((buf) => this.handleBinaryFrame(new Uint8Array(buf)));
    }
  }

  /**
   * Route an inbound binary frame by its opcode byte: file-transfer opcodes (`0x10`–`0x13`) go to
   * `fileTransferHandlers`, everything else decodes as a terminal frame. Two independent binary
   * protocols share one opcode byte's numeric range without colliding — see
   * `@av-pi-studio/protocol`'s `TerminalOpcode` (`0x01`–`0x05`) vs `FileTransferOpcode`
   * (`0x10`–`0x13`).
   */
  private handleBinaryFrame(bytes: Uint8Array): void {
    const opcodeByte = bytes[0];
    const isFileTransfer =
      opcodeByte !== undefined &&
      Object.values(FileTransferOpcode).includes(opcodeByte as never);
    if (isFileTransfer) {
      const frame = tryDecodeFileTransferFrame(bytes);
      if (!frame) return; // malformed frame — drop rather than throw
      for (const handler of this.fileTransferHandlers) handler(frame);
      return;
    }
    const frame = decodeTerminalFrame(bytes);
    for (const handler of this.terminalHandlers) handler(frame);
  }

  private handleTextFrame(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return; // ignore malformed frames
    }
    const envelope = parsed as Record<string, unknown>;
    switch (envelope.type) {
      case "status":
        this.handleStatus(envelope);
        return;
      case "pong":
        this.resolvePending(envelope.requestId as string, undefined);
        return;
      case "ping":
        // Some daemons send keepalive pings; reply with a pong.
        this.transport.sendText(
          JSON.stringify({
            type: "pong",
            requestId: envelope.requestId,
            serverReceivedAt: this.now(),
            serverSentAt: this.now(),
          }),
        );
        return;
      case "session":
        this.handleSession(envelope.message as SessionMessage);
        return;
      default:
        return; // unknown top-level envelope — ignore
    }
  }

  private handleStatus(envelope: Record<string, unknown>): void {
    const payload = envelope.payload as ServerInfoPayload | undefined;
    if (payload?.status === "server_info" && this.helloResolve) {
      this.helloResolve(payload);
      this.helloResolve = null;
      this.helloReject = null;
    }
  }

  private handleSession(message: SessionMessage | undefined): void {
    if (!message || typeof message !== "object") return;
    const msg = message as unknown as Record<string, unknown>;

    // Correlated rpc_error → reject the matching pending RPC.
    if (msg.type === "rpc_error" && typeof msg.requestId === "string") {
      const pending = this.pending.get(msg.requestId);
      if (pending) {
        if (pending.timer) clearTimeout(pending.timer);
        this.pending.delete(msg.requestId);
        pending.reject(
          new RpcError(
            (msg.message as string) ?? (msg.error as string) ?? "RPC failed",
            msg.requestId,
            msg.code as string | undefined,
          ),
        );
      }
      return;
    }

    // Correlated response → resolve the matching pending RPC (and still fan out).
    if (typeof msg.requestId === "string" && this.pending.has(msg.requestId)) {
      const payload = "payload" in msg ? msg.payload : msg;
      this.resolvePending(msg.requestId, payload);
    }

    // Fan out to subscribers (streams, updates, uncorrelated broadcasts).
    for (const handler of this.sessionHandlers) handler(message);
  }

  private resolvePending(requestId: string, payload: unknown): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    this.pending.delete(requestId);
    pending.resolve(payload);
  }
}
