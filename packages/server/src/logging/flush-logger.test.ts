import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { createLogger, flushLogger, silentLogger } from "./logger.js";

describe("flushLogger", () => {
  it("resolves once every line logged so far is in the log file", async () => {
    const logDir = mkdtempSync(join(tmpdir(), "pi-studio-flush-"));
    const sink = new Writable({ write: (_chunk, _encoding, done) => done() });
    const logger = createLogger({ level: "info", pretty: false, logDir, stdoutStream: sink });

    logger.info("first");
    logger.fatal("last words");
    await flushLogger(logger);

    const messages = readFileSync(join(logDir, "pi-studio.log"), "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line): unknown => JSON.parse(line))
      .map((line) => (typeof line === "object" && line !== null && "msg" in line ? line.msg : ""));
    expect(messages).toEqual(["first", "last words"]);
  });

  it("resolves at once for a logger without a file", async () => {
    await flushLogger(silentLogger());
    await flushLogger(createLogger({ level: "info", pretty: false, stdoutStream: new Writable() }));
  });
});
