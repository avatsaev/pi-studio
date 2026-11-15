import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import {
  createRelayTransport,
  DaemonClient,
  FileTransferClient,
  parsePairingUrl,
  relayDialUrl,
  RelayConnectError,
  type AnyWebSocket,
} from "@av-pi-studio/client";
import { deriveRelaySessionId } from "@av-pi-studio/relay";
import { startRelayServer, type RelayServerHandle } from "@av-pi-studio/relay/server";
import { silentLogger, startDaemon, type DaemonHandle } from "@av-pi-studio/server";

import { buildPairingUrl, readDaemonPublicKey } from "./pairing.js";

/**
 * Relay protocol 2 end to end (swe/features/relay-multi-client.md § Acceptance criteria): the SDK
 * (`createRelayTransport` → `DaemonClient`) through the REAL relay server into the production
 * `startDaemon`. Lives in `cli` because it is the only package depending on client, server and
 * relay together.
 */

const MiB = 1024 * 1024;
const FILE_SIZE = 64 * MiB;

interface Rig {
  relay: RelayServerHandle;
  home: string;
  pairingUrl: string;
}

/** Frames one client's socket sent and received, as `text` or `binary`. */
interface FrameLog {
  sent: Array<"text" | "binary">;
  received: Array<"text" | "binary">;
}

let relay: RelayServerHandle | undefined;
let daemon: DaemonHandle | undefined;
let home: string | undefined;
let work: string | undefined;
const clients: DaemonClient[] = [];
const files: FileTransferClient[] = [];
const rawSockets: WebSocket[] = [];

afterEach(async () => {
  for (const f of files.splice(0)) f.stop();
  for (const c of clients.splice(0)) c.close();
  for (const ws of rawSockets.splice(0)) ws.terminate();
  // The daemon first: its sockets must drop before the relay's `close()` has to wait for them.
  await daemon?.close();
  await relay?.close();
  if (home) await rm(home, { recursive: true, force: true });
  if (work) await rm(work, { recursive: true, force: true });
  daemon = undefined;
  relay = undefined;
  home = undefined;
  work = undefined;
});

function listeningPort(server: Server): Promise<number> {
  if (server.listening) return Promise.resolve((server.address() as AddressInfo).port);
  const { promise, resolve } = Promise.withResolvers<number>();
  server.once("listening", () => resolve((server.address() as AddressInfo).port));
  return promise;
}

async function bootDaemon(dir: string): Promise<DaemonHandle> {
  const handle = startDaemon({ host: "127.0.0.1", port: 0, home: dir, logger: silentLogger() });
  await listeningPort(handle.httpServer);
  return handle;
}

/** Wait until the relay holds the daemon's control socket, i.e. clients can be routed to it. */
async function waitForControl(r: RelayServerHandle, count: number): Promise<void> {
  await expect.poll(() => r.counts().controls, { timeout: 5000 }).toBe(count);
}

async function boot(): Promise<Rig> {
  relay = await startRelayServer({ host: "127.0.0.1", port: 0, attachTimeoutMs: 2000 });
  home = await mkdtemp(join(tmpdir(), "pi-studio-relay-e2e-"));
  work = await mkdtemp(join(tmpdir(), "pi-studio-relay-e2e-files-"));
  await writeFile(
    join(home, "config.json"),
    JSON.stringify({
      daemon: {
        relay: { enabled: true, endpoint: `127.0.0.1:${relay.port}`, useTls: false },
        extensions: { autoSync: false },
      },
    }),
  );
  daemon = await bootDaemon(home);
  await waitForControl(relay, 1);
  const publicKey = readDaemonPublicKey(home);
  if (!publicKey) throw new Error("daemon wrote no keypair");
  const pairingUrl = buildPairingUrl(publicKey, {
    baseUrl: "http://localhost:8080",
    relay: { endpoint: `127.0.0.1:${relay.port}`, useTls: false },
  });
  return { relay, home, pairingUrl };
}

function newClient(
  pairingUrl: string,
  clientId: string,
  log?: FrameLog,
  connectTimeoutMs?: number,
): DaemonClient {
  const offer = parsePairingUrl(pairingUrl);
  if (!offer?.relay) throw new Error("pairing url has no relay");
  const factory = (url: string): AnyWebSocket => {
    const ws = new WebSocket(url);
    if (log) {
      const send = ws.send.bind(ws) as (data: unknown, ...rest: unknown[]) => void;
      (ws as unknown as { send: typeof send }).send = (data, ...rest) => {
        log.sent.push(typeof data === "string" ? "text" : "binary");
        send(data, ...rest);
      };
      ws.on("message", (_data, isBinary) => log.received.push(isBinary ? "binary" : "text"));
    }
    return ws as unknown as AnyWebSocket;
  };
  const client = new DaemonClient({
    url: relayDialUrl(offer.relay),
    clientId,
    clientType: "cli",
    transport: createRelayTransport({
      daemonPublicKey: offer.publicKey,
      factory,
      ...(connectTimeoutMs === undefined ? {} : { connectTimeoutMs }),
    }),
  });
  clients.push(client);
  return client;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function connectFailure(client: DaemonClient): Promise<RelayConnectError> {
  const error = await client.connect().then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(RelayConnectError);
  return error as RelayConnectError;
}

interface StatusPayload {
  clients: Array<{ clientId: string; transport: string }>;
}

async function relayClientIds(via: DaemonClient): Promise<string[]> {
  const status = await via.request<StatusPayload>("daemon_status_request");
  return status.clients
    .filter((c) => c.transport === "relay")
    .map((c) => c.clientId)
    .toSorted();
}

describe("relay protocol 2: SDK ↔ real relay ↔ real daemon", () => {
  it("serves two clients at once; closing one leaves the other working", async () => {
    const rig = await boot();
    const a = newClient(rig.pairingUrl, "e2e-a");
    const b = newClient(rig.pairingUrl, "e2e-b");
    await Promise.all([a.connect(), b.connect()]);

    const [listA, listB] = await Promise.all([
      a.request("list_agents_request"),
      b.request("list_agents_request"),
    ]);
    expect(listA).toBeDefined();
    expect(listB).toBeDefined();
    expect(await relayClientIds(a)).toEqual(["e2e-a", "e2e-b"]);

    a.close();
    await expect.poll(() => relayClientIds(b), { timeout: 5000 }).toEqual(["e2e-b"]);
    await expect(b.request("list_agents_request")).resolves.toBeDefined();
  }, 20_000);

  it("rejects the 33rd client with too_many_clients; a slot freed by a close is reusable", async () => {
    const rig = await boot();
    const sessionId = deriveRelaySessionId(parsePairingUrl(rig.pairingUrl)!.publicKey);
    // 30 relay-level sockets count toward the cap without a full SDK handshake each.
    for (let i = 0; i < 30; i++) {
      const ws = new WebSocket(`ws://127.0.0.1:${rig.relay.port}`);
      rawSockets.push(ws);
      const paired = Promise.withResolvers<void>();
      ws.on("message", (data: Buffer, isBinary: boolean) => {
        if (!isBinary && data.toString("utf8").includes("relay_paired")) paired.resolve();
      });
      ws.on("error", paired.reject);
      ws.on("open", () =>
        ws.send(JSON.stringify({ type: "relay_client_connect", v: 2, sessionId })),
      );
      await paired.promise;
    }
    const sdk31 = newClient(rig.pairingUrl, "e2e-31");
    const sdk32 = newClient(rig.pairingUrl, "e2e-32");
    await sdk31.connect();
    await sdk32.connect();

    const refused = await connectFailure(newClient(rig.pairingUrl, "e2e-33"));
    expect(refused.reason).toBe("too_many_clients");

    sdk31.close();
    await expect.poll(() => rig.relay.counts().pairs, { timeout: 5000 }).toBe(31);
    const again = newClient(rig.pairingUrl, "e2e-33b");
    await again.connect();
    await expect(again.request("list_agents_request")).resolves.toBeDefined();
  }, 30_000);

  it("transfers 64 MiB down and up through the relay with matching SHA-256, while a second client stays responsive", async () => {
    const rig = await boot();
    const a = newClient(rig.pairingUrl, "e2e-xfer");
    const b = newClient(rig.pairingUrl, "e2e-other");
    await Promise.all([a.connect(), b.connect()]);
    const transfer = new FileTransferClient(a);
    transfer.start();
    files.push(transfer);

    const source = randomBytes(FILE_SIZE);
    const sourcePath = join(work!, "source.bin");
    await writeFile(sourcePath, source);
    const expected = sha256(source);

    // Download, with the second client answering an RPC while the stream is in flight.
    const hash = createHash("sha256");
    let received = 0;
    let concurrent: Promise<unknown> | undefined;
    let answeredMidStream = false;
    await transfer.downloadTo(sourcePath, (chunk) => {
      hash.update(chunk);
      received += chunk.length;
      if (!concurrent) {
        concurrent = b.request("list_agents_request").then(() => {
          answeredMidStream = received < FILE_SIZE;
        });
      }
    });
    await concurrent;
    expect(received).toBe(FILE_SIZE);
    expect(hash.digest("hex")).toBe(expected);
    expect(answeredMidStream).toBe(true);

    // Upload the same bytes to a new path and compare what landed on disk.
    const target = join(work!, "uploaded", "copy.bin");
    await transfer.upload(target, new Blob([source]));
    expect(sha256(await readFile(target))).toBe(expected);
  }, 60_000);

  it("after pairing, every frame in both directions is binary", async () => {
    const rig = await boot();
    const log: FrameLog = { sent: [], received: [] };
    const client = newClient(rig.pairingUrl, "e2e-binary", log);
    await client.connect();
    await client.request("list_agents_request");
    await client.request("daemon_status_request");

    // Exactly one text frame each way: `relay_client_connect` out, `relay_paired` back.
    expect(log.sent[0]).toBe("text");
    expect(log.received[0]).toBe("text");
    expect(log.sent.length).toBeGreaterThan(3);
    expect(log.received.length).toBeGreaterThan(3);
    expect(log.sent.slice(1).every((t) => t === "binary")).toBe(true);
    expect(log.received.slice(1).every((t) => t === "binary")).toBe(true);
  }, 20_000);

  it("rejects with daemon_offline in under 1 s once the daemon is stopped", async () => {
    const rig = await boot();
    await daemon!.close();
    daemon = undefined;
    await expect.poll(() => rig.relay.counts().controls, { timeout: 5000 }).toBe(0);

    const started = Date.now();
    const client = newClient(rig.pairingUrl, "e2e-offline");
    const refused = await connectFailure(client);
    expect(refused.reason).toBe("daemon_offline");
    expect(Date.now() - started).toBeLessThan(1000);
    // A refused connect must leave the client `closed`, not stuck in `connecting`: only then can
    // a reconnect loop (the workbench's) retry and the connection bar show the failure.
    expect(client.state).toBe("closed");

    // The daemon comes back (same home, same key): the SAME client object connects now.
    daemon = await bootDaemon(rig.home);
    await waitForControl(rig.relay, 1);
    await client.connect();
    expect(client.state).toBe("open");
  }, 20_000);

  it("a pairing URL made before a daemon restart (same home, same key) still connects (D14)", async () => {
    const rig = await boot();
    const before = newClient(rig.pairingUrl, "e2e-before");
    await before.connect();
    before.close();

    await daemon!.close();
    daemon = undefined;
    await waitForControl(rig.relay, 0);
    daemon = await bootDaemon(rig.home);
    await waitForControl(rig.relay, 1);

    const after = newClient(rig.pairingUrl, "e2e-after");
    await after.connect();
    await expect(after.request("list_agents_request")).resolves.toBeDefined();
  }, 30_000);
});
