// The frame batch of the bridge candidates: whole WebSocket messages, each marked text or binary, as
// items `[kind: 1 byte][length: 4 bytes, little-endian][payload]` (kind 1 text, kind 2 binary). The
// same format as `desktop/crates/net/src/codec.rs`; the vectors in `batch.test.mjs` are the ones in
// the Rust tests.

export const KIND_TEXT = 1;
export const KIND_BINARY = 2;
export const ITEM_HEADER = 5;
/** The largest message the spec allows, in either direction. */
export const MAX_MESSAGE = 128 * 1024 * 1024;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/** The length of `text` in UTF-8 bytes (what a WebSocket text frame carries), without encoding it. */
export function utf8Length(text) {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      // A surrogate pair is one code point of four bytes.
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/** `items` (`{ kind, data }`: a string for text, a Uint8Array for binary) as one batch, a Uint8Array. */
export function encodeBatch(items) {
  const prepared = items.map(({ kind, data }) => ({ kind, bytes: kind === KIND_TEXT ? encoder.encode(data) : data }));
  let total = 0;
  for (const { bytes } of prepared) {
    if (bytes.byteLength > MAX_MESSAGE) throw new RangeError(`a message of ${bytes.byteLength} bytes is above the ${MAX_MESSAGE}-byte limit`);
    total += ITEM_HEADER + bytes.byteLength;
  }
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let pos = 0;
  for (const { kind, bytes } of prepared) {
    out[pos] = kind;
    view.setUint32(pos + 1, bytes.byteLength, true);
    out.set(bytes, pos + ITEM_HEADER);
    pos += ITEM_HEADER + bytes.byteLength;
  }
  return out;
}

/**
 * Walks a batch (an ArrayBuffer) and calls `visit(kind, start, end)` for each item, in order, with
 * the payload's range. Throws a `RangeError` that says where the batch is wrong: an unknown kind, a
 * length past the end or past the limit.
 */
export function forEachItem(buffer, visit) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let pos = 0;
  while (pos < bytes.length) {
    if (bytes.length - pos < ITEM_HEADER) throw new RangeError(`the batch ends inside the item at byte ${pos}`);
    const kind = bytes[pos];
    if (kind !== KIND_TEXT && kind !== KIND_BINARY) throw new RangeError(`the item at byte ${pos} has unknown kind ${kind}`);
    const length = view.getUint32(pos + 1, true);
    if (length > MAX_MESSAGE) throw new RangeError(`the item at byte ${pos} is ${length} bytes, above the ${MAX_MESSAGE}-byte limit`);
    const start = pos + ITEM_HEADER;
    const end = start + length;
    if (end > bytes.length) throw new RangeError(`the batch ends inside the item at byte ${pos}`);
    visit(kind, start, end);
    pos = end;
  }
}

/** The text of a batch item's payload (UTF-8; throws on bytes that are not). */
export function decodeText(buffer, start, end) {
  return decoder.decode(new Uint8Array(buffer, start, end - start));
}
