import { createWebSocketTransport, type Transport } from "@av-pi-studio/client";

import { type Ipc } from "./ipc.js";

/**
 * Shown when the page's socket to Rust's loopback address does not open (decision T5). It never
 * carries the address: the address holds the single-use token.
 */
export const LOCAL_CONNECTION_MESSAGE =
  "Pi Studio could not open its own local connection. Security software may be blocking 127.0.0.1; allow Pi Studio to use the loopback address and try again.";

function commandMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    const { message } = error as { message: unknown };
    if (typeof message === "string") return message;
  }
  return "The connection could not be opened.";
}

function localUrlOf(answer: unknown): string | undefined {
  if (typeof answer !== "object" || answer === null) return undefined;
  const { localUrl } = answer as { localUrl?: unknown };
  return typeof localUrl === "string" ? localUrl : undefined;
}

/**
 * A `Transport` that asks Rust (`transport_open`) where to connect, then is the SDK's own
 * WebSocket transport pointed at the loopback address Rust answered. Every member but `connect`
 * is the inner transport's; each `connect` (also after a close) is a new `transport_open`.
 */
export function createProxiedTransport(
  ipc: Ipc,
  createInner: () => Transport = createWebSocketTransport,
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
      let answer: unknown;
      try {
        answer = await ipc.invoke("transport_open", { url });
      } catch (error) {
        throw new Error(commandMessage(error));
      }
      const localUrl = localUrlOf(answer);
      if (localUrl === undefined) throw new Error(LOCAL_CONNECTION_MESSAGE);
      try {
        await inner.connect(localUrl);
      } catch {
        throw new Error(LOCAL_CONNECTION_MESSAGE);
      }
    },
  };
}
