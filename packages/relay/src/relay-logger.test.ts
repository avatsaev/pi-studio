import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { createRelayLogger, type CreateRelayLoggerOptions } from "./relay-logger.js";

/**
 * Relay operational logger (`relay-logger.ts`). stdout routing is covered by the real-process
 * smoke path (relay-main boots it and `docker logs` shows lines); these tests cover the parts
 * that are cheap to assert in-process: rotating-file output, level filtering, and level parsing.
 */

describe("createRelayLogger", () => {
  /** A /dev/null stdout stand-in so file-focused tests stay quiet; returns captured lines. */
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
  const withSink = (opts: CreateRelayLoggerOptions, s: { stream: Writable }) => ({ ...opts, stdoutStream: s.stream });

  it("writes structured NDJSON to a rotating file when logDir is set", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-studio-relay-log-"));
    const s = sink();
    const log = createRelayLogger(withSink({ logDir: dir, level: "info", pretty: false }, s));
    log.info({ sessionId: "s1", peers: 2 }, "session registered");
    log.warn("heads up");
    // rotating-file-stream flushes asynchronously; give it a tick.
    await new Promise((r) => setTimeout(r, 100));

    const files = readdirSync(dir).filter((f) => f.startsWith("pi-studio-relay.log"));
    expect(files.length).toBeGreaterThan(0);
    const content = readFileSync(join(dir, files[0]!), "utf8");
    const lines = content.trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines[0]).toMatchObject({ level: 30, msg: "session registered", sessionId: "s1", peers: 2 });
    expect(lines[1]).toMatchObject({ level: 40, msg: "heads up" });
  });

  it("also writes every record to the stdout stream (multistream, not either/or)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-studio-relay-log-"));
    const s = sink();
    const log = createRelayLogger(withSink({ logDir: dir, level: "info", pretty: false }, s));
    log.info({ conn: "abc12345" }, "connection open");
    await new Promise((r) => setTimeout(r, 100));

    // stdout stream got it…
    const stdoutLines = s.text().trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(stdoutLines[0]).toMatchObject({ level: 30, msg: "connection open", conn: "abc12345" });
    // …and so did the file.
    const files = readdirSync(dir).filter((f) => f.startsWith("pi-studio-relay.log"));
    expect(readFileSync(join(dir, files[0]!), "utf8")).toContain("connection open");
  });

  it("filters out records below the configured level", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-studio-relay-log-"));
    const log = createRelayLogger(withSink({ logDir: dir, level: "warn", pretty: false }, sink()));
    log.info("should be filtered");
    log.trace({ bytes: 10 }, "frame forwarded");
    log.error("should be kept");
    await new Promise((r) => setTimeout(r, 100));

    const files = readdirSync(dir).filter((f) => f.startsWith("pi-studio-relay.log"));
    const content = readFileSync(join(dir, files[0]!), "utf8").trim();
    expect(content).not.toContain("should be filtered");
    expect(content).not.toContain("frame forwarded");
    expect(content).toContain("should be kept");
  });

  it("falls back to info for an unrecognized level string", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-studio-relay-log-"));
    const log = createRelayLogger(withSink({ logDir: dir, level: "bogus" as never, pretty: false }, sink()));
    log.debug("debug filtered at info default");
    log.info("info kept at default");
    await new Promise((r) => setTimeout(r, 100));

    const files = readdirSync(dir).filter((f) => f.startsWith("pi-studio-relay.log"));
    const content = readFileSync(join(dir, files[0]!), "utf8").trim();
    expect(content).not.toContain("debug filtered");
    expect(content).toContain("info kept");
  });

  it("silent level suppresses everything without throwing", () => {
    const log = createRelayLogger({ level: "silent" });
    expect(() => {
      log.info("nope");
      log.error({ err: "x" }, "nope");
    }).not.toThrow();
  });
});
