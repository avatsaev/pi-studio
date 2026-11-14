/**
 * Portable random-id generator (pane ids, optimistic-echo `clientMessageId`s, Mermaid DOM ids).
 * `crypto.randomUUID` requires a secure context, which plain-http access to a self-hosted daemon
 * over a LAN — the deployment `pi-studio ui` documents and defaults to (127.0.0.1, but users
 * routinely reach it via a LAN IP or hostname to view it from another device) — does not satisfy;
 * there `crypto.randomUUID` is `undefined` and calling it throws
 * `TypeError: crypto.randomUUID is not a function` (real regression, not hypothetical — mirrors
 * `clipboard.ts`'s `navigator.clipboard` fallback and `@av-pi-studio/client`'s `randomId()`).
 *
 * `crypto.getRandomValues` has no such restriction (available in every context WebCrypto ships
 * in at all), so it is preferred over `randomUUID` here rather than falling straight to
 * `Math.random`. Falls back to a timestamp+`Math.random` id only when `crypto` itself is
 * unavailable.
 */
export function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    // RFC 4122 version 4 / variant bits, matching what `crypto.randomUUID` itself produces.
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
