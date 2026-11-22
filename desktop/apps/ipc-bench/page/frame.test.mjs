// Run with `node --test desktop/apps/ipc-bench/page/frame.test.mjs` (no npm package: Node's own test
// runner). The vectors are the ones in `src/frame.rs`.
import assert from "node:assert/strict";
import test from "node:test";
import { StreamCheck, binaryFrame, binaryTemplate, hashAscii, hashWords, hex, textFrame, textTemplate } from "./frame.js";

const words = (bytes) => new Uint32Array(new Uint8Array(bytes).buffer);

test("hash vectors", () => {
  assert.equal(hex(hashWords(words([]))), "811c9dc5");
  assert.equal(hex(hashWords(words([1, 0, 0, 0]))), "040c5b8c");
  assert.equal(hex(hashWords(words([1, 2, 3, 4, 5, 6, 7, 8]))), "a3b25cab");
  assert.equal(hex(hashAscii("\x01\x02\x03\x04\x05\x06\x07\x08\x09")), "a3b25cab");
});

test("frame vectors", () => {
  const { frame, sum } = binaryFrame(new Uint8Array(12), 3);
  assert.deepEqual([...frame.slice(0, 4)], [3, 0, 0, 0]);
  assert.equal(hex(sum), "37791236");
  const text = textFrame("abcdefghi", 41);
  assert.equal(text.frame.slice(0, 11), "0000000041:");
  assert.equal(text.frame.length, 28);
  assert.equal(hex(text.sum), "98d7ec07");
  assert.equal(text.frame.slice(20), hex(text.sum));
});

test("a clean stream passes; a changed, swapped or lost frame is named", () => {
  const template = binaryTemplate(64);
  const frames = Array.from({ length: 10 }, (_, i) => binaryFrame(template, i).frame);
  const run = (list) => {
    const check = new StreamCheck();
    for (const f of list) check.accept(f.buffer);
    return check.report();
  };
  assert.equal(run(frames).errorCount, 0);
  const changed = frames.map((f) => new Uint8Array(f));
  changed[6][4] ^= 1;
  assert.deepEqual(run(changed).errors.map((e) => e.frame), [6]);
  const swapped = [...frames];
  [swapped[3], swapped[4]] = [swapped[4], swapped[3]];
  assert.deepEqual(run(swapped).errors.map((e) => e.frame), [3, 4]);
  assert.equal(run(frames.filter((_, i) => i !== 2)).errors[0].frame, 2);
  assert.notEqual(run(changed).hash, run(frames).hash);
});

test("text frames are checked", () => {
  const filler = textTemplate(200);
  const check = new StreamCheck();
  for (let i = 0; i < 5; i++) {
    let { frame } = textFrame(filler, i);
    assert.equal(frame.length, 200);
    if (i === 3) frame = frame.slice(0, 11) + "b" + frame.slice(12);
    check.accept(frame);
  }
  assert.deepEqual(check.report().errors.map((e) => e.frame), [3]);
});

test("malformed messages are errors, not exceptions", () => {
  const check = new StreamCheck();
  for (const m of [new ArrayBuffer(0), new ArrayBuffer(13), "", "not a frame, no", new Blob([]), null]) check.accept(m);
  assert.equal(check.report().errorCount, 6);
});
