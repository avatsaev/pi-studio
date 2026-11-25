import type { WebSocket, WebSocketServer } from "ws";

import type { Logger } from "../logging/logger.js";

/**
 * Liveness of the direct sockets (audit finding T2): a peer that vanished without closing (a
 * sleeping laptop, a dropped network) leaves a half-open socket that only the kernel's own timeout
 * ends, hours later; until then it stays a session, in `daemon_status`, with its subscriptions.
 *
 * Every `intervalMs` each open socket is sent a protocol-level ping. A socket that has shown no
 * life since the previous ping (a pong, a ping of its own or any message) is terminated, which
 * runs the normal close path of `createWebSocketServer`. A silent peer is therefore gone within two
 * intervals. Browsers, `ws` and tungstenite answer a ping by themselves; the JSON `ping`/`pong`
 * messages are separate and untouched. Relay sockets have their own silence timer.
 *
 * A socket the server has stopped reading (`pause()`, the back-pressure of an upload) cannot show
 * life, so it is neither pinged nor judged until it reads again.
 *
 * Returns a function that stops the sweep.
 */
export function watchLiveness(
  wss: WebSocketServer,
  intervalMs: number,
  logger?: Logger,
): () => void {
  /** Sockets pinged and not heard from since. */
  const silent = new WeakSet<WebSocket>();

  const track = (ws: WebSocket): void => {
    const heard = (): void => void silent.delete(ws);
    ws.on("pong", heard);
    ws.on("ping", heard);
    ws.on("message", heard);
  };
  wss.on("connection", track);

  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      // A closing socket is on its way out by itself (`ws` bounds the close handshake).
      if (ws.readyState !== ws.OPEN) continue;
      if (ws.isPaused) {
        silent.delete(ws);
        continue;
      }
      if (silent.has(ws)) {
        logger?.warn(
          { intervalMs },
          "ws client sent nothing since the previous ping; terminating the connection",
        );
        ws.terminate();
        continue;
      }
      silent.add(ws);
      ws.ping();
    }
  }, intervalMs);
  timer.unref();

  return () => {
    clearInterval(timer);
    wss.off("connection", track);
  };
}
