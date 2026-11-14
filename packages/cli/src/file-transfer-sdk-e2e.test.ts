import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
