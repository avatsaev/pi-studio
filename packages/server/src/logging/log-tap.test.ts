import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import { LOG_LEVEL_NUMBERS, LOG_LINE_MAX_BYTES, LOG_RING_CAPACITY, LogTap } from "./log-tap.js";
import { createLogger, type Logger } from "./logger.js";

function sink() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString("utf8"));
      cb();
    },
  });
  return { stream, text: () => chunks.join("") };
}

const norm = (s: string): string => s.replace(/"stack":"[^"]*"/g, '"stack":"-"');

const lines = (tap: LogTap, min = 0, n = LOG_RING_CAPACITY) =>
  tap.backlog(min, n).map((raw) => tap.toLogLine(raw));

afterEach(() => {
  vi.useRealTimers();
});

describe("createLogger({ tap })", () => {
  async function run(withTap: boolean): Promise<{ stdout: string; file: string }> {
    const out = sink();
    const dir = mkdtempSync(join(tmpdir(), "pi-studio-tap-"));
    const log = createLogger({
      pretty: false,
      level: "debug",
      stdoutStream: out.stream,
      logDir: dir,
      bindings: { name: "pi-studio" },
      ...(withTap ? { tap: new LogTap() } : {}),
    });
    log.debug({ a: 1 }, "debug line");
    log.info({ password: "hunter2", inputTokens: 12 }, "info line");
    log.error({ err: new Error("boom") }, "failed");
    await new Promise((r) => setTimeout(r, 100));
    const file = readdirSync(dir)
      .filter((f) => f.startsWith("pi-studio.log"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("");
    return { stdout: out.text(), file };
  }

  it("keeps stdout and file bytes identical with and without a tap", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const without = await run(false);
    const withTap = await run(true);
    expect(without.stdout.length).toBeGreaterThan(0);
    expect(without.file.length).toBeGreaterThan(0);
    // The err stack is the same Error site only if created at the same line, so compare
    // everything but the stack by checking equality of the stdout/file with stacks normalised.
    expect(norm(withTap.stdout)).toBe(norm(without.stdout));
    expect(norm(withTap.file)).toBe(norm(without.file));
    // The password is untouched in the real outputs.
    expect(withTap.file).toContain("hunter2");
  });

  it("attaches at the resolved level; silent leaves the tap unattached and empty", () => {
    const tap = new LogTap();
    expect(tap.effectiveLevel).toBe("silent");
    createLogger({ level: "warn", pretty: false, stdoutStream: sink().stream, tap });
    expect(tap.effectiveLevel).toBe("warn");
    const silentTap = new LogTap();
    const log: Logger = createLogger({ level: "silent", tap: silentTap });
    log.error("x");
    expect(silentTap.effectiveLevel).toBe("silent");
    expect(silentTap.backlog(0, 10)).toEqual([]);
  });

  it("receives exactly one serialised line per write from the installed pino", () => {
    const tap = new LogTap();
    const writes: string[] = [];
    const original = tap.stream.write.bind(tap.stream) as (chunk: unknown) => boolean;
    tap.stream.write = ((chunk: unknown): boolean => {
      writes.push(String(chunk));
      return original(chunk);
    }) as typeof tap.stream.write;
    const log = createLogger({ level: "info", pretty: false, stdoutStream: sink().stream, tap });
    log.info("one");
    log.warn({ x: 1 }, "two");
    expect(writes).toHaveLength(2);
    for (const w of writes) {
      expect(w.endsWith("\n")).toBe(true);
      expect(w.indexOf("\n")).toBe(w.length - 1);
    }
  });
});

describe("LogTap ring", () => {
  function tapped(level: "trace" | "info" = "trace") {
    const tap = new LogTap();
    const log = createLogger({ level, pretty: false, stdoutStream: sink().stream, tap });
    return { tap, log };
  }

  it("keeps the 1000 newest of 1500 lines and filters backlog by level, oldest first", () => {
    const { tap, log } = tapped();
    for (let i = 0; i < 1500; i++) {
      if (i % 10 === 0) log.warn({ i }, `m${i}`);
      else log.info({ i }, `m${i}`);
    }
    const all = lines(tap);
    expect(all).toHaveLength(LOG_RING_CAPACITY);
    expect(all[0]!.msg).toBe("m500");
    expect(all.at(-1)!.msg).toBe("m1499");

    const warns = lines(tap, LOG_LEVEL_NUMBERS.warn, 200);
    expect(warns).toHaveLength(100);
    expect(warns.every((l) => l.level === "warn")).toBe(true);
    expect(warns[0]!.msg).toBe("m500");
    expect(warns.at(-1)!.msg).toBe("m1490");
    expect(lines(tap, 0, 5).map((l) => l.msg)).toEqual([
      "m1495",
      "m1496",
      "m1497",
      "m1498",
      "m1499",
    ]);
  });

  it("truncates a 100 KB field to an 8 KiB line marked truncated", () => {
    const { tap, log } = tapped();
    log.info({ big: "x".repeat(100_000), nested: { a: { b: { c: { d: { e: 1 } } } } } }, "big");
    const [raw] = tap.backlog(0, 1);
    expect(Buffer.byteLength(raw!)).toBeLessThanOrEqual(LOG_LINE_MAX_BYTES);
    const line = tap.toLogLine(raw!);
    expect(line.fields?.truncated).toBe(true);
    expect((line.fields!.big as string).length).toBe(1024);
    expect(JSON.stringify(line.fields?.nested)).toContain("[truncated]");
  });

  it("caps a very wide line to its core keys", () => {
    const tap = new LogTap();
    const wide: Record<string, string> = {};
    for (let i = 0; i < 2000; i++) wide[`k${i}`] = "value";
    tap.stream.write(`${JSON.stringify({ level: 30, time: 1, msg: "wide", ...wide })}\n`);
    const [raw] = tap.backlog(0, 1);
    expect(Buffer.byteLength(raw!)).toBeLessThanOrEqual(LOG_LINE_MAX_BYTES);
    expect(tap.toLogLine(raw!).fields).toEqual({ truncated: true });
  });

  it("turns raw text into an info line and splits multi-line chunks", () => {
    const tap = new LogTap();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1234);
    tap.stream.write("plain text, not json\n");
    expect(lines(tap)[0]).toEqual({ time: 1234, level: "info", msg: "plain text, not json" });
    const three = [1, 2, 3].map((i) => JSON.stringify({ level: 40, time: i, msg: `l${i}` }));
    tap.stream.write(`${three.join("\n")}\n`);
    expect(lines(tap).map((l) => l.msg)).toEqual(["plain text, not json", "l1", "l2", "l3"]);
  });

  it("redacts sensitive keys and bearer tokens in the tap only, sparing usage counters", () => {
    const { tap, log } = tapped();
    log.info(
      {
        password: "hunter2",
        apiKey: "k",
        inputTokens: 12,
        tokens: 5,
        deep: { Authorization: "Bearer z" },
      },
      "auth pi-studio.bearer.s3cr3t done",
    );
    const line = lines(tap)[0]!;
    expect(line.fields).toMatchObject({
      password: "[redacted]",
      apiKey: "[redacted]",
      inputTokens: 12,
      tokens: 5,
      deep: { Authorization: "[redacted]" },
    });
    expect(line.msg).not.toContain("s3cr3t");
    expect(line.msg).toContain("pi-studio.bearer.");
  });

  it("fans out to listeners, survives a throwing listener, and removes them", () => {
    const { tap, log } = tapped();
    const seen: Array<[string, number]> = [];
    tap.onLine(() => {
      throw new Error("bad listener");
    });
    const off = tap.onLine((line, n) => seen.push([line, n]));
    log.warn("first");
    expect(seen).toHaveLength(1);
    expect(seen[0]![1]).toBe(LOG_LEVEL_NUMBERS.warn);
    off();
    log.warn("second");
    expect(seen).toHaveLength(1);
    expect(lines(tap)).toHaveLength(2);
  });

  it("toLogLine maps levels, strips core keys and omits empty fields", () => {
    const tap = new LogTap();
    const raw = JSON.stringify({ level: 50, time: 7, msg: "m", pid: 1, hostname: "h", v: 1 });
    expect(tap.toLogLine(raw)).toEqual({ time: 7, level: "error", msg: "m" });
    expect(tap.toLogLine('{"level":30,"time":1,"name":"pi-studio"}')).toEqual({
      time: 1,
      level: "info",
      msg: "",
      fields: { name: "pi-studio" },
    });
  });
});
