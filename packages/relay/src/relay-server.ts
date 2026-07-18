/**
 * Standalone, runnable relay server (architecture/relay-e2ee.md § Purpose, § Behavior — Connection
 * setup; MAIN-SCOPE.md § 6 — "Relay | Remote access | WebSocket + NaCl box | Hosted or
 * self-hosted"). This is the **self-hosted** counterpart to `cf-adapter.ts`'s Cloudflare Workers
 * adapter: a plain Node WebSocket server wired to the same platform-agnostic `RelaySessionBridge`
 * (`session-bridge.ts`), runnable directly via `node`/`npx`/the `pi-studio relay` CLI command
 * (`packages/cli`).
 *
 * The relay is untrusted and zero-knowledge by construction: `RelaySessionBridge.attach()` never
 * inspects a socket's traffic past the registration frame, so this process structurally cannot
 * read, forge, or inject application messages — it only ever sees the `relay_register` frame,
 * connection metadata (IPs, timing, sizes), and (once a client attaches) the plaintext ephemeral
 * public key in the `e2ee_hello` handshake frame.
 */
import { createServer, type Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";

import { RelaySessionBridge, type RelaySocket } from "./session-bridge.js";

export interface RelayServerOptions {
  /** Interface to bind. Defaults to all interfaces (`0.0.0.0`) since the relay must accept
   *  connections dialed in from other hosts — unlike the daemon, which defaults to localhost. */
  host?: string;
  port: number;
}

export interface RelayServerHandle {
  readonly host: string;
  readonly port: number;
  readonly bridge: RelaySessionBridge;
  close(): Promise<void>;
}

const DEFAULT_RELAY_HOST = "0.0.0.0";

function wrapWsSocket(ws: WebSocket): RelaySocket {
  const messageHandlers: Array<(data: string) => void> = [];
  ws.on("message", (data: Buffer, isBinary: boolean) => {
    if (!isBinary) for (const h of messageHandlers) h(data.toString("utf8"));
  });
  return {
    send: (data) => {
      if (ws.readyState === ws.OPEN) ws.send(data);
    },
    onMessage: (h) => messageHandlers.push(h),
    onClose: (h) => ws.on("close", (code, reasonBuf: Buffer) => h(reasonBuf.toString("utf8") || `code ${code}`)),
    close: (code, reason) => ws.close(code, reason),
  };
}

/**
 * Start a self-hosted relay: a WebSocket server bridging connections by session id
 * (`RelaySessionBridge`), plus a bare `GET /health` HTTP endpoint (200 `ok`) for liveness probes.
 * Every WebSocket connection — daemon or client — is treated identically; the bridge doesn't
 * distinguish roles, only session ids (architecture/relay-e2ee.md § Behavior).
 */
export function startRelayServer(opts: RelayServerOptions): Promise<RelayServerHandle> {
  const host = opts.host ?? DEFAULT_RELAY_HOST;
  const bridge = new RelaySessionBridge();

  const httpServer: HttpServer = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("ok");
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ server: httpServer });
  wss.on("connection", (ws: WebSocket) => bridge.attach(wrapWsSocket(ws)));

  return new Promise<RelayServerHandle>((resolve, reject) => {
    httpServer.on("error", reject);
    httpServer.listen(opts.port, host, () => {
      httpServer.off("error", reject);
      const addr = httpServer.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : opts.port;
      resolve({
        host,
        port: actualPort,
        bridge,
        close: () =>
          new Promise<void>((resolveClosed) => {
            wss.close(() => httpServer.close(() => resolveClosed()));
          }),
      });
    });
  });
}
