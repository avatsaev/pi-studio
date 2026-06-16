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

type AnyWebSocket = {
  readyState: number;
  send(data: string | ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
};

type WsFactory = (url: string, protocols?: string[]) => AnyWebSocket;

// Node `ws` compatibility: ws closes have reason as Buffer, not string.
function reasonString(reason: unknown): string {
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
