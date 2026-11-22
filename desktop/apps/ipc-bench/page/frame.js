// The benchmark's frame format and its integrity check (row B6). The same format and the same hash
// as `src/frame.rs`: see the description there. Both are tested against the vectors in
// `frame.test.mjs` and in the Rust tests.
//
// A binary frame is `size` bytes (a multiple of 4, at least 12): the counter as a little-endian u32, a
// payload, the checksum as a little-endian u32. A text frame is `size` characters (ASCII, a
// multiple of 4, at least 20): the counter as ten digits and a colon, a filler, the checksum as eight
// lowercase hex digits. The checksum is the hash of everything before it, and a stream's running
// hash takes each frame's checksum in order.

export const BASIS = 0x811c9dc5 | 0;
const PRIME = 0x01000193;
export const MIN_BINARY = 12;
export const MIN_TEXT = 20;
export const MAX_LISTED_ERRORS = 20;
const TEXT_PREFIX = 11;
const TEXT_SUFFIX = 8;

// The words of a binary frame are read through a Uint32Array: that is the format on a
// little-endian machine, and every platform the app runs on is one. Better to stop than to measure
// another format.
if (new Uint8Array(new Uint32Array([1]).buffer)[0] !== 1) {
  throw new Error("this machine is big-endian: the benchmark's frame format is little-endian");
}

/** One step of the hash. Values are signed 32-bit integers inside; `hex` and `>>> 0` make them unsigned. */
export function mix(hash, word) {
  return Math.imul(hash ^ word, PRIME);
}

/** The hash of the first `count` words of a Uint32Array. */
export function hashWords(words, count = words.length) {
  let h = BASIS;
  for (let i = 0; i < count; i++) h = Math.imul(h ^ words[i], PRIME);
  return h;
}

/** The hash of an ASCII string, four characters to a little-endian word. */
export function hashAscii(text) {
  let h = BASIS;
  const whole = text.length - (text.length % 4);
  for (let i = 0; i < whole; i += 4) {
    const w = text.charCodeAt(i) | (text.charCodeAt(i + 1) << 8) | (text.charCodeAt(i + 2) << 16) | (text.charCodeAt(i + 3) << 24);
    h = Math.imul(h ^ w, PRIME);
  }
  return h;
}

export function hex(hash) {
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** A binary frame's payload, fixed per size. Any bytes would do: the server checks counter and checksum. */
export function binaryTemplate(size) {
  if (size < MIN_BINARY || size % 4 !== 0) throw new Error(`a binary frame is at least ${MIN_BINARY} bytes, a multiple of 4: ${size} is not`);
  const words = new Uint32Array(size / 4);
  let state = (size | 1) >>> 0;
  for (let i = 0; i < words.length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    words[i] = state >>> 0;
  }
  return new Uint8Array(words.buffer);
}

/** Frame `counter` of a binary stream: a fresh Uint8Array and its checksum (a signed int32). */
export function binaryFrame(template, counter) {
  const frame = new Uint8Array(template);
  const words = new Uint32Array(frame.buffer);
  const n = words.length;
  words[0] = counter;
  const sum = hashWords(words, n - 1);
  words[n - 1] = sum >>> 0;
  return { frame, sum };
}

/** A text frame's filler for `size` characters. */
export function textTemplate(size) {
  if (size < MIN_TEXT || size % 4 !== 0) throw new Error(`a text frame is at least ${MIN_TEXT} characters, a multiple of 4: ${size} is not`);
  let filler = "";
  for (let i = 0; i < size - TEXT_PREFIX - TEXT_SUFFIX; i++) filler += String.fromCharCode(97 + (i % 26));
  return filler;
}

/** Frame `counter` of a text stream: the string and its checksum. */
export function textFrame(filler, counter) {
  const body = String(counter).padStart(10, "0") + ":" + filler;
  const sum = hashAscii(body);
  return { frame: body + hex(sum), sum };
}

/**
 * Checks a stream of frames as it arrives: each frame's counter (its position), its checksum, and
 * the running hash. `data` is an ArrayBuffer (binary) or a string (text).
 */
export class StreamCheck {
  frames = 0;
  bytes = 0;
  chain = BASIS;
  errorCount = 0;
  errors = [];

  accept(data) {
    if (typeof data === "string") this.#acceptText(data);
    else if (data instanceof ArrayBuffer) this.#acceptBinary(data);
    else this.#reject(0, `a message of ${Object.prototype.toString.call(data)}: expected an ArrayBuffer or a string`);
  }

  #acceptBinary(buffer) {
    const n = buffer.byteLength;
    if (n < MIN_BINARY || n % 4 !== 0) {
      this.#reject(n, `a binary frame of ${n} bytes: expected a multiple of 4, at least ${MIN_BINARY}`);
      return;
    }
    const words = new Uint32Array(buffer);
    const last = words.length - 1;
    this.#accept(n, words[0], words[last], hashWords(words, last));
  }

  #acceptText(text) {
    const n = text.length;
    const counterText = text.slice(0, 10);
    const sumText = text.slice(Math.max(0, n - TEXT_SUFFIX));
    if (n < MIN_TEXT || n % 4 !== 0 || text[10] !== ":" || !/^[0-9]{10}$/.test(counterText) || !/^[0-9a-f]{8}$/.test(sumText)) {
      this.#reject(n, `a text frame of ${n} characters that is not \`<counter>:<filler><checksum>\``);
      return;
    }
    this.#accept(n, Number(counterText), parseInt(sumText, 16), hashAscii(text.slice(0, n - TEXT_SUFFIX)));
  }

  #accept(size, counter, stored, computed) {
    const position = this.frames;
    if (counter !== position) this.#note(position, `counter ${counter} where ${position} was expected`);
    if (stored !== computed >>> 0) {
      this.#note(position, `the frame (counter ${counter}) was changed: checksum ${hex(computed)}, not ${hex(stored)}`);
    }
    this.chain = mix(this.chain, computed);
    this.frames++;
    this.bytes += size;
  }

  #reject(size, problem) {
    this.#note(this.frames, problem);
    this.chain = mix(this.chain, 0);
    this.frames++;
    this.bytes += size;
  }

  #note(frame, problem) {
    this.errorCount++;
    if (this.errors.length < MAX_LISTED_ERRORS) this.errors.push({ frame, problem });
  }

  report() {
    return { frames: this.frames, bytes: this.bytes, hash: hex(this.chain), errorCount: this.errorCount, errors: this.errors };
  }
}
