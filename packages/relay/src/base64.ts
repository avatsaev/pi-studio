/**
 * Pure-JS base64 codec (no Node `Buffer`) so the relay's crypto framing runs identically in the
 * daemon (Node) and future browser/RN clients — see architecture/relay-e2ee.md § Behavior
 * (per-message wire format uses `base64([nonce] ++ ciphertext)`).
 */

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Encode raw bytes as standard (padded) base64. */
export function encodeBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const hasB1 = i + 1 < bytes.length;
    const hasB2 = i + 2 < bytes.length;
    const b1 = hasB1 ? bytes[i + 1]! : 0;
    const b2 = hasB2 ? bytes[i + 2]! : 0;
    out += CHARS[b0 >> 2];
    out += CHARS[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += hasB1 ? CHARS[((b1 & 0x0f) << 2) | (b2 >> 6)] : "=";
    out += hasB2 ? CHARS[b2 & 0x3f] : "=";
  }
  return out;
}

/** Decode standard base64 (padded or not) into raw bytes. Throws on invalid characters. */
export function decodeBase64(input: string): Uint8Array {
  const clean = input.replace(/=+$/, "");
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    const val = CHARS.indexOf(ch);
    if (val === -1) throw new Error(`invalid base64 character: ${JSON.stringify(ch)}`);
    buffer = (buffer << 6) | val;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}
