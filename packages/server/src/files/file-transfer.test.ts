import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  decodeFileTransferFrame,
  encodeFileTransferFrame,
  type FileTransferFrame,
} from "@av-pi-studio/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

  it("rejects an invalid/expired token", async () => {
    const svc = new FileTransferService();
    const result = await svc.startDownload("bogus", 1, () => {});
    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid_or_expired_token");
  });
});

describe("FileTransferService upload", () => {
  it("writes the streamed file to the target path", async () => {
    const svc = new FileTransferService();
    const target = join(dir, "nested", "out.txt");
    const transferId = "up-1";

    // Register the upload via RPC handler to get a stream id.
    const registry = new (await import("../ws/router.js")).HandlerRegistry();
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
});
