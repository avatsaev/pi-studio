// Run with `node --test 'apps/ipc-bench/page/*.test.mjs'` from `desktop/`. The vectors are the ones in
// `crates/net/src/codec.rs`.
import assert from "node:assert/strict";
import test from "node:test";
import { ITEM_HEADER, KIND_BINARY, KIND_TEXT, MAX_MESSAGE, decodeText, encodeBatch, forEachItem, utf8Length } from "./batch.js";

const items = (batch) => {
  const out = [];
  forEachItem(batch.buffer.slice(batch.byteOffset, batch.byteOffset + batch.byteLength), (kind, start, end) => out.push([kind, start, end]));
  return out;
};

test("layout is kind, little-endian length, payload (the Rust vector)", () => {
  const batch = encodeBatch([
    { kind: KIND_TEXT, data: "hi" },
    { kind: KIND_BINARY, data: new Uint8Array([9, 8, 7]) },
  ]);
  assert.deepEqual([...batch], [1, 2, 0, 0, 0, 104, 105, 2, 3, 0, 0, 0, 9, 8, 7]);
  assert.deepEqual(items(batch), [
    [KIND_TEXT, 5, 7],
    [KIND_BINARY, 12, 15],
  ]);
});

test("a text item is UTF-8 and round-trips", () => {
  const text = "héllo ☃ \u{1F600}";
  const batch = encodeBatch([{ kind: KIND_TEXT, data: text }]);
  assert.equal(batch.byteLength, ITEM_HEADER + utf8Length(text));
  const [[, start, end]] = items(batch);
  assert.equal(decodeText(batch.buffer, start, end), text);
});

test("utf8Length matches the encoder, for every kind of character", () => {
  const encoder = new TextEncoder();
  for (const text of ["", "a", "é", "☃", "\u{1F600}", "a\u{1F600}b☃é", "x".repeat(1000), "\ud800", "\udc00x"]) {
    // A lone surrogate encodes as U+FFFD (three bytes), which is what the count says too.
    assert.equal(utf8Length(text), encoder.encode(text).length, JSON.stringify(text));
  }
});

test("an empty batch and an empty payload are fine", () => {
  assert.deepEqual(items(encodeBatch([])), []);
  assert.deepEqual(items(encodeBatch([{ kind: KIND_BINARY, data: new Uint8Array(0) }])), [[KIND_BINARY, 5, 5]]);
});

test("a bad batch is a RangeError that says where", () => {
  const walk = (bytes) => forEachItem(new Uint8Array(bytes).buffer, () => {});
  assert.throws(() => walk([3, 0, 0, 0, 0]), /unknown kind 3/);
  assert.throws(() => walk([2, 1, 0]), /ends inside the item at byte 0/);
  assert.throws(() => walk([2, 9, 0, 0, 0, 1]), /ends inside the item at byte 0/);
  // An empty binary item, a one-byte text item, then bytes that are not an item: the error names byte 11.
  assert.throws(() => walk([2, 0, 0, 0, 0, 1, 1, 0, 0, 0, 65, 0, 0, 0, 1, 0]), /item at byte 11 has unknown kind 0/);
  assert.throws(() => walk([2, 0xff, 0xff, 0xff, 0xff]), /above the 134217728-byte limit/);
  assert.equal(MAX_MESSAGE, 134217728);
});

test("text that is not UTF-8 is refused", () => {
  const batch = new Uint8Array([1, 1, 0, 0, 0, 0xff]);
  const [[, start, end]] = items(batch);
  assert.throws(() => decodeText(batch.buffer, start, end));
});
