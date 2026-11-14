import { Writable } from "node:stream";

import type { LogLine } from "@av-pi-studio/protocol";

import type { LogLevel } from "./logger.js";

/**
 * `LogTap` — a pino multistream destination that mirrors every line the daemon logger writes into
 * a bounded, sanitised, size-capped ring and fans it out to live listeners
 * (swe/features/daemon-log-streaming.md). It only ever receives a copy: stdout and the rotating
 * file are separate multistream entries and stay byte-for-byte untouched.
 *
 * Invariants: the tap never throws into pino; the ring never holds a line over
 * `LOG_LINE_MAX_BYTES`; redaction/truncation happen once, here, at tap time.
 */

export const LOG_RING_CAPACITY = 1000;
export const LOG_LINE_MAX_BYTES = 8192;
const MSG_MAX_CHARS = 2048;
const FIELD_STRING_MAX_CHARS = 1024;
const STACK_MAX_CHARS = 2048;
const MAX_DEPTH = 4;
const REDACTED = "[redacted]";
const TRUNCATED_NODE = "[truncated]";

/** Pino's numeric levels. */
export const LOG_LEVEL_NUMBERS: Readonly<Record<Exclude<LogLevel, "silent">, number>> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

const LEVEL_NAMES: ReadonlyMap<number, Exclude<LogLevel, "silent">> = new Map(
  Object.entries(LOG_LEVEL_NUMBERS).map(([name, num]) => [
    num,
    name as Exclude<LogLevel, "silent">,
  ]),
);

/** Keys stripped from `LogLine.fields`. */
const CORE_KEYS: ReadonlySet<string> = new Set(["level", "time", "msg", "pid", "hostname", "v"]);

/**
 * Whole key names (lower-cased) whose values are redacted. Whole-name matching deliberately
 * spares usage counters such as `tokens` / `inputTokens`.
 */
const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  "password",
  "passwd",
  "secret",
  "token",
  "authorization",
  "cookie",
  "apikey",
  "api_key",
  "bearer",
  "privatekey",
  "secretkey",
]);

const BEARER_PATTERN = /pi-studio\.bearer\.[^\s"']+/g;

type JsonObject = Record<string, unknown>;

const isObject = (v: unknown): v is JsonObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const maskBearer = (s: string): string => s.replace(BEARER_PATTERN, "pi-studio.bearer.[redacted]");

const cut = (s: string, max: number): string => (s.length > max ? s.slice(0, max) : s);

/** Redact sensitive keys and mask bearer tokens in strings, recursively. Mutates `node`. */
function sanitize(node: unknown): unknown {
  if (typeof node === "string") return maskBearer(node);
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) node[i] = sanitize(node[i]);
    return node;
  }
  if (isObject(node)) {
    for (const key of Object.keys(node)) {
      node[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? REDACTED : sanitize(node[key]);
    }
  }
  return node;
}

/** Shorten strings and cap nesting depth. Returns a new value. */
function shrink(node: unknown, depth: number, inErr: boolean): unknown {
  if (typeof node === "string") return cut(node, FIELD_STRING_MAX_CHARS);
  if (Array.isArray(node)) {
    if (depth > MAX_DEPTH) return TRUNCATED_NODE;
    return node.map((v) => shrink(v, depth + 1, false));
  }
  if (isObject(node)) {
    if (depth > MAX_DEPTH) return TRUNCATED_NODE;
    const out: JsonObject = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] =
        inErr && k === "stack" && typeof v === "string"
          ? cut(v, STACK_MAX_CHARS)
          : shrink(v, depth + 1, k === "err" && depth === 0);
    }
    return out;
  }
  return node;
}

function truncateLine(obj: JsonObject): JsonObject {
  const out: JsonObject = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "msg" && typeof v === "string") out[k] = cut(v, MSG_MAX_CHARS);
    else if (CORE_KEYS.has(k)) out[k] = v;
    else out[k] = shrink(v, 1, k === "err");
  }
  out.truncated = true;
  if (Buffer.byteLength(JSON.stringify(out)) <= LOG_LINE_MAX_BYTES) return out;
  // Pathologically wide line (thousands of small fields): keep only the core keys.
  const core: JsonObject = {};
  for (const k of CORE_KEYS) if (k in out) core[k] = out[k];
  core.truncated = true;
  return core;
}

/** A parsed-once line plus its numeric level. */
interface RingEntry {
  raw: string;
  level: number;
}

export type LogTapListener = (line: string, levelNum: number) => void;

export class LogTap {
  readonly stream: Writable;
  #ring: Array<RingEntry | undefined> = Array.from<RingEntry | undefined>({
    length: LOG_RING_CAPACITY,
  });
  #next = 0;
  #size = 0;
  #listeners = new Set<LogTapListener>();
  #effectiveLevel: LogLevel = "silent";

  constructor() {
    this.stream = new Writable({
      decodeStrings: false,
      write: (chunk: string | Buffer, _enc, cb): void => {
        try {
          this.#ingest(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
        } catch {
          // The tap must never push an error back into pino.
        }
        cb();
      },
    });
  }

  /** The logger level the tap was attached at, or `"silent"` while unattached. */
  get effectiveLevel(): LogLevel {
    return this.#effectiveLevel;
  }

  /** Called by `createLogger` when it pushes the tap's stream. */
  attach(level: LogLevel): void {
    this.#effectiveLevel = level;
  }

  /** Register a live listener; returns its remover. Listener errors are swallowed. */
  onLine(listener: LogTapListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** The newest `n` lines at or above `minLevelNum`, oldest first. */
  backlog(minLevelNum: number, n: number): string[] {
    const out: string[] = [];
    for (let i = 1; i <= this.#size && out.length < n; i++) {
      const entry = this.#ring[(this.#next - i + LOG_RING_CAPACITY) % LOG_RING_CAPACITY];
      if (entry && entry.level >= minLevelNum) out.push(entry.raw);
    }
    return out.toReversed();
  }

  /** Project a ring/listener line to the wire shape. Never throws. */
  toLogLine(raw: string): LogLine {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { time: Date.now(), level: "info", msg: cut(raw, MSG_MAX_CHARS) };
    }
    if (!isObject(parsed)) return { time: Date.now(), level: "info", msg: cut(raw, MSG_MAX_CHARS) };
    const fields: JsonObject = {};
    for (const [k, v] of Object.entries(parsed)) if (!CORE_KEYS.has(k)) fields[k] = v;
    const level =
      typeof parsed.level === "number" ? (LEVEL_NAMES.get(parsed.level) ?? "info") : "info";
    return {
      time: typeof parsed.time === "number" ? parsed.time : Date.now(),
      level,
      msg: typeof parsed.msg === "string" ? parsed.msg : "",
      ...(Object.keys(fields).length > 0 ? { fields } : {}),
    };
  }

  #ingest(chunk: string): void {
    for (const part of chunk.split("\n")) {
      if (part.trim().length === 0) continue;
      const entry = this.#normalise(part);
      this.#ring[this.#next] = entry;
      this.#next = (this.#next + 1) % LOG_RING_CAPACITY;
      if (this.#size < LOG_RING_CAPACITY) this.#size++;
      for (const listener of this.#listeners) {
        try {
          listener(entry.raw, entry.level);
        } catch {
          // A faulty listener must not affect pino or other listeners.
        }
      }
    }
  }

  #normalise(part: string): RingEntry {
    let parsed: unknown;
    try {
      parsed = JSON.parse(part);
    } catch {
      parsed = undefined;
    }
    if (!isObject(parsed)) {
      return {
        raw: JSON.stringify({
          level: LOG_LEVEL_NUMBERS.info,
          time: Date.now(),
          msg: maskBearer(cut(part, MSG_MAX_CHARS)),
        }),
        level: LOG_LEVEL_NUMBERS.info,
      };
    }
    const level = typeof parsed.level === "number" ? parsed.level : LOG_LEVEL_NUMBERS.info;
    let obj = sanitize(parsed) as JsonObject;
    let raw = JSON.stringify(obj);
    if (Buffer.byteLength(raw) > LOG_LINE_MAX_BYTES) {
      obj = truncateLine(obj);
      raw = JSON.stringify(obj);
    }
    return { raw, level };
  }
}
