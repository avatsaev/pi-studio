/**
 * Portable random-id generator (pane ids, optimistic-echo `clientMessageId`s, Mermaid DOM ids).
 * `crypto.randomUUID` requires a secure context, which a page served over plain http on a LAN
 * address (a LAN IP or hostname instead of localhost) does not satisfy;
 * there `crypto.randomUUID` is `undefined` and calling it throws
 * `TypeError: crypto.randomUUID is not a function` (real regression, not hypothetical — mirrors
 * `host/browser-clipboard.ts`'s `navigator.clipboard` fallback and `@av-pi-studio/client`'s `randomId()`).
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
