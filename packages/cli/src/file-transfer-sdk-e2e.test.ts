import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import {
  createWebSocketTransport,
  DaemonClient,
  FileTransferClient,
  type AnyWebSocket,
} from "@av-pi-studio/client";
import { silentLogger, startDevDaemon, type DevBootstrapHandle } from "@av-pi-studio/server";

/**
 * `FileTransferClient.upload` against a REAL in-process dev daemon over a real WebSocket
 * (sprint-096/task-004): the daemon advertises `fileTransferAck`, so the upload resolves on its
 * `file_upload_complete`, and the bytes are read back from disk. Lives in `cli` because it is the
 * only package that depends on both client and server.
 */

function listeningPort(server: Server): Promise<number> {
  if (server.listening) return Promise.resolve((server.address() as AddressInfo).port);
  const { promise, resolve } = Promise.withResolvers<number>();
  server.once("listening", () => resolve((server.address() as AddressInfo).port));
  return promise;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

let dev: DevBootstrapHandle | undefined;
let client: DaemonClient | undefined;
let files: FileTransferClient | undefined;
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pi-studio-upload-"));
  dev = startDevDaemon({ host: "127.0.0.1", port: 0, logger: silentLogger() });
  const port = await listeningPort(dev.httpServer);
  client = new DaemonClient({
    url: `ws://127.0.0.1:${port}`,
    clientId: "upload-e2e",
    clientType: "cli",
    transport: createWebSocketTransport((url) => new WebSocket(url) as unknown as AnyWebSocket),
  });
  await client.connect();
  files = new FileTransferClient(client);
  files.start();
});

afterEach(async () => {
  files?.stop();
  client?.close();
  await dev?.close();
  await rm(dir, { recursive: true, force: true });
  dev = undefined;
  client = undefined;
  files = undefined;
});

describe("FileTransferClient.upload against a real daemon", () => {
  it("advertises fileTransferAck and exposes the socket's buffered amount", () => {
    expect(client?.hasFeature("fileTransferAck")).toBe(true);
    expect(client?.bufferedAmount).toBeTypeOf("number");
  });

  it("resolves after the daemon closed the file, and the bytes on disk match (Blob source)", async () => {
    const bytes = randomBytes(300_000);
    const target = join(dir, "nested", "dir", "blob.bin");
    const seen: number[] = [];

    await files!.upload(target, new Blob([bytes]), { onProgress: (sent) => seen.push(sent) });

    // `resolve` came from the ack, so the file is complete the instant the promise settles.
    expect(Buffer.from(await readFile(target)).equals(bytes)).toBe(true);
    expect(seen.at(-1)).toBe(bytes.length);
    expect(files!.pendingUploads).toBe(0);
  });

  it("overwrites an existing file from an async iterable", async () => {
    const target = join(dir, "over.bin");
    await writeFile(target, "old contents that are longer than the new ones");
    const parts = [randomBytes(70_000), randomBytes(5)];
    async function* source(): AsyncGenerator<Uint8Array> {
      yield* parts;
    }

    await files!.upload(target, source());

    expect(Buffer.from(await readFile(target)).equals(Buffer.concat(parts))).toBe(true);
  });

  it("rejects with the daemon's error when the target cannot be written", async () => {
    const blocker = join(dir, "a-file");
    await writeFile(blocker, "x");

    // The parent "directory" is a regular file, so the daemon's mkdir fails.
    await expect(
      files!.upload(join(blocker, "child.bin"), new Uint8Array([1, 2, 3])),
    ).rejects.toThrow(/mkdir/);

    expect(files!.pendingUploads).toBe(0);
  });
});

describe("FileTransferClient.download against a real daemon", () => {
  async function fixture(size: number): Promise<{ path: string; bytes: Buffer }> {
    const bytes = randomBytes(size);
    const path = join(dir, "source.bin");
    await writeFile(path, bytes);
    return { path, bytes };
  }

  it("advertises fileDownloadRanges", () => {
    expect(client?.hasFeature("fileDownloadRanges")).toBe(true);
  });

  it("downloads a whole file with its size, mtime and progress", async () => {
    const { path, bytes } = await fixture(300_000);
    const progress: number[] = [];

    const file = await files!.download(path, { onProgress: (received) => progress.push(received) });

    expect(Buffer.from(file.bytes).equals(bytes)).toBe(true);
    expect(file).toMatchObject({
      fileName: "source.bin",
      totalBytes: bytes.length,
      offset: 0,
      length: bytes.length,
    });
    expect(file.mtimeMs).toBe(Math.trunc((await stat(path)).mtimeMs));
    expect(progress.at(-1)).toBe(bytes.length);
    expect(progress).toEqual(progress.toSorted((a, b) => a - b));
    expect(files!.pendingDownloads).toBe(0);
  });

  it("two consecutive ranges concatenate to the file", async () => {
    const { path, bytes } = await fixture(200_001);
    const split = 100_000;

    const first = await files!.download(path, { offset: 0, length: split });
    const second = await files!.download(path, {
      offset: first.offset + first.length,
      ifUnchanged: { size: first.totalBytes, mtimeMs: first.mtimeMs },
    });

    expect(first.length).toBe(split);
    expect(second).toMatchObject({ offset: split, length: bytes.length - split });
    expect(Buffer.concat([first.bytes, second.bytes]).equals(bytes)).toBe(true);
  });

  it("resumes an aborted download from where it stopped, to a matching SHA-256", async () => {
    const { path, bytes } = await fixture(4 * 1024 * 1024);
    const controller = new AbortController();
    const kept: Uint8Array[] = [];
    let received = 0;

    // Start the whole file and give up part-way, from inside the sink: a deterministic point.
    await expect(
      files!.downloadTo(
        path,
        (chunk) => {
          kept.push(chunk.slice());
          received += chunk.length;
          if (received >= 512 * 1024) controller.abort();
        },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    // Everything delivered before the abort took effect is a prefix of the file.
    const prefix = Buffer.concat(kept);
    expect(prefix.length).toBeGreaterThanOrEqual(512 * 1024);
    expect(prefix.length).toBeLessThan(bytes.length);
    expect(prefix.equals(bytes.subarray(0, prefix.length))).toBe(true);

    // Resume from the byte after the last one received, pinned to the file as it is on disk (a
    // client that interrupted a whole-file download knows it from its own record or a stat).
    const info = await stat(path);
    const rest = await files!.download(path, {
      offset: prefix.length,
      ifUnchanged: { size: info.size, mtimeMs: Math.trunc(info.mtimeMs) },
    });

    expect(rest.offset).toBe(prefix.length);
    expect(sha256(Buffer.concat([prefix, rest.bytes]))).toBe(sha256(bytes));
    // The aborted stream's id is held until the daemon's last frame (`cancelled`) is seen.
    await expect.poll(() => files!.pendingDownloads).toBe(0);
  });

  it("refuses to resume after the file was modified: changed, and nothing is pending", async () => {
    const { path, bytes } = await fixture(100_000);
    const first = await files!.download(path, { offset: 0, length: 1000 });

    // A different size is enough to be a different file, whatever the clock's granularity.
    await writeFile(path, Buffer.concat([bytes, randomBytes(10)]));

    await expect(
      files!.download(path, {
        offset: first.length,
        ifUnchanged: { size: first.totalBytes, mtimeMs: first.mtimeMs },
      }),
    ).rejects.toThrow("changed");
    expect(files!.pendingDownloads).toBe(0);
  });
});
