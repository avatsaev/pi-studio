/**
 * Zero-knowledge relay session bridge (architecture/relay-e2ee.md § Purpose, § Channel API —
 * "Cloudflare adapter", § Error Handling). This is the platform-agnostic bridging core shared by
 * any relay server implementation (Cloudflare Workers adapter in `cf-adapter.ts`, or any other
 * host): it pairs sockets by session id and forwards every frame **verbatim** between the (at
 * most two) peers sharing a session id, without ever decrypting or even parsing app traffic.
 *
 * The bridge inspects ONLY the very first frame a socket sends, to detect the registration frame
 * `{ type: "relay_register", sessionId }` (matching the daemon/client sides built in task-002/003).
 * Every frame after that — including the `e2ee_hello`/`e2ee_ready` handshake and all `e2ee_app`
 * ciphertext frames — is forwarded byte-for-byte without inspection. This is exactly the trust
 * boundary the spec describes: "a compromised relay can see only metadata (IPs, timing, sizes,
 * session ids, and the plaintext public keys in the handshake) — never message contents, and it
 * cannot forge or inject commands."
 */

/** Minimal socket shape the bridge operates on — any transport satisfying this can be bridged. */
export interface RelaySocket {
  send(data: string): void;
  onMessage(handler: (data: string) => void): void;
  onClose(handler: (reason?: string) => void): void;
  close(code?: number, reason?: string): void;
}

/**
 * Metadata-only lifecycle hooks a relay host (e.g. `relay-server.ts`) can subscribe to for
 * operational logging. Every callback receives ONLY metadata the relay already legitimately sees
 * (session ids, peer counts, frame sizes) — never frame contents. Firing these hooks does not
 * weaken the zero-knowledge property: the bridge still parses nothing past the registration frame.
 */
export interface RelayBridgeEvents {
  /** A socket failed to present a valid registration frame as its first frame (silently ignored). */
  onRegisterRejected?(socket: RelaySocket): void;
  /** A socket registered under `sessionId`; `peers` is the session's socket count after adding. */
  onRegister?(socket: RelaySocket, sessionId: string, peers: number): void;
  /** A frame of `bytes` UTF-8 bytes was forwarded from one socket to a peer in `sessionId`. */
  onForward?(sessionId: string, bytes: number): void;
  /** A registered socket detached; `peers` is the session's socket count after removal. */
  onUnregister?(socket: RelaySocket, sessionId: string, peers: number): void;
}

function tryParseSessionId(data: string): string | null {
  try {
    const parsed = JSON.parse(data) as { type?: unknown; sessionId?: unknown };
    if (parsed.type === "relay_register" && typeof parsed.sessionId === "string" && parsed.sessionId) {
      return parsed.sessionId;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Pairs relay-attached sockets by session id and forwards non-registration frames verbatim between
 * every OTHER socket sharing that session id. One bridge instance serves an entire relay server
 * (or Cloudflare Durable Object instance); `attach()` is called once per newly accepted connection.
 */
export class RelaySessionBridge {
  private readonly sessions = new Map<string, Set<RelaySocket>>();

  constructor(private readonly events: RelayBridgeEvents = {}) {}

  /**
   * Attach a raw socket. Its first frame MUST be a registration frame or it is silently ignored
   * (never forwarded, never crashes the bridge) — an unregistered socket receives nothing and
   * forwards nothing.
   */
  attach(socket: RelaySocket): void {
    let sessionId: string | null = null;

    socket.onMessage((data) => {
      if (sessionId === null) {
        const parsedSessionId = tryParseSessionId(data);
        if (!parsedSessionId) {
          // not a registration frame; ignore malformed/unexpected input
          this.events.onRegisterRejected?.(socket);
          return;
        }
        sessionId = parsedSessionId;
        const peers = this.sessions.get(sessionId) ?? new Set<RelaySocket>();
        peers.add(socket);
        this.sessions.set(sessionId, peers);
        this.events.onRegister?.(socket, sessionId, peers.size);
        return;
      }
      // Forward verbatim to every OTHER socket sharing this session id. No JSON.parse, no
      // inspection — this frame may be the E2EE handshake or opaque ciphertext.
      for (const peer of this.sessions.get(sessionId) ?? []) {
        if (peer === socket) continue;
        peer.send(data);
        this.events.onForward?.(sessionId, data.length);
      }
    });

    socket.onClose(() => {
      if (sessionId === null) return;
      const peers = this.sessions.get(sessionId);
      if (!peers) return;
      peers.delete(socket);
      if (peers.size === 0) this.sessions.delete(sessionId);
      this.events.onUnregister?.(socket, sessionId, peers.size);
    });
  }

  /** Number of sockets currently registered under `sessionId` (observability / test helper). */
  peerCount(sessionId: string): number {
    return this.sessions.get(sessionId)?.size ?? 0;
  }
}
