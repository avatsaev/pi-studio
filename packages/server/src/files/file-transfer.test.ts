import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  decodeFileTransferFrame,
  encodeFileTransferFrame,
  type FileTransferFrame,
  fileUploadCompleteSchema,
} from "@av-pi-studio/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HandlerRegistry } from "../ws/router.js";
import { Session } from "../ws/session.js";
import { DownloadTokenStore } from "./download-token-store.js";
import { FileTransferService, type DownloadPacing } from "./file-transfer.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pi-studio-ft-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function fakeSession(id = "s1"): { session: Session; binary: Uint8Array[]; text: unknown[] } {
  const binary: Uint8Array[] = [];
  const text: unknown[] = [];
  const socket = {
    send: (d: unknown) =>
      typeof d === "string" ? text.push(JSON.parse(d)) : binary.push(d as Uint8Array),
    close: () => {},
  };
  const session = new Session({
    id,
    clientId: "c1",
    clientType: "cli",
    capabilities: {},
    socket: socket as never,
  });
  return { session, binary, text };
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

const waitUntil = async (condition: () => boolean | Promise<boolean>, ms = 2000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error("waitUntil: timed out");
    await new Promise((r) => setTimeout(r, 2));
  }
};

const encoder = new TextEncoder();

interface UploadRig {
  svc: FileTransferService;
  session: Session;
  text: unknown[];
  stream: number;
  push: (frame: FileTransferFrame, from?: Session) => void;
}

async function openUpload(
  root: string,
  name: string,
  opts: { ack?: boolean; transferId?: string } = {},
): Promise<UploadRig & { target: string; transferId: string }> {
  const svc = new FileTransferService();
  const registry = new HandlerRegistry();
  svc.registerHandlers(registry);
  const { session, text } = fakeSession();
  const target = join(root, name);
  const transferId = opts.transferId ?? "up-1";
  const resp = (await registry.get("file_upload_request")!({
    session,
    message: {
      type: "file_upload_request",
      path: target,
      transferId,
      ...(opts.ack === undefined ? {} : { ack: opts.ack }),
    },
    requestId: "r",
  })) as { ok: boolean; stream: number };
  expect(resp.ok).toBe(true);
  const handler = svc.binaryHandler();
  return {
    svc,
    session,
    text,
    stream: resp.stream,
    target,
    transferId,
    push: (frame, from = session) => handler(from, encodeFileTransferFrame(frame)),
  };
}

/** A socket whose queue only drains when the test says so. */
function slowSocket(highWater: number) {
  const state = { queued: 0, peak: 0, open: true };
  const pacing: DownloadPacing = {
    bufferedAmount: () => state.queued,
    isOpen: () => state.open,
  };
  const sink = (frame: Uint8Array) => {
    state.queued += frame.length;
    state.peak = Math.max(state.peak, state.queued);
  };
  return { state, pacing, sink, highWater };
}

describe("FileTransferService paced download", () => {
  it("keeps the socket's queue bounded when the client reads slowly, and still delivers every byte", async () => {
    const file = join(dir, "big.bin");
    const content = Buffer.alloc(300_000, "ab");
    await writeFile(file, content);
    const svc = new FileTransferService({
      chunkBytes: 1024,
      highWaterBytes: 8 * 1024,
      lowWaterBytes: 2 * 1024,
      drainPollMs: 1,
    });
    const { state, pacing, sink } = slowSocket(8 * 1024);
    const frames: Uint8Array[] = [];
    // The client drains 4 KiB every 2 ms, far slower than the disk reads.
    const drain = setInterval(() => (state.queued = Math.max(0, state.queued - 4096)), 2);
    const result = await svc.startDownload(
      svc.issueDownloadToken(file),
      3,
      (f) => {
        frames.push(f);
        sink(f);
      },
      pacing,
    );
    clearInterval(drain);

    expect(result.ok).toBe(true);
    // One chunk may overshoot the mark before the pause takes effect (chunk + frame header).
    expect(state.peak).toBeLessThanOrEqual(8 * 1024 + 1024 + 64);
    const decoded = frames.map((f) => decodeFileTransferFrame(f));
    expect(decoded.at(-1)!.opcode).toBe("End");
    const body = Buffer.concat(
      decoded.map((f) => (f.opcode === "Chunk" ? Buffer.from(f.data) : Buffer.alloc(0))),
    );
    expect(body.equals(content)).toBe(true);
  });

  it("does not pace a socket that cannot report its queue", async () => {
    const file = join(dir, "plain.bin");
    await writeFile(file, Buffer.alloc(50_000, "z"));
    const svc = new FileTransferService({ chunkBytes: 1024, highWaterBytes: 1, lowWaterBytes: 0 });
    const frames: Uint8Array[] = [];
    const result = await svc.startDownload(svc.issueDownloadToken(file), 1, (f) => frames.push(f), {
      bufferedAmount: () => undefined,
      isOpen: () => true,
    });
    expect(result.ok).toBe(true);
    expect(decodeFileTransferFrame(frames.at(-1)!).opcode).toBe("End");
  });

  it("sends one Error frame and no End when the read fails", async () => {
    const svc = new FileTransferService();
    const { binary } = fakeSession();
    const result = await svc.startDownload(svc.issueDownloadToken(join(dir, "gone.bin")), 5, (f) =>
      binary.push(f),
    );
    expect(result).toMatchObject({ ok: false, error: "read_failed" });
    expect(binary.map((b) => decodeFileTransferFrame(b).opcode)).toEqual(["Begin", "Error"]);
  });

  it("stops reading, and sends no End, when the socket closes mid-download", async () => {
    const file = join(dir, "closing.bin");
    await writeFile(file, Buffer.alloc(200_000, "q"));
    const svc = new FileTransferService({
      chunkBytes: 1024,
      highWaterBytes: 4 * 1024,
      lowWaterBytes: 1024,
      drainPollMs: 1,
    });
    const { state, pacing, sink } = slowSocket(4 * 1024);
    const frames: Uint8Array[] = [];
    const running = svc.startDownload(
      svc.issueDownloadToken(file),
      2,
      (f) => {
        frames.push(f);
        sink(f);
      },
      pacing,
    );
    // Nothing ever drains: the read pauses at the mark. Then the socket dies.
    await waitUntil(() => state.queued > 4 * 1024);
    const sentWhenPaused = frames.length;
    state.open = false;

    expect(await running).toMatchObject({ ok: false, error: "connection_closed" });
    expect(frames).toHaveLength(sentWhenPaused);
    expect(decodeFileTransferFrame(frames.at(-1)!).opcode).toBe("Chunk");
  });
});

describe("FileTransferService upload ownership", () => {
  it("ignores upload frames from a session that does not own the stream", async () => {
    const rig = await openUpload(dir, "owned.txt");
    const intruder = fakeSession("s2").session;
    rig.push(
      { opcode: "Begin", stream: rig.stream, meta: { transferId: rig.transferId } },
      intruder,
    );
    rig.push({ opcode: "Chunk", stream: rig.stream, data: encoder.encode("evil") }, intruder);
    rig.push({ opcode: "End", stream: rig.stream, ok: true }, intruder);
    await new Promise((r) => setTimeout(r, 30));
    await expect(readFile(rig.target)).rejects.toThrow(); // nothing was created

    // The stream is still the owner's: it completes normally afterwards.
    rig.push({ opcode: "Begin", stream: rig.stream, meta: { transferId: rig.transferId } });
    rig.push({ opcode: "Chunk", stream: rig.stream, data: encoder.encode("mine") });
    rig.push({ opcode: "End", stream: rig.stream, ok: true });
    await waitUntil(async () => (await readFile(rig.target, "utf8").catch(() => "")) === "mine");
  });

  it("frees the stream and stops writing when the session closes mid-upload", async () => {
    const rig = await openUpload(dir, "dropped.txt");
    rig.push({ opcode: "Begin", stream: rig.stream, meta: { transferId: rig.transferId } });
    rig.push({ opcode: "Chunk", stream: rig.stream, data: encoder.encode("kept") });
    await waitUntil(async () => (await readFile(rig.target, "utf8").catch(() => "")) === "kept");

    rig.svc.disposeSession(rig.session);
    rig.push({ opcode: "Chunk", stream: rig.stream, data: encoder.encode("late") });
    await new Promise((r) => setTimeout(r, 30));
    expect(await readFile(rig.target, "utf8")).toBe("kept");

    // The stream id is reusable: a new upload on the same service is not refused.
    const registry = new HandlerRegistry();
    rig.svc.registerHandlers(registry);
    const again = (await registry.get("file_upload_request")!({
      session: fakeSession("s3").session,
      message: { type: "file_upload_request", path: join(dir, "next.txt"), transferId: "up-2" },
      requestId: "r2",
    })) as { ok: boolean };
    expect(again.ok).toBe(true);
  });
});

const completes = (text: unknown[]) =>
  text.filter(
    (t) => (t as { message?: { type?: string } }).message?.type === "file_upload_complete",
  ) as Array<{ type: string; message: Record<string, unknown> }>;

describe("FileTransferService upload acknowledgement", () => {
  it("pushes one ok completion with the byte count, after the file is closed and complete", async () => {
    const rig = await openUpload(dir, "acked.txt", { ack: true });
    rig.push({ opcode: "Begin", stream: rig.stream, meta: { transferId: rig.transferId } });
    rig.push({ opcode: "Chunk", stream: rig.stream, data: encoder.encode("hello ") });
    rig.push({ opcode: "Chunk", stream: rig.stream, data: encoder.encode("world") });
    rig.push({ opcode: "End", stream: rig.stream, ok: true });
    await waitUntil(() => completes(rig.text).length > 0);

    // At the moment the push is visible, the file already holds exactly the uploaded bytes.
    expect(await readFile(rig.target, "utf8")).toBe("hello world");
    const [only, ...rest] = completes(rig.text);
    expect(rest).toEqual([]);
    expect(only!.type).toBe("session");
    const complete = fileUploadCompleteSchema.parse(only!.message);
    expect(complete).toMatchObject({
      transferId: rig.transferId,
      stream: rig.stream,
      ok: true,
      bytesWritten: 11,
    });
    expect(complete.error).toBeUndefined();
  });

  it("reports a zero-byte upload as ok with bytesWritten 0 and creates the file", async () => {
    const rig = await openUpload(dir, "empty.txt", { ack: true });
    rig.push({ opcode: "Begin", stream: rig.stream, meta: { transferId: rig.transferId } });
    rig.push({ opcode: "End", stream: rig.stream, ok: true });
    await waitUntil(() => completes(rig.text).length > 0);
    expect(completes(rig.text)[0]!.message).toMatchObject({ ok: true, bytesWritten: 0 });
    expect(await readFile(rig.target, "utf8")).toBe("");
  });

  it("sends nothing when the request did not ask for an acknowledgement", async () => {
    const rig = await openUpload(dir, "silent.txt");
    rig.push({ opcode: "Begin", stream: rig.stream, meta: { transferId: rig.transferId } });
    rig.push({ opcode: "Chunk", stream: rig.stream, data: encoder.encode("x") });
    rig.push({ opcode: "End", stream: rig.stream, ok: true });
    await waitUntil(async () => (await readFile(rig.target, "utf8").catch(() => "")) === "x");
    await new Promise((r) => setTimeout(r, 30));
    expect(rig.text).toEqual([]);
  });

  it("reports a failure to open the target with the daemon's reason, and frees the stream", async () => {
    // The target path is a directory: open(…, "w") fails with EISDIR.
    const rig = await openUpload(dir, ".", { ack: true });
    rig.push({ opcode: "Begin", stream: rig.stream, meta: { transferId: rig.transferId } });
    rig.push({ opcode: "Chunk", stream: rig.stream, data: encoder.encode("x") });
    rig.push({ opcode: "End", stream: rig.stream, ok: true });
    await waitUntil(() => completes(rig.text).length > 0);
    const [only, ...rest] = completes(rig.text);
    expect(rest).toEqual([]);
    expect(only!.message).toMatchObject({ ok: false, bytesWritten: 0 });
    expect(String(only!.message.error)).toMatch(/^open_failed \(EISDIR\)$/);
  });

  it("reports a client-sent Error frame as a failed completion", async () => {
    const rig = await openUpload(dir, "aborted.txt", { ack: true });
    rig.push({ opcode: "Begin", stream: rig.stream, meta: { transferId: rig.transferId } });
    rig.push({ opcode: "Chunk", stream: rig.stream, data: encoder.encode("par") });
    rig.push({ opcode: "Error", stream: rig.stream, message: "aborted" });
    await waitUntil(() => completes(rig.text).length > 0);
    expect(completes(rig.text)[0]!.message).toMatchObject({
      ok: false,
      bytesWritten: 3,
      error: "aborted",
    });
    // Frames after the failure hit a released stream and change nothing.
    rig.push({ opcode: "Chunk", stream: rig.stream, data: encoder.encode("more") });
    await new Promise((r) => setTimeout(r, 30));
    expect(await readFile(rig.target, "utf8")).toBe("par");
    expect(completes(rig.text)).toHaveLength(1);
  });
});
