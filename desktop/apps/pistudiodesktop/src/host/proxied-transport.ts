import { createWebSocketTransport, RelayConnectError, type RelayConnectReason, type Transport } from "@av-pi-studio/client";

import { type Ipc } from "./ipc.js";

/**
 * Shown when the page's socket to Rust's loopback address does not open (decision T5). It never
 * carries the address: the address holds the single-use token.
 */
export const LOCAL_CONNECTION_MESSAGE =
  "Pi Studio could not open its own local connection. Security software may be blocking 127.0.0.1; allow Pi Studio to use the loopback address and try again.";

const RELAY_REASONS: ReadonlySet<string> = new Set<RelayConnectReason>([
  "daemon_offline",
  "daemon_unresponsive",
  "too_many_clients",
  "daemon_outdated",
  "timeout",
  "wrong_key",
  "relay_unreachable",
  "protocol_error",
]);

/** The SDK's relay reason a refused `transport_open` carries as its `code`, if it carries one. */
function relayReasonOf(error: unknown): RelayConnectReason | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const { code } = error as { code: unknown };
  return typeof code === "string" && RELAY_REASONS.has(code) ? (code as RelayConnectReason) : undefined;
}

function commandMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    const { message } = error as { message: unknown };
    if (typeof message === "string") return message;
  }
  return "The connection could not be opened.";
}

/** The close code of a connection that never opened: what the SDK's own transport reports (RFC 6455, 1006). */
const NEVER_OPENED = 1006;

function localUrlOf(answer: unknown): string | undefined {
  if (typeof answer !== "object" || answer === null) return undefined;
  const { localUrl } = answer as { localUrl?: unknown };
  return typeof localUrl === "string" ? localUrl : undefined;
}

/**
 * A `Transport` that asks Rust (`transport_open`) where to connect, then is the SDK's own
 * WebSocket transport pointed at the loopback address Rust answered. Every member but `connect`
 * is the inner transport's; each `connect` (also after a close) is a new `transport_open`. With
 * `relay` set, a refusal whose code is one of the SDK's relay reasons rejects with a
 * `RelayConnectError`, so the workbench shows the relay's own message.
 */
export function createProxiedTransport(
  ipc: Ipc,
  createInner: () => Transport = createWebSocketTransport,
  relay = false,
): Transport {
  const inner = createInner();
  return {
    get onMessage() {
      return inner.onMessage;
    },
    set onMessage(handler) {
      inner.onMessage = handler;
    },
    get onClose() {
      return inner.onClose;
    },
    set onClose(handler) {
      inner.onClose = handler;
    },
    get onError() {
      return inner.onError;
    },
    set onError(handler) {
      inner.onError = handler;
    },
    get isOpen() {
      return inner.isOpen;
    },
    get bufferedAmount() {
      return inner.bufferedAmount;
    },
    sendText: (data) => inner.sendText(data),
    sendBinary: (data) => inner.sendBinary(data),
    close: (code, reason) => inner.close(code, reason),
    async connect(url) {
      // A refused `transport_open` is a connection that never opened. The SDK's own transport
      // reports that as a close after the rejection, and the daemon client leaves "connecting"
      // (so the bar shows the message and Retry, and the reconnect ladder runs) only on a close.
      const neverOpened = (message: string, reason?: RelayConnectReason): Error => {
        inner.onClose?.(NEVER_OPENED, "");
        return reason === undefined ? new Error(message) : new RelayConnectError(reason);
      };
      let answer: unknown;
      try {
        answer = await ipc.invoke("transport_open", { url });
      } catch (error) {
        throw neverOpened(commandMessage(error), relay ? relayReasonOf(error) : undefined);
      }
      const localUrl = localUrlOf(answer);
      if (localUrl === undefined) throw neverOpened(LOCAL_CONNECTION_MESSAGE);
      try {
        await inner.connect(localUrl);
      } catch {
        throw new Error(LOCAL_CONNECTION_MESSAGE);
      }
    },
  };
}
