import { encodeFileTransferFrame, type FileTransferFrame } from "@av-pi-studio/protocol";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HandlerRegistry } from "../ws/router.js";
import { Session } from "../ws/session.js";
import { FileTransferService } from "./file-transfer.js";
import { UploadJournal } from "./upload-journal.js";

let dir: string;
let journalPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "upload-journal-"));
  journalPath = join(dir, "home", "pending-uploads.json");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const tempName = (n: number): string => `.pistudio-upload-${n.toString(16).padStart(32, "0")}.part`;
const listed = async (): Promise<string[]> =>
  (JSON.parse(await readFile(journalPath, "utf8")) as { files: string[] }).files;

function session(): Session {
  return new Session({
    id: "s1",
    clientId: "c1",
    clientType: "cli",
    capabilities: {},
    socket: { send: () => {}, close: () => {} } as never,
  });
}

describe("UploadJournal", () => {
  it("removes the temporary files an earlier daemon listed, and nothing else", async () => {
    const left = join(dir, tempName(1));
    const gone = join(dir, tempName(2));
    const notOurs = join(dir, "notes.txt");
    await writeFile(left, "half an upload");
    await writeFile(notOurs, "keep me");
    await new UploadJournal(journalPath).add(left);
    await writeFile(
      journalPath,
      JSON.stringify({ version: 1, files: [left, gone, notOurs, tempName(3)] }),
    );

    const journal = new UploadJournal(journalPath);

    expect(await journal.swept).toBe(1);
    expect(existsSync(left)).toBe(false);
    expect(await readFile(notOurs, "utf8")).toBe("keep me");
    expect(existsSync(journalPath)).toBe(false);
  });

  it("removes a journal it cannot read and carries on", async () => {
    await new UploadJournal(journalPath).add(join(dir, tempName(1)));
    await writeFile(journalPath, "{ not json");

    const journal = new UploadJournal(journalPath);

    expect(await journal.swept).toBe(0);
    expect(existsSync(journalPath)).toBe(false);
    await journal.add(join(dir, tempName(4)));
    expect(await listed()).toEqual([join(dir, tempName(4))]);
  });
});

const waitFor = async (check: () => Promise<boolean> | boolean): Promise<void> => {
  const deadline = Date.now() + 2000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 2));
  }
};
const temps = (): string[] => readdirSync(dir).filter((n) => n.startsWith(".pistudio-upload-"));

async function begin(svc: FileTransferService, target: string) {
  const registry = new HandlerRegistry();
  svc.registerHandlers(registry);
  const s = session();
  const resp = (await registry.get("file_upload_request")!({
    session: s,
    message: { type: "file_upload_request", path: target, transferId: "up-1" },
    requestId: "r",
    afterReply: () => {},
  })) as { ok: boolean; stream: number };
  const handler = svc.binaryHandler();
  const push = (frame: FileTransferFrame) => handler(s, encodeFileTransferFrame(frame));
  push({ opcode: "Begin", stream: resp.stream, meta: { transferId: "up-1" } });
  push({ opcode: "Chunk", stream: resp.stream, data: new TextEncoder().encode("half") });
  return { push, stream: resp.stream };
}

describe("FileTransferService with an upload journal", () => {
  it("lists an upload's temporary file while it runs and drops it once renamed", async () => {
    const svc = new FileTransferService({ uploadJournal: new UploadJournal(journalPath) });
    const target = join(dir, "out.bin");
    const { push, stream } = await begin(svc, target);
    await waitFor(() => temps().length === 1);
    expect(await listed()).toEqual([join(dir, temps()[0]!)]);

    push({ opcode: "End", stream, ok: true });
    await waitFor(() => existsSync(target));
    await waitFor(async () => (await listed()).length === 0);
    expect(temps()).toEqual([]);
  });

  it("has the next daemon remove the temporary file of a daemon that died mid-upload", async () => {
    // The first service is abandoned mid-upload, as a killed daemon would be: nothing runs its cleanup.
    const first = new FileTransferService({ uploadJournal: new UploadJournal(journalPath) });
    await begin(first, join(dir, "out.bin"));
    await waitFor(() => temps().length === 1);
    await waitFor(async () => existsSync(journalPath) && (await listed()).length === 1);

    const next = new UploadJournal(journalPath);

    expect(await next.swept).toBe(1);
    expect(temps()).toEqual([]);
    expect(existsSync(join(dir, "out.bin"))).toBe(false);
  });

  it("lists nothing once the daemon stopped mid-upload: file removed, journal on disk emptied", async () => {
    const svc = new FileTransferService({ uploadJournal: new UploadJournal(journalPath) });
    await begin(svc, join(dir, "out.bin"));
    await waitFor(() => temps().length === 1);
    await waitFor(async () => existsSync(journalPath) && (await listed()).length === 1);

    await svc.close();

    expect(temps()).toEqual([]);
    expect(existsSync(join(dir, "out.bin"))).toBe(false);
    expect(await listed()).toEqual([]);
  });
});
