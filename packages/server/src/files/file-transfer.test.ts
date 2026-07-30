import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  decodeFileTransferFrame,
  encodeFileTransferFrame,
  type FileTransferFrame,
} from "@av-pi-studio/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HandlerRegistry } from "../ws/router.js";
import { Session } from "../ws/session.js";
import { DownloadTokenStore } from "./download-token-store.js";
import { FileTransferService } from "./file-transfer.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pi-studio-ft-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function fakeSession(): { session: Session; binary: Uint8Array[] } {
  const binary: Uint8Array[] = [];
  const socket = { send: (d: unknown) => binary.push(d as Uint8Array), close: () => {} };
  const session = new Session({
    id: "s1",
    clientId: "c1",
    clientType: "cli",
    capabilities: {},
    socket: socket as never,
  });
  return { session, binary };
}

describe("DownloadTokenStore", () => {
  it("issues single-use tokens and rejects reuse / expiry / unknown", () => {
    let clock = 1000;
    const store = new DownloadTokenStore(5000, () => clock);
    const { token } = store.issue("/path/a");
    expect(store.consume(token)).toBe("/path/a");
    expect(store.consume(token)).toBeNull(); // single-use
    expect(store.consume("nope")).toBeNull(); // unknown

    const { token: t2 } = store.issue("/path/b");
    clock += 6000; // past TTL
    expect(store.consume(t2)).toBeNull(); // expired
  });

  it("defaults to a TTL that survives a slow link's head-of-line blocking", () => {
    // The clock starts when the daemon ISSUES the token, but the client cannot redeem it until
    // the response has crossed a socket that may have megabytes of in-flight `Chunk` frames ahead
    // of it. A 20 MB transfer at 250 KB/s is ~100s of backlog, which the original 60s TTL turned
    // into a spurious `invalid_or_expired_token` on the next file the user opened.
    let clock = 0;
    const store = new DownloadTokenStore(undefined, () => clock);
    const { token, expiresAt } = store.issue("/path/slow");
    expect(expiresAt - clock).toBeGreaterThanOrEqual(10 * 60_000);
    clock += 120_000; // two minutes of downlink backlog
    expect(store.consume(token)).toBe("/path/slow");
  });
});

describe("FileTransferService download", () => {
  it("requires a valid token and streams bytes in chunks with a completion marker", async () => {
    const file = join(dir, "data.txt");
    const content = "X".repeat(100_000); // > chunk size → multiple Chunk frames
    await writeFile(file, content);

    const svc = new FileTransferService({ chunkBytes: 32 * 1024 });
    const token = svc.issueDownloadToken(file);

    const { binary } = fakeSession();
    const result = await svc.startDownload(token, 7, (f) => binary.push(f));
    expect(result.ok).toBe(true);

    const frames = binary.map((b) => decodeFileTransferFrame(b));
    expect(frames[0]!.opcode).toBe("Begin");
    if (frames[0]!.opcode === "Begin") {
      expect(frames[0]!.meta.mimeType).toBe("application/octet-stream"); // unknown extension
    }
    expect(frames.at(-1)!.opcode).toBe("End");
    const chunks = frames.filter((f) => f.opcode === "Chunk");
    expect(chunks.length).toBeGreaterThan(1); // bounded chunks
    const assembled = Buffer.concat(
      chunks.map((f) => (f.opcode === "Chunk" ? Buffer.from(f.data) : Buffer.alloc(0))),
    ).toString();
    expect(assembled).toBe(content);
    if (frames.at(-1)!.opcode === "End") {
      expect((frames.at(-1) as { ok: boolean }).ok).toBe(true);
    }
  });

  it("stamps the Begin frame with a known extension's MIME type", async () => {
    const file = join(dir, "shot.png");
    await writeFile(file, "not-really-png-bytes");

    const svc = new FileTransferService();
    const token = svc.issueDownloadToken(file);

    const { binary } = fakeSession();
    await svc.startDownload(token, 1, (f) => binary.push(f));

    const begin = decodeFileTransferFrame(binary[0]!);
    expect(begin.opcode).toBe("Begin");
    if (begin.opcode === "Begin") {
      expect(begin.meta.mimeType).toBe("image/png");
    }
  });

  it("rejects an invalid/expired token", async () => {
    const svc = new FileTransferService();
    const result = await svc.startDownload("bogus", 1, () => {});
    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid_or_expired_token");
  });

  it("rejects an out-of-range stream WITHOUT spending the token", async () => {
    // The stream id is one frame-header byte. This used to consume the token and only then throw
    // out of `encodeFileTransferFrame`, so the caller's retry had nothing left to redeem.
    const file = join(dir, "data.txt");
    await writeFile(file, "payload");
    const svc = new FileTransferService();
    const token = svc.issueDownloadToken(file);
    const registry = new HandlerRegistry();
    svc.registerHandlers(registry);
    const { session, binary } = fakeSession();

    const rejected = (await registry.get("file_download_request")!({
      session,
      message: { type: "file_download_request", token, stream: 256 },
      requestId: "r1",
    })) as { ok: boolean; error?: string };
    expect(rejected).toMatchObject({ ok: false, error: "invalid_stream" });

    const retried = (await registry.get("file_download_request")!({
      session,
      message: { type: "file_download_request", token, stream: 3 },
      requestId: "r2",
    })) as { ok: boolean };
    expect(retried.ok).toBe(true);
    expect(binary.length).toBeGreaterThan(0);
  });

  it("keeps a client-omitted stream inside the one-byte space across many transfers", async () => {
    const file = join(dir, "data.txt");
    await writeFile(file, "payload");
    const svc = new FileTransferService();
    const registry = new HandlerRegistry();
    svc.registerHandlers(registry);
    const { session } = fakeSession();

    for (let i = 0; i < 300; i++) {
      const res = (await registry.get("file_download_request")!({
        session,
        message: { type: "file_download_request", token: svc.issueDownloadToken(file) },
        requestId: `r${i}`,
      })) as { ok: boolean; stream: number };
      expect(res.ok).toBe(true);
      expect(res.stream).toBeLessThan(256);
    }
  });
});

describe("FileTransferService upload", () => {
  it("writes the streamed file to the target path", async () => {
    const svc = new FileTransferService();
    const target = join(dir, "nested", "out.txt");
    const transferId = "up-1";

    // Register the upload via RPC handler to get a stream id.
    const registry = new HandlerRegistry();
    svc.registerHandlers(registry);
    const { session } = fakeSession();
    const resp = (await registry.get("file_upload_request")!({
      session,
      message: { type: "file_upload_request", path: target, transferId },
      requestId: "r",
    })) as { ok: boolean; stream: number };
    expect(resp.ok).toBe(true);

    // Drive the binary frames as the client would.
    const handler = svc.binaryHandler();
    const push = (frame: FileTransferFrame) => handler(session, encodeFileTransferFrame(frame));
    push({ opcode: "Begin", stream: resp.stream, meta: { transferId } });
    push({ opcode: "Chunk", stream: resp.stream, data: new TextEncoder().encode("hello ") });
    push({ opcode: "Chunk", stream: resp.stream, data: new TextEncoder().encode("upload") });
    push({ opcode: "End", stream: resp.stream, ok: true });

    // Allow the async frame handling to flush.
    await new Promise((r) => setTimeout(r, 20));
    expect(await readFile(target, "utf8")).toBe("hello upload");
  });

  it("recycles upload stream ids once a transfer ends", async () => {
    // Uploads are tracked by stream id, and the id space is one byte — the 256th upload on a
    // long-lived daemon used to be handed 256 and break the client's own frame encoding.
    const svc = new FileTransferService();
    const registry = new HandlerRegistry();
    svc.registerHandlers(registry);
    const { session } = fakeSession();
    const handler = svc.binaryHandler();

    for (let i = 0; i < 300; i++) {
      const transferId = `up-${i}`;
      const resp = (await registry.get("file_upload_request")!({
        session,
        message: { type: "file_upload_request", path: join(dir, `out-${i}.txt`), transferId },
        requestId: `r${i}`,
      })) as { ok: boolean; stream: number };
      expect(resp.ok).toBe(true);
      expect(resp.stream).toBeLessThan(256);

      // End with no preceding Begin: nothing was opened, so releasing the id is pure microtask
      // work — this test is about id recycling, not about bytes reaching disk.
      handler(session, encodeFileTransferFrame({ opcode: "End", stream: resp.stream, ok: true }));
      for (let drain = 0; drain < 4; drain++) await Promise.resolve();
    }
  });
});
