/**
 * Pluggable transport abstraction — direct WebSocket and (future) relay E2EE share this API.
 * See architecture/client-app-runtime.md § Layered client library.
 */

export type TransportMessageHandler = (data: string | ArrayBuffer | Blob) => void;
export type TransportCloseHandler = (code: number, reason: string) => void;
export type TransportErrorHandler = (error: unknown) => void;

export interface Transport {
  /** Initiate the connection. Resolves when the socket is open (raw, pre-handshake). */
  connect(url: string): Promise<void>;
  /** Send a text frame. */
  sendText(data: string): void;
  /** Send a binary frame. */
  sendBinary(data: Uint8Array): void;
  /** Close the transport cleanly. */
  close(code?: number, reason?: string): void;
  /** Whether the transport is currently open and writeable. */
  readonly isOpen: boolean;

  onMessage: TransportMessageHandler | null;
  onClose: TransportCloseHandler | null;
  onError: TransportErrorHandler | null;
}

// ─── Browser / Node WebSocket transport ────────────────────────────────────────

export type AnyWebSocket = {
  readyState: number;
  send(data: string | ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  /** Browsers/RN default this to `"blob"`; Node's `ws` ignores it (always delivers `Buffer`).
   * `connect()` forces `"arraybuffer"` where the property exists — see its comment for why. */
  binaryType?: string;
};

export type WsFactory = (url: string, protocols?: string[]) => AnyWebSocket;

// Node `ws` compatibility: ws closes have reason as Buffer, not string.
export function reasonString(reason: unknown): string {
  if (typeof reason === "string") return reason;
  if (reason instanceof Uint8Array || Buffer.isBuffer(reason)) return reason.toString("utf8");
  return String(reason ?? "");
}

/**
 * Create a direct WebSocket transport using the supplied factory.
 * Default factory uses the global `WebSocket` (browser/RN/Node 22+) or throws.
 */
export function createWebSocketTransport(factory?: WsFactory): Transport {
  let ws: AnyWebSocket | null = null;
  const self: Transport = {
    onMessage: null,
    onClose: null,
    onError: null,
    get isOpen(): boolean {
      return ws !== null && ws.readyState === 1; // OPEN
    },
    connect(url: string): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        const create = factory ?? (() => new WebSocket(url) as unknown as AnyWebSocket);
        try {
          ws = factory ? create(url) : (new WebSocket(url) as unknown as AnyWebSocket);
          // Force synchronous `ArrayBuffer` delivery. Browsers/RN default `binaryType` to
          // `"blob"`, which forces `DaemonClient.handleIncoming` onto an async
          // `Blob.arrayBuffer()` decode per message — and that decode's resolution order across
          // independent Blobs is NOT guaranteed to match wire order. For a multi-frame binary
          // transfer (file-transfer chunks, terminal frames) that race can let a later frame's
          // decode finish before an earlier one's, reordering what `FileTransferClient.dispatch()`
          // sees and silently dropping chunks once `End` deletes the stream's pending state before
          // a straggling `Chunk` arrives (real bug: truncated downloaded images, bottom rows
          // missing). `ws` (Node) always delivers `Buffer`/`ArrayBuffer` synchronously regardless
          // of this property; setting it there is a harmless no-op.
          ws.binaryType = "arraybuffer";
        } catch (err) {
          reject(err);
          return;
        }
        ws.onopen = () => resolve();
        ws.onerror = (ev) => {
          if (ws?.readyState !== 1) {
            reject(ev);
          }
          self.onError?.(ev);
        };
        ws.onclose = (ev) => {
          self.onClose?.(ev.code, reasonString(ev.reason));
        };
        ws.onmessage = (ev) => {
          const { data } = ev;
          if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
            self.onMessage?.(data as ArrayBuffer);
          } else if (typeof data === "string") {
            self.onMessage?.(data);
          } else if (typeof Blob !== "undefined" && data instanceof Blob) {
            // Unreachable once `binaryType = "arraybuffer"` takes effect (set above) — kept as a
            // defensive fallback for a WebSocket-like object that ignores the property, so binary
            // frames still decode (via `DaemonClient.handleIncoming`'s async `Blob.arrayBuffer()`
            // path) instead of being silently dropped, rather than as the expected delivery mode.
            self.onMessage?.(data);
          } else if (Buffer.isBuffer(data)) {
            // Node `ws` may deliver Buffer
            self.onMessage?.(
              data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
            );
          }
        };
      });
    },
    sendText(data: string): void {
      ws?.send(data);
    },
    sendBinary(data: Uint8Array): void {
      ws?.send(data);
    },
    close(code = 1000, reason = ""): void {
      ws?.close(code, reason);
      ws = null;
    },
  };
  return self;
}
