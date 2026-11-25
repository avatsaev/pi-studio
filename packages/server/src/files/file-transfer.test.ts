import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  stat,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import {
  decodeFileTransferFrame,
  encodeFileTransferFrame,
  type FileTransferFrame,
  fileUploadCompleteSchema,
} from "@av-pi-studio/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HandlerRegistry, routeTextFrame } from "../ws/router.js";
import { Session } from "../ws/session.js";
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

interface Downloaded {
  response: Record<string, unknown>;
  /** False when the request was rejected (no stream was started). */
  accepted: boolean;
  frames: FileTransferFrame[];
  body: Buffer;
}

const openSocket: DownloadPacing = { bufferedAmount: () => undefined, isOpen: () => true };

/** Answer a download request, then run its stream to the end into a frame list. */
async function download(
  svc: FileTransferService,
  request: Record<string, unknown>,
  pacing: DownloadPacing = openSocket,
  sessionId = "s1",
): Promise<Downloaded> {
  const { response, run } = await svc.beginDownload(sessionId, {
    type: "file_download_request",
    ...request,
  });
  const raw: Uint8Array[] = [];
  if (run) await run((f) => raw.push(f), pacing);
  const frames = raw.map((b) => decodeFileTransferFrame(b));
  const body = Buffer.concat(
    frames.flatMap((f) => (f.opcode === "Chunk" ? [Buffer.from(f.data)] : [])),
  );
  return { response, accepted: run !== undefined, frames, body };
}

describe("FileTransferService download", () => {
  it("sends the whole file in bounded chunks and announces its size", async () => {
    const file = join(dir, "data.txt");
    const content = "X".repeat(100_000); // > chunk size → multiple Chunk frames
    await writeFile(file, content);
    const svc = new FileTransferService({ chunkBytes: 32 * 1024 });

    const { response, frames, body } = await download(svc, { path: file, stream: 7 });

    expect(response).toMatchObject({
      type: "file_download_response",
      ok: true,
      stream: 7,
      totalBytes: 100_000,
      offset: 0,
      length: 100_000,
      mtimeMs: Math.trunc((await stat(file)).mtimeMs),
    });
    expect(Number.isInteger(response.mtimeMs)).toBe(true);
    const begin = frames[0]!;
    expect(begin.opcode).toBe("Begin");
    if (begin.opcode === "Begin") {
      expect(begin.meta).toMatchObject({
        transferId: response.transferId,
        fileName: "data.txt",
        mimeType: "application/octet-stream", // unknown extension
        totalBytes: 100_000,
        mtimeMs: response.mtimeMs,
        offset: 0,
        length: 100_000,
      });
    }
    expect(frames.filter((f) => f.opcode === "Chunk").length).toBeGreaterThan(1);
    expect(body.toString()).toBe(content);
    expect(frames.at(-1)).toEqual({ opcode: "End", stream: 7, ok: true });
  });

  it("stamps the Begin frame with a known extension's MIME type", async () => {
    const file = join(dir, "shot.png");
    await writeFile(file, "not-really-png-bytes");
    const { frames } = await download(new FileTransferService(), { path: file, stream: 1 });
    const begin = frames[0]!;
    expect(begin.opcode === "Begin" && begin.meta.mimeType).toBe("image/png");
  });

  it("follows a symlink to the real file", async () => {
    const file = join(dir, "real.txt");
    await writeFile(file, "real bytes");
    await symlink(file, join(dir, "link.txt"));
    const { response, body } = await download(new FileTransferService(), {
      path: join(dir, "link.txt"),
    });
    expect(response).toMatchObject({ ok: true, totalBytes: 10 });
    expect(body.toString()).toBe("real bytes");
  });

  it("sends exactly the requested range, and consecutive ranges rebuild the file", async () => {
    const file = join(dir, "ranged.bin");
    const content = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251));
    await writeFile(file, content);
    const svc = new FileTransferService({ chunkBytes: 1024 });

    const middle = await download(svc, { path: file, offset: 1500, length: 2000 });
    expect(middle.response).toMatchObject({
      ok: true,
      totalBytes: 5000,
      offset: 1500,
      length: 2000,
    });
    expect(middle.body.equals(content.subarray(1500, 3500))).toBe(true);
    expect(middle.frames.at(-1)!.opcode).toBe("End");

    const parts: Buffer[] = [];
    for (let offset = 0; offset < content.length; offset += 1800) {
      parts.push((await download(svc, { path: file, offset, length: 1800 })).body);
    }
    expect(Buffer.concat(parts).equals(content)).toBe(true);
  });

  it("clamps a length past the end and reports the real count", async () => {
    const file = join(dir, "short.bin");
    await writeFile(file, "0123456789");
    const { response, body } = await download(new FileTransferService(), {
      path: file,
      offset: 6,
      length: 1000,
    });
    expect(response).toMatchObject({ ok: true, totalBytes: 10, offset: 6, length: 4 });
    expect(body.toString()).toBe("6789");
  });

  it("treats an offset at the end, and an empty file, as a legal empty download", async () => {
    const file = join(dir, "tail.bin");
    await writeFile(file, "abc");
    const atEnd = await download(new FileTransferService(), { path: file, offset: 3, stream: 2 });
    expect(atEnd.response).toMatchObject({ ok: true, totalBytes: 3, offset: 3, length: 0 });
    expect(atEnd.frames.map((f) => f.opcode)).toEqual(["Begin", "End"]);

    const empty = join(dir, "empty.bin");
    await writeFile(empty, "");
    const none = await download(new FileTransferService(), { path: empty, stream: 2 });
    expect(none.response).toMatchObject({ ok: true, totalBytes: 0, length: 0 });
    expect(none.frames.map((f) => f.opcode)).toEqual(["Begin", "End"]);
  });

  describe("rejections (answered, and no binary frame follows)", () => {
    let file: string;
    beforeEach(async () => {
      file = join(dir, "ten.bin");
      await writeFile(file, "0123456789");
    });

    const rejects = async (request: Record<string, unknown>, error: string) => {
      const result = await download(new FileTransferService(), request);
      expect(result.response).toMatchObject({ type: "file_download_response", ok: false, error });
      expect(result.accepted).toBe(false);
      expect(result.frames).toEqual([]);
    };

    it("missing_path", async () => {
      await rejects({}, "missing_path");
      await rejects({ path: "" }, "missing_path");
      await rejects({ path: 5 }, "missing_path");
    });
    it("not_found", async () => rejects({ path: join(dir, "gone.bin") }, "not_found"));
    it("not_a_file", async () => rejects({ path: dir }, "not_a_file"));
    it("invalid_stream", async () => {
      for (const stream of [256, -1, 1.5, "3"])
        await rejects({ path: file, stream }, "invalid_stream");
    });
    it("invalid_range", async () => {
      await rejects({ path: file, offset: -1 }, "invalid_range");
      await rejects({ path: file, offset: 1.5 }, "invalid_range");
      await rejects({ path: file, offset: "2" }, "invalid_range");
      await rejects({ path: file, length: 0 }, "invalid_range");
      await rejects({ path: file, length: -5 }, "invalid_range");
    });
    it("range_not_satisfiable", async () =>
      rejects({ path: file, offset: 11 }, "range_not_satisfiable"));
    it.skipIf(process.getuid?.() === 0)("unreadable", async () => {
      await chmod(file, 0o000);
      await rejects({ path: file }, "unreadable");
    });

    it("keeps the stream id on a rejection that has one, and omits it for a bad stream", async () => {
      const svc = new FileTransferService();
      const range = await svc.beginDownload("s1", { path: file, stream: 9, offset: 99 });
      expect(range.response).toMatchObject({ error: "range_not_satisfiable", stream: 9 });
      const bad = await svc.beginDownload("s1", { path: file, stream: 256 });
      expect(bad.response).not.toHaveProperty("stream");
    });
  });

  it("keeps a client-omitted stream inside the one-byte space across many transfers", async () => {
    const file = join(dir, "data.txt");
    await writeFile(file, "payload");
    const svc = new FileTransferService();
    for (let i = 0; i < 300; i++) {
      const { response } = await download(svc, { path: file });
      expect(response.ok).toBe(true);
      expect(response.stream as number).toBeLessThan(256);
    }
  });

  it("sends one Error and no End when the file ends before the announced length", async () => {
    const file = join(dir, "shrinks.bin");
    await writeFile(file, Buffer.alloc(10_000, "s"));
    const svc = new FileTransferService({ chunkBytes: 1024 });
    const { response, run } = await svc.beginDownload("s1", { path: file, stream: 4 });
    expect(response).toMatchObject({ ok: true, totalBytes: 10_000, length: 10_000 });
    await truncate(file, 3000); // truncated between the answer and the stream
    const raw: Uint8Array[] = [];
    await run!((f) => raw.push(f), openSocket);
    const frames = raw.map((b) => decodeFileTransferFrame(b));
    expect(frames.map((f) => f.opcode).filter((o) => o !== "Chunk")).toEqual(["Begin", "Error"]);
    expect(frames.at(-1)).toEqual({ opcode: "Error", stream: 4, message: "changed" });
  });
});

/** A socket that records text and binary frames in one ordered list. */
function wireSocket() {
  const wire: Array<{ text?: Record<string, unknown>; frame?: FileTransferFrame }> = [];
  const socket = {
    readyState: 1,
    bufferedAmount: 0,
    send: (d: unknown) =>
      wire.push(
        typeof d === "string"
          ? { text: JSON.parse(d) }
          : { frame: decodeFileTransferFrame(d as Uint8Array) },
      ),
    close: () => {},
  };
  const session = new Session({
    id: "s1",
    clientId: "c1",
    clientType: "cli",
    capabilities: {},
    socket: socket as never,
  });
  return { wire, socket, session };
}

const request = (path: string) =>
  JSON.stringify({
    type: "session",
    message: { type: "file_download_request", requestId: "r1", path },
  });

describe("download over the router", () => {
  it("sends the response before Begin, and nothing after End", async () => {
    const file = join(dir, "ordered.bin");
    await writeFile(file, Buffer.alloc(70_000, "o"));
    const registry = new HandlerRegistry();
    new FileTransferService({ chunkBytes: 32 * 1024 }).registerHandlers(registry);
    const { wire, session } = wireSocket();

    await routeTextFrame(session, request(file), registry);
    await waitUntil(() => wire.at(-1)?.frame?.opcode === "End");

    expect(wire[0]!.text).toMatchObject({
      type: "session",
      message: { type: "file_download_response", requestId: "r1", ok: true, totalBytes: 70_000 },
    });
    expect(wire[1]!.frame?.opcode).toBe("Begin");
    expect(wire.filter((w) => w.text)).toHaveLength(1);
    expect(wire.at(-1)!.frame?.opcode).toBe("End");
  });

  it("answers at once while a stalled client still has most of the file to receive", async () => {
    // A transfer that outlasts the client's request timeout must not keep the request pending.
    const file = join(dir, "stalled.bin");
    await writeFile(file, Buffer.alloc(500_000, "t"));
    const registry = new HandlerRegistry();
    new FileTransferService({
      chunkBytes: 1024,
      highWaterBytes: 4 * 1024,
      lowWaterBytes: 1024,
      drainPollMs: 1,
    }).registerHandlers(registry);
    const { wire, socket, session } = wireSocket();
    socket.bufferedAmount = 1_000_000; // never drains

    await routeTextFrame(session, request(file), registry);
    expect(wire[0]!.text?.message).toMatchObject({ type: "file_download_response", ok: true });
    await waitUntil(() => wire.some((w) => w.frame?.opcode === "Chunk"));
    // The read paused at the high-water mark: most of the file is still unsent, and the request
    // was answered long before the stream could finish.
    expect(wire.filter((w) => w.frame?.opcode === "Chunk").length).toBeLessThan(10);
    expect(wire.some((w) => w.frame?.opcode === "End")).toBe(false);
    socket.readyState = 3; // the stalled client goes away; the paused read ends silently
  });

  it("answers a rejected request with one message and no binary frame", async () => {
    const registry = new HandlerRegistry();
    new FileTransferService().registerHandlers(registry);
    const { wire, session } = wireSocket();
    await routeTextFrame(session, request(join(dir, "nope.bin")), registry);
    expect(wire).toHaveLength(1);
    expect(wire[0]!.text?.message).toMatchObject({
      ok: false,
      error: "not_found",
      requestId: "r1",
    });
  });

  it("no longer knows the download token request", async () => {
    const registry = new HandlerRegistry();
    new FileTransferService().registerHandlers(registry);
    const { wire, session } = wireSocket();
    await routeTextFrame(
      session,
      JSON.stringify({
        type: "session",
        message: { type: "file_download_token_request", requestId: "r1", path: "/x" },
      }),
      registry,
    );
    expect(wire).toHaveLength(1);
    expect(wire[0]!.text?.message).toMatchObject({
      type: "rpc_error",
      code: "unknown_message_type",
      requestId: "r1",
    });
  });
});

/** Open file descriptors of this process (Linux only; the tests that use it skip elsewhere). */
const openFdCount = (): number => readdirSync("/proc/self/fd").length;

const opcodes = (frames: FileTransferFrame[]) => frames.map((f) => f.opcode);

describe("FileTransferService download lifecycle", () => {
  describe("ifUnchanged", () => {
    let file: string;
    let current: { size: number; mtimeMs: number };
    beforeEach(async () => {
      file = join(dir, "valid.bin");
      await writeFile(file, "0123456789");
      current = { size: 10, mtimeMs: Math.trunc((await stat(file)).mtimeMs) };
    });

    it("serves a range whose validator still matches", async () => {
      const { response, body } = await download(new FileTransferService(), {
        path: file,
        offset: 4,
        ifUnchanged: current,
      });
      expect(response).toMatchObject({ ok: true, offset: 4, length: 6 });
      expect(body.toString()).toBe("456789");
    });

    it("rejects a stale validator with the current values and no binary frame", async () => {
      const svc = new FileTransferService();
      for (const ifUnchanged of [
        { size: 10, mtimeMs: current.mtimeMs - 1 },
        { size: 11, mtimeMs: current.mtimeMs },
        "not-an-object",
        { size: "10", mtimeMs: current.mtimeMs },
      ]) {
        const result = await download(svc, { path: file, stream: 6, ifUnchanged });
        expect(result.response).toMatchObject({
          ok: false,
          error: "changed",
          stream: 6,
          totalBytes: 10,
          mtimeMs: current.mtimeMs,
        });
        expect(result.accepted).toBe(false);
        expect(result.frames).toEqual([]);
      }
      // A rejection must not leave its stream id reserved.
      expect((await download(svc, { path: file, stream: 6 })).response.ok).toBe(true);
    });
  });

  it("sends only the announced length when the file grows while it is being sent", async () => {
    const file = join(dir, "grows.bin");
    await writeFile(file, Buffer.alloc(4000, "g"));
    const svc = new FileTransferService({ chunkBytes: 1024 });
    const { response, run } = await svc.beginDownload("s1", { path: file });
    expect(response).toMatchObject({ totalBytes: 4000, length: 4000 });
    await appendFile(file, Buffer.alloc(4000, "h"));
    const raw: Uint8Array[] = [];
    await run!((f) => raw.push(f), openSocket);
    const frames = raw.map((b) => decodeFileTransferFrame(b));
    const body = Buffer.concat(
      frames.flatMap((f) => (f.opcode === "Chunk" ? [Buffer.from(f.data)] : [])),
    );
    expect(body.equals(Buffer.alloc(4000, "g"))).toBe(true);
    expect(frames.at(-1)!.opcode).toBe("End");
  });

  describe("stream ids", () => {
    let file: string;
    beforeEach(async () => {
      file = join(dir, "ids.bin");
      await writeFile(file, "payload");
    });

    it("rejects a second download on a stream the session is using, and frees it after End", async () => {
      const svc = new FileTransferService();
      const first = await svc.beginDownload("s1", { path: file, stream: 5 });
      expect(first.response.ok).toBe(true);

      const second = await svc.beginDownload("s1", { path: file, stream: 5 });
      expect(second.response).toMatchObject({ ok: false, error: "stream_in_use", stream: 5 });
      expect(second.run).toBeUndefined();

      // The same id on another session is a different download.
      const other = await download(svc, { path: file, stream: 5 }, openSocket, "s2");
      expect(other.response.ok).toBe(true);

      // The first is unaffected by the rejection and still completes.
      const raw: Uint8Array[] = [];
      await first.run!((f) => raw.push(f), openSocket);
      expect(decodeFileTransferFrame(raw.at(-1)!).opcode).toBe("End");

      expect((await download(svc, { path: file, stream: 5 })).response.ok).toBe(true);
    });

    it("gives a request without a stream an id that is free on its session", async () => {
      const svc = new FileTransferService();
      const held = await Promise.all(
        [1, 2, 3].map((stream) => svc.beginDownload("s1", { path: file, stream })),
      );
      const ids = new Set<number>();
      for (let i = 0; i < 6; i++) {
        const next = await svc.beginDownload("s1", { path: file });
        expect(next.response.ok).toBe(true);
        ids.add(next.response.stream as number);
        held.push(next);
      }
      expect(ids.size).toBe(6);
      for (const stream of [1, 2, 3]) expect(ids.has(stream)).toBe(false);
      for (const h of held) await h.run!(() => {}, openSocket);
    });

    it("answers no_free_stream when the session has all 256 in use", async () => {
      const svc = new FileTransferService();
      const held = await Promise.all(
        Array.from({ length: 256 }, (_, stream) => svc.beginDownload("s1", { path: file, stream })),
      );
      expect(held.every((h) => h.response.ok === true)).toBe(true);
      const none = await svc.beginDownload("s1", { path: file });
      expect(none.response).toMatchObject({ ok: false, error: "no_free_stream" });
      // Another session is unaffected.
      expect((await download(svc, { path: file }, openSocket, "s2")).response.ok).toBe(true);
      for (const h of held) await h.run!(() => {}, openSocket);
    });
  });

  describe("cancel", () => {
    it("stops reading, sends Error cancelled and no End, and frees the stream", async () => {
      const file = join(dir, "cancel.bin");
      await writeFile(file, Buffer.alloc(1_000_000, "c")); // ~1000 chunks of 1 KiB
      const svc = new FileTransferService({ chunkBytes: 1024 });
      const probe = await open(file, "r");
      const handleProto = Object.getPrototypeOf(probe) as { read: (...a: unknown[]) => unknown };
      await probe.close();
      const readSpy = vi.spyOn(handleProto, "read");
      try {
        const { run } = await svc.beginDownload("s1", { path: file, stream: 2 });
        const frames: FileTransferFrame[] = [];
        let chunks = 0;
        let readsAtCancel = -1;
        await run!((f) => {
          const decoded = decodeFileTransferFrame(f);
          frames.push(decoded);
          if (decoded.opcode === "Chunk" && ++chunks === 3) {
            readsAtCancel = readSpy.mock.calls.length;
            expect(svc.cancelDownload("s1", 2)).toBe(true);
          }
        }, openSocket);

        expect(readsAtCancel).toBeGreaterThan(0);
        expect(frames.at(-1)).toEqual({ opcode: "Error", stream: 2, message: "cancelled" });
        expect(opcodes(frames)).not.toContain("End");
        expect(chunks).toBe(3);
        // No further read of the file after the cancel (one already in flight may land).
        expect(readSpy.mock.calls.length).toBeLessThanOrEqual(readsAtCancel + 2);
        expect((await download(svc, { path: file, stream: 2, length: 1 })).response.ok).toBe(true);
      } finally {
        readSpy.mockRestore();
      }
    });

    it("cancels a download that is paused on a client that is not reading", async () => {
      const file = join(dir, "paused.bin");
      await writeFile(file, Buffer.alloc(300_000, "p"));
      const svc = new FileTransferService({
        chunkBytes: 1024,
        highWaterBytes: 4 * 1024,
        lowWaterBytes: 1024,
        drainPollMs: 1,
      });
      const { state, pacing, sink } = slowSocket(4 * 1024);
      const frames: Uint8Array[] = [];
      const { run } = await svc.beginDownload("s1", { path: file, stream: 8 });
      const running = run!((f) => {
        frames.push(f);
        sink(f);
      }, pacing);
      await waitUntil(() => state.queued > 4 * 1024); // paused at the high-water mark
      expect(svc.cancelDownload("s1", 8)).toBe(true);
      await running;
      expect(decodeFileTransferFrame(frames.at(-1)!)).toEqual({
        opcode: "Error",
        stream: 8,
        message: "cancelled",
      });
    });

    it("sends only Error cancelled when it arrives before the stream has started", async () => {
      const file = join(dir, "early.bin");
      await writeFile(file, "early");
      const svc = new FileTransferService();
      const { run } = await svc.beginDownload("s1", { path: file, stream: 3 });
      expect(svc.cancelDownload("s1", 3)).toBe(true);
      const raw: Uint8Array[] = [];
      await run!((f) => raw.push(f), openSocket);
      expect(raw.map((b) => decodeFileTransferFrame(b))).toEqual([
        { opcode: "Error", stream: 3, message: "cancelled" },
      ]);
    });

    it("accepts a cancel while the file is still being opened: Error alone, or the refusal alone", async () => {
      const file = join(dir, "opening.bin");
      await writeFile(file, "opening");
      const svc = new FileTransferService();

      // The stream id is reserved before the file is opened, so the cancel finds it.
      const accepted = svc.beginDownload("s1", { path: file, stream: 5 });
      expect(svc.cancelDownload("s1", 5)).toBe(true);
      const { response, run } = await accepted;
      expect(response).toMatchObject({ ok: true, stream: 5 });
      const raw: Uint8Array[] = [];
      await run!((f) => raw.push(f), openSocket);
      expect(raw.map((b) => decodeFileTransferFrame(b))).toEqual([
        { opcode: "Error", stream: 5, message: "cancelled" },
      ]);

      // When the open then fails, the refusal is the only answer: no frame follows it.
      const refused = svc.beginDownload("s1", { path: join(dir, "missing.bin"), stream: 6 });
      expect(svc.cancelDownload("s1", 6)).toBe(true);
      const second = await refused;
      expect(second.response).toMatchObject({ ok: false, error: "not_found", stream: 6 });
      expect(second.run).toBeUndefined();
      expect(svc.cancelDownload("s1", 6)).toBe(false); // released
    });

    it("answers not_found after End, for an unknown stream and for another session's stream", async () => {
      const file = join(dir, "done.bin");
      await writeFile(file, "done");
      const svc = new FileTransferService();
      await download(svc, { path: file, stream: 4 });
      expect(svc.cancelDownload("s1", 4)).toBe(false); // finished
      expect(svc.cancelDownload("s1", 200)).toBe(false); // unknown
      const held = await svc.beginDownload("s1", { path: file, stream: 9 });
      expect(svc.cancelDownload("s2", 9)).toBe(false); // someone else's
      await held.run!(() => {}, openSocket);
    });

    it("is served over the router as file_download_cancel_request", async () => {
      const file = join(dir, "rpc.bin");
      await writeFile(file, Buffer.alloc(300_000, "r"));
      const registry = new HandlerRegistry();
      new FileTransferService({
        chunkBytes: 1024,
        highWaterBytes: 4 * 1024,
        lowWaterBytes: 1024,
        drainPollMs: 1,
      }).registerHandlers(registry);
      const { wire, socket, session } = wireSocket();
      socket.bufferedAmount = 1_000_000; // the client stops reading
      const cancel = (stream: unknown) =>
        routeTextFrame(
          session,
          JSON.stringify({
            type: "session",
            message: { type: "file_download_cancel_request", requestId: "c1", stream },
          }),
          registry,
        );

      await routeTextFrame(
        session,
        JSON.stringify({
          type: "session",
          message: { type: "file_download_request", requestId: "d1", path: file, stream: 6 },
        }),
        registry,
      );
      await waitUntil(() => wire.some((w) => w.frame?.opcode === "Chunk"));

      await cancel(6);
      await waitUntil(() => wire.some((w) => w.frame?.opcode === "Error"));
      expect(wire.filter((w) => w.frame?.opcode === "Error")).toHaveLength(1);

      await cancel(6);
      await cancel("six");
      const replies = wire.filter((w) => w.text?.message?.type === "file_download_cancel_response");
      expect(replies.map((w) => w.text!.message)).toMatchObject([
        { ok: true, requestId: "c1" },
        { ok: false, error: "not_found" },
        { ok: false, error: "not_found" },
      ]);
    });
  });

  describe.skipIf(process.platform !== "linux")("session close", () => {
    it("stops a running download and releases its stream id and file handle", async () => {
      const file = join(dir, "closing-mid.bin");
      await writeFile(file, Buffer.alloc(300_000, "k"));
      const registry = new HandlerRegistry();
      const svc = new FileTransferService({
        chunkBytes: 1024,
        highWaterBytes: 4 * 1024,
        lowWaterBytes: 1024,
        drainPollMs: 1,
      });
      svc.registerHandlers(registry);
      const { wire, socket, session } = wireSocket();
      socket.bufferedAmount = 1_000_000;
      const fdsBefore = openFdCount();

      await routeTextFrame(
        session,
        JSON.stringify({
          type: "session",
          message: { type: "file_download_request", requestId: "d1", path: file, stream: 7 },
        }),
        registry,
      );
      await waitUntil(() => wire.some((w) => w.frame?.opcode === "Chunk"));
      expect(openFdCount()).toBeGreaterThan(fdsBefore);
      const sent = wire.length;

      svc.disposeSession(session);
      await waitUntil(() => openFdCount() <= fdsBefore);
      expect(wire).toHaveLength(sent); // nothing sent, not even Error
      expect((await download(svc, { path: file, stream: 7, length: 1 })).response.ok).toBe(true);
    });

    it("releases a download that was accepted but never started", async () => {
      const file = join(dir, "never-started.bin");
      await writeFile(file, "x");
      const svc = new FileTransferService();
      const { session } = wireSocket();
      const fdsBefore = openFdCount();
      const { run } = await svc.beginDownload(session.id, { path: file, stream: 1 });
      expect(openFdCount()).toBeGreaterThan(fdsBefore);

      svc.disposeSession(session);
      await waitUntil(() => openFdCount() <= fdsBefore);
      const raw: Uint8Array[] = [];
      await run!((f) => raw.push(f), openSocket);
      expect(raw).toEqual([]);
      const again = await svc.beginDownload(session.id, { path: file, stream: 1 });
      expect(again.response.ok).toBe(true);
      await again.run!(() => {}, openSocket);
    });

    it("close() stops a running download and releases its file handle when the daemon stops", async () => {
      const file = join(dir, "daemon-stops-mid.bin");
      await writeFile(file, Buffer.alloc(300_000, "k"));
      const registry = new HandlerRegistry();
      const svc = new FileTransferService({
        chunkBytes: 1024,
        highWaterBytes: 4 * 1024,
        lowWaterBytes: 1024,
        drainPollMs: 1,
      });
      svc.registerHandlers(registry);
      const { wire, socket, session } = wireSocket();
      socket.bufferedAmount = 1_000_000;
      const fdsBefore = openFdCount();

      await routeTextFrame(
        session,
        JSON.stringify({
          type: "session",
          message: { type: "file_download_request", requestId: "d1", path: file, stream: 7 },
        }),
        registry,
      );
      await waitUntil(() => wire.some((w) => w.frame?.opcode === "Chunk"));
      expect(openFdCount()).toBeGreaterThan(fdsBefore);
      const sent = wire.length;

      await svc.close();

      await waitUntil(() => openFdCount() <= fdsBefore);
      expect(wire).toHaveLength(sent); // nothing sent, not even Error
    });
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

  it("stays byte-exact when each frame is a view of a buffer that is overwritten after the call", async () => {
    // The socket hands frames over as views of the buffer it received; nothing may keep that view.
    const rig = await openUpload(dir, "view.bin", { ack: true });
    const handler = rig.svc.binaryHandler();
    const payload = Uint8Array.from({ length: 70_000 }, (_, i) => (i * 7) % 256);
    const shared = new Uint8Array(payload.length + 64);
    const deliver = (frame: FileTransferFrame): void => {
      const bytes = encodeFileTransferFrame(frame);
      shared.set(bytes, 16);
      handler(rig.session, shared.subarray(16, 16 + bytes.length));
      shared.fill(0xee);
    };
    deliver({ opcode: "Begin", stream: rig.stream, meta: { transferId: rig.transferId } });
    for (let offset = 0; offset < payload.length; offset += 32 * 1024) {
      deliver({
        opcode: "Chunk",
        stream: rig.stream,
        data: payload.subarray(offset, offset + 32 * 1024),
      });
    }
    deliver({ opcode: "End", stream: rig.stream, ok: true });
    await waitUntil(() => completes(rig.text).length > 0);

    expect([...(await readFile(rig.target))]).toEqual([...payload]);
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
    // A ranged download: pacing does not depend on starting at byte 0.
    const { response, run } = await svc.beginDownload("s1", {
      path: file,
      stream: 3,
      offset: 1000,
    });
    await run!((f) => {
      frames.push(f);
      sink(f);
    }, pacing);
    clearInterval(drain);

    expect(response).toMatchObject({ ok: true, offset: 1000, length: 299_000 });
    // One chunk may overshoot the mark before the pause takes effect (chunk + frame header).
    expect(state.peak).toBeLessThanOrEqual(8 * 1024 + 1024 + 64);
    const decoded = frames.map((f) => decodeFileTransferFrame(f));
    expect(decoded.at(-1)!.opcode).toBe("End");
    const body = Buffer.concat(
      decoded.map((f) => (f.opcode === "Chunk" ? Buffer.from(f.data) : Buffer.alloc(0))),
    );
    expect(body.equals(content.subarray(1000))).toBe(true);
  });

  it("does not pace a socket that cannot report its queue", async () => {
    const file = join(dir, "plain.bin");
    await writeFile(file, Buffer.alloc(50_000, "z"));
    const svc = new FileTransferService({ chunkBytes: 1024, highWaterBytes: 1, lowWaterBytes: 0 });
    const { frames } = await download(svc, { path: file, stream: 1 });
    expect(frames.at(-1)!.opcode).toBe("End");
  });

  it("sends one Error frame and no End when a read fails", async () => {
    const file = join(dir, "bad.bin");
    await writeFile(file, Buffer.alloc(5000, "r"));
    const probe = await open(file, "r");
    const handleProto = Object.getPrototypeOf(probe) as { createReadStream: () => unknown };
    await probe.close();
    const spy = vi.spyOn(handleProto, "createReadStream").mockImplementation(
      () =>
        new Readable({
          read() {
            this.destroy(new Error("EIO"));
          },
        }),
    );
    try {
      const { response, frames } = await download(new FileTransferService(), {
        path: file,
        stream: 5,
      });
      expect(response).toMatchObject({ ok: true });
      expect(frames.map((f) => f.opcode)).toEqual(["Begin", "Error"]);
      expect(frames.at(-1)).toEqual({ opcode: "Error", stream: 5, message: "read_failed" });
    } finally {
      spy.mockRestore();
    }
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
    const { run } = await svc.beginDownload("s1", { path: file, stream: 2 });
    const running = run!((f) => {
      frames.push(f);
      sink(f);
    }, pacing);
    // Nothing ever drains: the read pauses at the mark. Then the socket dies.
    await waitUntil(() => state.queued > 4 * 1024);
    const sentWhenPaused = frames.length;
    state.open = false;

    await running;
    expect(frames).toHaveLength(sentWhenPaused);
    expect(decodeFileTransferFrame(frames.at(-1)!).opcode).toBe("Chunk");
  });

  it("does not let a sink that throws (a socket closed under it) escape as a rejection", async () => {
    const file = join(dir, "throws.bin");
    await writeFile(file, Buffer.alloc(5000, "x"));
    const { run } = await new FileTransferService().beginDownload("s1", {
      path: file,
      stream: 1,
    });
    await expect(
      run!(() => {
        throw new Error("WebSocket is not open");
      }, openSocket),
    ).resolves.toBeUndefined();
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
    await waitUntil(() => partFiles(dir).length === 1);

    rig.svc.disposeSession(rig.session);
    rig.push({ opcode: "Chunk", stream: rig.stream, data: encoder.encode("late") });
    await waitUntil(() => partFiles(dir).length === 0);
    await new Promise((r) => setTimeout(r, 30));
    await expect(readFile(rig.target)).rejects.toThrow();

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

  it("reports a target that is a directory as rename_failed, and frees the stream", async () => {
    // The target path is a directory: the final rename fails with EISDIR.
    await mkdir(join(dir, "sub"));
    const rig = await openUpload(dir, "sub", { ack: true });
    rig.push({ opcode: "Begin", stream: rig.stream, meta: { transferId: rig.transferId } });
    rig.push({ opcode: "Chunk", stream: rig.stream, data: encoder.encode("x") });
    rig.push({ opcode: "End", stream: rig.stream, ok: true });
    await waitUntil(() => completes(rig.text).length > 0);
    const [only, ...rest] = completes(rig.text);
    expect(rest).toEqual([]);
    expect(only!.message).toMatchObject({ ok: false, bytesWritten: 1 });
    expect(String(only!.message.error)).toMatch(/^rename_failed \(EISDIR\)$/);
    expect(partFiles(dir)).toEqual([]);
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
    expect(partFiles(dir)).toEqual([]);
    await expect(readFile(rig.target)).rejects.toThrow();
    expect(completes(rig.text)).toHaveLength(1);
  });
});

function partFiles(root: string): string[] {
  return readdirSync(root).filter((n) => /^\.pistudio-upload-[0-9a-f]{32}\.part$/.test(n));
}

describe("FileTransferService atomic upload", () => {
  it("creates the target only at End and leaves no temporary file", async () => {
    const rig = await openUpload(dir, "new.txt", { ack: true });
    rig.push({ opcode: "Begin", stream: rig.stream, meta: { transferId: rig.transferId } });
    rig.push({ opcode: "Chunk", stream: rig.stream, data: encoder.encode("abc") });
    await waitUntil(() => partFiles(dir).length === 1);
    await expect(stat(rig.target)).rejects.toThrow();
    rig.push({ opcode: "End", stream: rig.stream, ok: true });
    await waitUntil(() => completes(rig.text).length > 0);
    expect(await readFile(rig.target, "utf8")).toBe("abc");
    expect(partFiles(dir)).toEqual([]);
  });

  it("keeps the old file intact when the upload is ended by an Error frame", async () => {
    const rig = await openUpload(dir, "old.txt", { ack: true });
    await writeFile(rig.target, "OLD");
    rig.push({ opcode: "Begin", stream: rig.stream, meta: { transferId: rig.transferId } });
    rig.push({ opcode: "Chunk", stream: rig.stream, data: encoder.encode("new") });
    rig.push({ opcode: "Error", stream: rig.stream, message: "aborted" });
    await waitUntil(() => completes(rig.text).length > 0);
    expect(await readFile(rig.target, "utf8")).toBe("OLD");
    expect(partFiles(dir)).toEqual([]);
  });

  it("keeps the old file intact when the session closes mid-upload", async () => {
    const rig = await openUpload(dir, "old2.txt");
    await writeFile(rig.target, "OLD");
    rig.push({ opcode: "Begin", stream: rig.stream, meta: { transferId: rig.transferId } });
    rig.push({ opcode: "Chunk", stream: rig.stream, data: encoder.encode("new") });
    await waitUntil(() => partFiles(dir).length === 1);
    rig.svc.disposeSession(rig.session);
    await waitUntil(() => partFiles(dir).length === 0);
    expect(await readFile(rig.target, "utf8")).toBe("OLD");
  });

  it("close() leaves no temporary file and the old file intact when the daemon stops mid-upload", async () => {
    const rig = await openUpload(dir, "old4.txt");
    await writeFile(rig.target, "OLD");
    rig.push({ opcode: "Begin", stream: rig.stream, meta: { transferId: rig.transferId } });
    rig.push({ opcode: "Chunk", stream: rig.stream, data: encoder.encode("new") });
    await waitUntil(() => partFiles(dir).length === 1);

    await rig.svc.close();

    expect(partFiles(dir)).toEqual([]); // gone when close resolves, not later
    expect(await readFile(rig.target, "utf8")).toBe("OLD");
  });

  it("close() removes the temporary file of a Begin that was still opening it", async () => {
    const rig = await openUpload(dir, "old5.txt");
    rig.push({ opcode: "Begin", stream: rig.stream, meta: { transferId: rig.transferId } });
    rig.push({ opcode: "Chunk", stream: rig.stream, data: encoder.encode("new") });

    await rig.svc.close(); // no wait: the Begin is not done yet

    expect(partFiles(dir)).toEqual([]);
    await expect(stat(rig.target)).rejects.toThrow(); // the upload never completed
  });

  it("keeps the old file intact when a write fails", async () => {
    const rig = await openUpload(dir, "old3.txt", { ack: true });
    await writeFile(rig.target, "OLD");
    rig.push({ opcode: "Begin", stream: rig.stream, meta: { transferId: rig.transferId } });
    await waitUntil(() => partFiles(dir).length === 1);
    // Removing the temp file under the service makes the final rename fail (ENOENT).
    await rm(join(dir, partFiles(dir)[0]!));
    rig.push({ opcode: "Chunk", stream: rig.stream, data: encoder.encode("zz") });
    rig.push({ opcode: "End", stream: rig.stream, ok: true });
    await waitUntil(() => completes(rig.text).length > 0);
    expect(completes(rig.text)[0]!.message).toMatchObject({ ok: false });
    expect(await readFile(rig.target, "utf8")).toBe("OLD");
    expect(partFiles(dir)).toEqual([]);
  });

  it("lets two concurrent uploads to one target both finish, leaving one whole file", async () => {
    const a = await openUpload(dir, "same.txt", { ack: true, transferId: "a" });
    const b = await openUpload(dir, "same.txt", { ack: true, transferId: "b" });
    for (const [rig, body] of [
      [a, "AAAA"],
      [b, "BBBBBB"],
    ] as const) {
      rig.push({ opcode: "Begin", stream: rig.stream, meta: { transferId: rig.transferId } });
      rig.push({ opcode: "Chunk", stream: rig.stream, data: encoder.encode(body) });
      rig.push({ opcode: "End", stream: rig.stream, ok: true });
    }
    await waitUntil(() => completes(a.text).length > 0 && completes(b.text).length > 0);
    expect(completes(a.text)[0]!.message).toMatchObject({ ok: true });
    expect(completes(b.text)[0]!.message).toMatchObject({ ok: true });
    expect(["AAAA", "BBBBBB"]).toContain(await readFile(a.target, "utf8"));
    expect(partFiles(dir)).toEqual([]);
  });
});

/** A session whose socket records `pause()` / `resume()`; `paused` is true between them. */
function pausableSession(id = "s1") {
  const log: Array<"pause" | "resume"> = [];
  const state = { paused: false };
  const socket = {
    send: () => {},
    close: () => {},
    pause: () => {
      state.paused = true;
      log.push("pause");
    },
    resume: () => {
      state.paused = false;
      log.push("resume");
    },
  };
  const session = new Session({
    id,
    clientId: "c1",
    clientType: "cli",
    capabilities: {},
    socket: socket as never,
  });
  return { session, state, log };
}

describe("FileTransferService paced upload", () => {
  const MIB = 1024 * 1024;
  const FRAME = 32 * 1024;

  async function openPaced(svc: FileTransferService, session: Session, name: string, id: string) {
    const registry = new HandlerRegistry();
    svc.registerHandlers(registry);
    const resp = (await registry.get("file_upload_request")!({
      session,
      message: { type: "file_upload_request", path: join(dir, name), transferId: id },
      requestId: "r",
    })) as { stream: number };
    return resp.stream;
  }

  it("stops reading above 1 MiB and reads again, keeping unwritten bytes bounded", async () => {
    const svc = new FileTransferService({
      writeChunk: async (handle, data) => {
        await new Promise((r) => setTimeout(r, 0));
        await handle.write(data);
      },
    });
    const { session, state, log } = pausableSession();
    const stream = await openPaced(svc, session, "big.bin", "t");
    const handler = svc.binaryHandler();
    const push = (f: FileTransferFrame) => handler(session, encodeFileTransferFrame(f));
    push({ opcode: "Begin", stream, meta: { transferId: "t" } });
    const total = 64 * MIB;
    const data = new Uint8Array(FRAME).fill(7);
    let sent = 0;
    let peakWhileRead = 0;
    // The sender obeys the socket: it sends only while the daemon reads it.
    while (sent < total) {
      if (state.paused) {
        await new Promise((r) => setTimeout(r, 1));
        continue;
      }
      push({ opcode: "Chunk", stream, data });
      sent += FRAME;
      const internal = (
        svc as unknown as { uploads: Map<number, { unwrittenBytes: number }> }
      ).uploads.get(stream)!;
      peakWhileRead = Math.max(peakWhileRead, internal.unwrittenBytes);
      if (sent % (8 * MIB) === 0) await new Promise((r) => setTimeout(r, 0));
    }
    push({ opcode: "End", stream, ok: true });
    await waitUntil(
      () => statSync(join(dir, "big.bin"), { throwIfNoEntry: false })?.size === total,
    );
    expect(peakWhileRead).toBeLessThanOrEqual(MIB + FRAME);
    expect(log.filter((e) => e === "pause").length).toBeGreaterThan(0);
    expect(log.filter((e) => e === "resume").length).toBeGreaterThan(0);
    expect(state.paused).toBe(false);
  }, 60_000);

  it("reads again only when both uploads of a session are under the low mark", async () => {
    const release: Array<() => void> = [];
    let slowHandle: unknown;
    const svc = new FileTransferService({
      writeChunk: async (handle, data) => {
        if (slowHandle === undefined) slowHandle = handle; // the first upload to write is the slow one
        if (handle === slowHandle) await new Promise<void>((r) => release.push(r));
        await handle.write(data);
      },
    });
    const { session, state } = pausableSession();
    const a = await openPaced(svc, session, "a.bin", "a");
    const b = await openPaced(svc, session, "b.bin", "b");
    const handler = svc.binaryHandler();
    const push = (f: FileTransferFrame) => handler(session, encodeFileTransferFrame(f));
    push({ opcode: "Begin", stream: a, meta: { transferId: "a" } });
    push({ opcode: "Begin", stream: b, meta: { transferId: "b" } });
    const data = new Uint8Array(FRAME).fill(1);
    push({ opcode: "Chunk", stream: a, data });
    await waitUntil(() => release.length === 1); // `a` is stuck in its first write
    for (let i = 0; i < 40; i++) push({ opcode: "Chunk", stream: a, data }); // 1.25 MiB behind
    expect(state.paused).toBe(true);
    for (let i = 0; i < 4; i++) push({ opcode: "Chunk", stream: b, data });
    await new Promise((r) => setTimeout(r, 20));
    expect(state.paused).toBe(true); // `b` is written; `a` still holds the session
    // Let `a` drain: release every pending write until it is empty.
    while (state.paused) {
      release.shift()?.();
      await new Promise((r) => setTimeout(r, 1));
    }
    push({ opcode: "End", stream: b, ok: true });
    push({ opcode: "End", stream: a, ok: true });
    while (statSync(join(dir, "a.bin"), { throwIfNoEntry: false }) === undefined) {
      release.shift()?.();
      await new Promise((r) => setTimeout(r, 1));
    }
    await waitUntil(
      () => statSync(join(dir, "b.bin"), { throwIfNoEntry: false })?.size === 4 * FRAME,
    );
    expect(statSync(join(dir, "a.bin")).size).toBe(41 * FRAME);
  });

  it("releases uploads and temporary files when the session closes while stopped", async () => {
    const release: Array<() => void> = [];
    const svc = new FileTransferService({
      writeChunk: async (handle, data) => {
        await new Promise<void>((r) => release.push(r));
        await handle.write(data);
      },
    });
    const { session, state } = pausableSession();
    const stream = await openPaced(svc, session, "gone.bin", "g");
    const handler = svc.binaryHandler();
    const push = (f: FileTransferFrame) => handler(session, encodeFileTransferFrame(f));
    push({ opcode: "Begin", stream, meta: { transferId: "g" } });
    const data = new Uint8Array(FRAME);
    for (let i = 0; i < 40; i++) push({ opcode: "Chunk", stream, data });
    await waitUntil(() => release.length === 1);
    expect(state.paused).toBe(true);
    svc.disposeSession(session);
    expect(state.paused).toBe(false);
    while (partFiles(dir).length > 0) {
      release.shift()?.();
      await new Promise((r) => setTimeout(r, 1));
    }
    expect(partFiles(dir)).toEqual([]);
    await expect(stat(join(dir, "gone.bin"))).rejects.toThrow();
  });

  it("uploads work on a socket without pause", async () => {
    const rig = await openUpload(dir, "plain.txt");
    rig.push({ opcode: "Begin", stream: rig.stream, meta: { transferId: rig.transferId } });
    for (let i = 0; i < 40; i++) {
      rig.push({ opcode: "Chunk", stream: rig.stream, data: new Uint8Array(FRAME) });
    }
    rig.push({ opcode: "End", stream: rig.stream, ok: true });
    await waitUntil(() => statSync(rig.target, { throwIfNoEntry: false })?.size === 40 * FRAME);
  });
});
