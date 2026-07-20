import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { createLogger, silentLogger, type CreateLoggerOptions } from "./logger.js";

/** A stdout stand-in capturing writes, so file-focused tests stay quiet. */
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
const quiet = (s: { stream: Writable }, opts: CreateLoggerOptions = {}): CreateLoggerOptions => ({
  pretty: false,
  ...opts,
  stdoutStream: s.stream,
});

describe("createLogger", () => {
  it("writes structured NDJSON to a rotating file when logDir is set", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-studio-log-"));
    const log = createLogger(quiet(sink(), { logDir: dir, level: "info", bindings: { name: "pi-studio" } }));
    log.info({ slot: 1 }, "terminal opened");
    log.warn("heads up");
    // rotating-file-stream flushes asynchronously; give it a tick.
    await new Promise((r) => setTimeout(r, 50));

    const files = readdirSync(dir).filter((f) => f.startsWith("pi-studio.log"));
    expect(files.length).toBeGreaterThan(0);
    const contents = files.map((f) => readFileSync(join(dir, f), "utf8")).join("");
    expect(contents).toContain("terminal opened");
    expect(contents).toContain("heads up");
    // NDJSON: each line parses to an object carrying the base binding.
    const firstLine = contents.split("\n").find((l) => l.trim().length > 0)!;
    const parsed = JSON.parse(firstLine) as Record<string, unknown>;
    expect(parsed.name).toBe("pi-studio");
    expect(parsed.msg).toBe("terminal opened");
  });

  it("also writes every record to stdout (multistream, not either/or)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-studio-log-"));
    const s = sink();
    const log = createLogger(quiet(s, { logDir: dir, level: "info" }));
    log.info({ conn: "abc" }, "connection open");
    await new Promise((r) => setTimeout(r, 50));

    // stdout got it as NDJSON…
    const stdoutLine = s.text().trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(stdoutLine[0]).toMatchObject({ level: 30, msg: "connection open", conn: "abc" });
    // …and so did the rotating file.
    const contents = readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8")).join("");
    expect(contents).toContain("connection open");
  });

  it("respects the level threshold", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-studio-log-"));
    const log = createLogger(quiet(sink(), { logDir: dir, level: "warn" }));
    log.info("should be dropped");
    log.error("should be kept");
    await new Promise((r) => setTimeout(r, 50));
    const contents = readdirSync(dir)
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("");
    expect(contents).not.toContain("should be dropped");
    expect(contents).toContain("should be kept");
  });

  it("child loggers inherit bindings", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-studio-log-"));
    const log = createLogger(quiet(sink(), { logDir: dir }));
    const child = log.child({ component: "terminal" });
    child.info("hi");
    await new Promise((r) => setTimeout(r, 50));
    const contents = readdirSync(dir)
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("");
    expect(contents).toContain('"component":"terminal"');
  });

  it("silentLogger never throws and emits nothing", () => {
    const log = silentLogger();
    expect(() => {
      log.info("nope");
      log.error({ e: 1 }, "nope");
      log.child({ x: 1 }).warn("nope");
    }).not.toThrow();
  });
});
