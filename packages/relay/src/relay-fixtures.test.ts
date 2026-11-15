import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import nacl from "tweetnacl";
import { describe, expect, it } from "vitest";

import {
  CHANNEL_DIRECTION,
  CHANNEL_SALT_LENGTH,
  CHANNEL_VERSION,
  RECORD_KIND,
  channelNonce,
  createClientChannel,
  createDaemonChannel,
  type Transport,
} from "./channel.js";
import { RELAY_CLOSE, encodeControlFrame, type ControlFrame } from "./control.js";
import { deriveRelaySessionId } from "./session-id.js";

/**
 * Fixed-key relay fixtures (architecture/relay-protocol.md §§ 1, 3, 4; feature relay-multi-client
 * § Public contract 5). They live in `packages/protocol/fixtures/external-clients/relay/`, a
 * SUBDIRECTORY with its own manifest, so the dashboard's vendored top-level fixture test is
 * unaffected. The relay package has no runtime dependency on the protocol package: this test reads
 * the files by path.
 *
 * The generator is `buildFixtures()` below. `UPDATE_RELAY_FIXTURES=1 npx vitest run
 * packages/relay/src/relay-fixtures.test.ts` rewrites the files from it; a normal run compares the
 * committed files with it byte for byte, so changing one byte or character of any fixture fails.
 */

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "protocol",
  "fixtures",
  "external-clients",
  "relay",
);

const SINCE = "0.0.121";
const CONNECTION_ID = "0123456789abcdef0123456789abcdef";

const hex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
const fromHex = (text: string): Uint8Array =>
  Uint8Array.from(text.split(" ").map((byte) => Number.parseInt(byte, 16)));
const sequence = (start: number, length: number): Uint8Array =>
  Uint8Array.from({ length }, (_, i) => (start + i) & 0xff);

/** TEST MATERIAL ONLY: fixed seeds, published in the fixtures. Never use these for a real daemon. */
const DAEMON_KEYPAIR = nacl.box.keyPair.fromSecretKey(sequence(0x01, 32));
const CLIENT_KEYPAIR = nacl.box.keyPair.fromSecretKey(sequence(0x81, 32));
const SALT = sequence(0xa0, CHANNEL_SALT_LENGTH);

const TEXT_C2D = JSON.stringify({
  type: "ping",
  requestId: "req-1",
  clientSentAt: 1767225600000,
});
const TEXT_D2C = JSON.stringify({
  type: "pong",
  requestId: "req-1",
  clientSentAt: 1767225600000,
  serverTime: 1767225600005,
});
const BINARY_C2D = Uint8Array.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0x01, 0x02, 0x03]);
const BINARY_D2C = Uint8Array.from([0x10, 0x01, 0xca, 0xfe, 0xba, 0xbe, 0xff, 0x00, 0x7f]);

type Json = Record<string, unknown>;

interface FixtureFile {
  file: string;
  group: "keys" | "control" | "close_codes" | "channel";
  body: Json;
}

/** One message of the in-memory run: what each side sent, in order. */
interface Wire {
  hello: Uint8Array;
  ready: Uint8Array;
  clientToDaemon: Uint8Array[];
  daemonToClient: Uint8Array[];
}

class MemoryTransport implements Transport {
  peer!: MemoryTransport;
  sent: Uint8Array[] = [];
  private frame: (frame: Uint8Array | string) => void = () => {};
  send(bytes: Uint8Array): void {
    this.sent.push(bytes.slice());
    this.peer.frame(bytes.slice());
  }
  onFrame(handler: (frame: Uint8Array | string) => void): void {
    this.frame = handler;
  }
  onClose(): void {}
  close(): void {}
}

/** Drive the real channels (injected key pair and salt) and record every frame on the wire. */
function runChannels(): Wire {
  const clientSide = new MemoryTransport();
  const daemonSide = new MemoryTransport();
  clientSide.peer = daemonSide;
  daemonSide.peer = clientSide;
  const errors: Error[] = [];
  const events = { onText() {}, onBinary() {}, onError: (e: Error) => errors.push(e) };
  // The daemon is created first so it is listening when the client's constructor sends `hello`.
  const daemon = createDaemonChannel({
    transport: daemonSide,
    daemonKeypair: DAEMON_KEYPAIR,
    events,
    randomBytes: () => SALT,
  });
  const client = createClientChannel({
    transport: clientSide,
    daemonPublicKey: DAEMON_KEYPAIR.publicKey,
    keyPair: CLIENT_KEYPAIR,
    events,
  });
  client.send(TEXT_C2D);
  client.sendBinary(BINARY_C2D);
  daemon.send(TEXT_D2C);
  daemon.sendBinary(BINARY_D2C);
  if (errors.length > 0) throw errors[0]!;
  const [hello, ...clientRest] = clientSide.sent as [Uint8Array, ...Uint8Array[]];
  const [ready, ...daemonRest] = daemonSide.sent as [Uint8Array, ...Uint8Array[]];
  return { hello, ready, clientToDaemon: clientRest, daemonToClient: daemonRest };
}

function messageFixture(
  direction: "client_to_daemon" | "daemon_to_client",
  kind: "text" | "binary",
  counter: number,
  frame: Uint8Array,
  payload: Uint8Array | string,
): Json {
  const dir =
    direction === "client_to_daemon"
      ? CHANNEL_DIRECTION.CLIENT_TO_DAEMON
      : CHANNEL_DIRECTION.DAEMON_TO_CLIENT;
  return {
    description: `A ${kind} message ${direction === "client_to_daemon" ? "from the client" : "from the daemon"} at counter ${counter}. \`hex\` is the whole binary WebSocket frame (the box of a record, nothing else); \`decoded\` is what opening it with the \`box.before\` key from keys.json and the \`nonce\` yields: record kind byte then payload. The counter and nonce never travel on the wire.`,
    since: SINCE,
    direction,
    hex: hex(frame),
    decoded: {
      kind,
      kindByte: kind === "text" ? RECORD_KIND.TEXT : RECORD_KIND.BINARY,
      counter,
      nonce: hex(channelNonce(SALT, dir, BigInt(counter))),
      ...(kind === "text"
        ? { payload: payload as string }
        : { payloadHex: hex(payload as Uint8Array) }),
    },
  };
}

function buildFixtures(): FixtureFile[] {
  const sessionId = deriveRelaySessionId(DAEMON_KEYPAIR.publicKey);
  const files: FixtureFile[] = [];

  files.push({
    file: "keys.json",
    group: "keys",
    body: {
      description:
        "Fixed key material every other fixture of this directory is built from. TEST MATERIAL ONLY: these keys are public, so they must never be used for a real daemon.",
      since: SINCE,
      testMaterial: true,
      daemonSecretKey: hex(DAEMON_KEYPAIR.secretKey),
      daemonPublicKey: hex(DAEMON_KEYPAIR.publicKey),
      clientSecretKey: hex(CLIENT_KEYPAIR.secretKey),
      clientPublicKey: hex(CLIENT_KEYPAIR.publicKey),
      salt: hex(SALT),
      sessionId,
      sharedKey: hex(nacl.box.before(CLIENT_KEYPAIR.publicKey, DAEMON_KEYPAIR.secretKey)),
      sessionIdDerivation:
        "hex of the first 16 bytes of SHA-512(daemonPublicKey), lowercase, 32 characters",
      sharedKeyDerivation:
        "nacl.box.before(clientPublicKey, daemonSecretKey) = box.before(daemonPublicKey, clientSecretKey)",
      connectionId: CONNECTION_ID,
    },
  });

  const control = (
    name: string,
    direction: string,
    description: string,
    frame: ControlFrame,
    extra: Json = {},
  ): void => {
    files.push({
      file: `control.${name}.json`,
      group: "control",
      body: {
        type: frame.type,
        direction,
        description,
        since: SINCE,
        ...extra,
        text: encodeControlFrame(frame),
      },
    });
  };
  control(
    "relay_daemon_register",
    "daemon_to_relay",
    "First frame of a daemon's control socket. The relay answers `relay_registered`.",
    { type: "relay_daemon_register", v: 2, sessionId },
  );
  control(
    "relay_registered",
    "relay_to_daemon",
    "The relay's answer to `relay_daemon_register`, on the control socket.",
    { type: "relay_registered" },
  );
  control(
    "relay_client_connect",
    "client_to_relay",
    "First frame of a client socket. The client sends nothing else until `relay_paired`.",
    { type: "relay_client_connect", v: 2, sessionId },
  );
  control(
    "relay_dial",
    "relay_to_daemon",
    "Sent on the control socket when a client wants the daemon. `connectionId` is 128 random bits as 32 lowercase hex characters, chosen by the relay; the value here is an example.",
    { type: "relay_dial", connectionId: CONNECTION_ID },
  );
  control(
    "relay_daemon_attach",
    "daemon_to_relay",
    "First frame of a daemon's data socket, answering a `relay_dial`.",
    { type: "relay_daemon_attach", v: 2, sessionId, connectionId: CONNECTION_ID },
  );
  control(
    "relay_paired",
    "relay_to_client_and_daemon",
    "Sent to the client socket and to the daemon's data socket once they are paired; everything after it is the encrypted channel. `connectionId` is the example value.",
    { type: "relay_paired", connectionId: CONNECTION_ID },
  );
  files.push({
    file: "control.relay_register.legacy.json",
    group: "control",
    body: {
      type: "relay_register",
      direction: "daemon_to_relay",
      description:
        "The registration frame of relay protocol 1 (0.0.120 and earlier). A protocol 2 relay PARKS the socket: it keeps it open and idle, answers nothing, forwards nothing and ignores later frames. A socket that has stayed silent counts as an outdated daemon (close 4105 `daemon_outdated` to a client). Not a frame a protocol 2 client or daemon sends.",
      since: "0.0.115",
      parked: true,
      text: JSON.stringify({ type: "relay_register", sessionId }),
    },
  });

  files.push({
    file: "close-codes.json",
    group: "close_codes",
    body: {
      description:
        "Close codes of relay protocol 2 (relay-protocol.md § 3). The close reason string is `name`. Entries with a null name are standard codes with no relay-specific reason.",
      since: SINCE,
      codes: [
        {
          code: 4100,
          name: "protocol_error",
          sender: "relay",
          condition:
            "Invalid first frame, wrong `v`, malformed `sessionId`, a client frame before `relay_paired`",
        },
        {
          code: 4101,
          name: "identify_timeout",
          sender: "relay",
          condition: "No first frame within 10 s",
        },
        {
          code: 4102,
          name: "daemon_offline",
          sender: "relay_to_client",
          condition: "No control socket for the session id",
        },
        {
          code: 4103,
          name: "daemon_unresponsive",
          sender: "relay_to_client",
          condition: "The daemon did not attach within 10 s",
        },
        {
          code: 4104,
          name: "too_many_clients",
          sender: "relay_to_client",
          condition: "The session id already has 32 connections",
        },
        {
          code: 4105,
          name: "daemon_outdated",
          sender: "relay_to_client",
          condition:
            "No control socket, but a silent old-protocol socket is parked under the session id",
        },
        {
          code: 4106,
          name: "unknown_connection",
          sender: "relay_to_daemon_data_socket",
          condition: "The `connectionId` is not waiting: the client left, or the id is wrong",
        },
        {
          code: 4107,
          name: "replaced",
          sender: "relay_to_daemon_control_socket",
          condition: "A newer control socket registered the same session id",
        },
        { code: 4108, name: "ping_timeout", sender: "relay", condition: "Two unanswered pings" },
        {
          code: 4109,
          name: "peer_closed",
          sender: "relay",
          condition: "The other half closed with a code that cannot be forwarded",
        },
        {
          code: 4200,
          name: "channel_error",
          sender: "client_or_daemon",
          condition: "A channel frame failed: authentication, order, format",
        },
        {
          code: 1009,
          name: null,
          sender: "relay_or_daemon",
          condition: "A frame above the 100 MiB frame-size limit (message too big)",
        },
        {
          code: 1001,
          name: null,
          sender: "relay",
          condition: "The relay is shutting down (going away)",
        },
      ],
    },
  });

  const wire = runChannels();
  files.push({
    file: "channel.hello.json",
    group: "channel",
    body: {
      description:
        "Client to daemon, first frame of the channel: `0x01` (format version) then the client public key (32 bytes). `hex` is the whole binary frame.",
      since: SINCE,
      direction: "client_to_daemon",
      hex: hex(wire.hello),
      decoded: { version: CHANNEL_VERSION, clientPublicKey: hex(CLIENT_KEYPAIR.publicKey) },
    },
  });
  files.push({
    file: "channel.ready.json",
    group: "channel",
    body: {
      description:
        "Daemon to client, first frame back: `0x01`, the 15-byte salt the daemon chose, then the box of a `ready` record (kind byte 0x00, empty payload) at daemon-to-client counter 0. A client that opens the box has proved the daemon holds its secret key.",
      since: SINCE,
      direction: "daemon_to_client",
      hex: hex(wire.ready),
      decoded: {
        version: CHANNEL_VERSION,
        salt: hex(SALT),
        kind: "ready",
        kindByte: RECORD_KIND.READY,
        counter: 0,
        nonce: hex(channelNonce(SALT, CHANNEL_DIRECTION.DAEMON_TO_CLIENT, 0n)),
      },
    },
  });
  const [c0, c1] = wire.clientToDaemon as [Uint8Array, Uint8Array];
  const [d1, d2] = wire.daemonToClient as [Uint8Array, Uint8Array];
  files.push(
    {
      file: "channel.client_to_daemon.text.json",
      group: "channel",
      body: messageFixture("client_to_daemon", "text", 0, c0, TEXT_C2D),
    },
    {
      file: "channel.client_to_daemon.binary.json",
      group: "channel",
      body: messageFixture("client_to_daemon", "binary", 1, c1, BINARY_C2D),
    },
    {
      file: "channel.daemon_to_client.text.json",
      group: "channel",
      body: messageFixture("daemon_to_client", "text", 1, d1, TEXT_D2C),
    },
    {
      file: "channel.daemon_to_client.binary.json",
      group: "channel",
      body: messageFixture("daemon_to_client", "binary", 2, d2, BINARY_D2C),
    },
  );
  return files;
}

function buildManifest(files: FixtureFile[]): Json {
  return {
    formatVersion: 1,
    description:
      "Fixed-key fixtures for relay protocol 2 (relay-protocol.md §§ 1, 3, 4). Every key in keys.json is TEST MATERIAL and must never be used for a real daemon.",
    files: files.map((f) => ({ file: f.file, group: f.group })),
  };
}

const render = (value: Json): string => `${JSON.stringify(value, null, 2)}\n`;

if (process.env.UPDATE_RELAY_FIXTURES === "1") {
  const files = buildFixtures();
  mkdirSync(FIXTURE_DIR, { recursive: true });
  for (const f of files) writeFileSync(join(FIXTURE_DIR, f.file), render(f.body));
  writeFileSync(join(FIXTURE_DIR, "manifest.json"), render(buildManifest(files)));
}

const readText = (file: string): string => readFileSync(join(FIXTURE_DIR, file), "utf8");
const readJson = <T = Json>(file: string): T => JSON.parse(readText(file)) as T;

interface Keys {
  daemonPublicKey: string;
  daemonSecretKey: string;
  clientPublicKey: string;
  clientSecretKey: string;
  salt: string;
  sessionId: string;
  sharedKey: string;
  testMaterial: boolean;
}

interface MessageFixture {
  direction: "client_to_daemon" | "daemon_to_client";
  hex: string;
  decoded: {
    kind: string;
    kindByte: number;
    counter: number;
    nonce: string;
    payload?: string;
    payloadHex?: string;
  };
}

describe("relay fixtures: manifest", () => {
  const manifest = readJson<{
    formatVersion: number;
    files: Array<{ file: string; group: string }>;
  }>("manifest.json");

  it("has formatVersion 1 and lists every *.json file of the directory and nothing else", () => {
    expect(manifest.formatVersion).toBe(1);
    const listed = manifest.files.map((f) => f.file).toSorted();
    const onDisk = readdirSync(FIXTURE_DIR)
      .filter((name) => name.endsWith(".json") && name !== "manifest.json")
      .toSorted();
    expect(listed).toEqual(onDisk);
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("gives every listed file a known group, a description and a since", () => {
    for (const { file, group } of manifest.files) {
      expect(["keys", "control", "close_codes", "channel"]).toContain(group);
      const body = readJson<{ description?: unknown; since?: unknown }>(file);
      expect(typeof body.description, file).toBe("string");
      expect(typeof body.since, file).toBe("string");
    }
  });

  it("matches the generator byte for byte: every file and the manifest", () => {
    const files = buildFixtures();
    for (const f of files) expect(readText(f.file), f.file).toBe(render(f.body));
    expect(readText("manifest.json")).toBe(render(buildManifest(files)));
  });
});

describe("relay fixtures: keys", () => {
  const keys = readJson<Keys>("keys.json");

  it("is marked as test material", () => {
    expect(keys.testMaterial).toBe(true);
    expect(readJson<{ description: string }>("keys.json").description).toMatch(/never be used/);
  });

  it("holds a consistent key pair, session id and shared key", () => {
    const daemon = nacl.box.keyPair.fromSecretKey(fromHex(keys.daemonSecretKey));
    const client = nacl.box.keyPair.fromSecretKey(fromHex(keys.clientSecretKey));
    expect(hex(daemon.publicKey)).toBe(keys.daemonPublicKey);
    expect(hex(client.publicKey)).toBe(keys.clientPublicKey);
    expect(deriveRelaySessionId(daemon.publicKey)).toBe(keys.sessionId);
    expect(hex(nacl.box.before(client.publicKey, daemon.secretKey))).toBe(keys.sharedKey);
    expect(hex(nacl.box.before(daemon.publicKey, client.secretKey))).toBe(keys.sharedKey);
    expect(fromHex(keys.salt)).toHaveLength(CHANNEL_SALT_LENGTH);
  });
});

describe("relay fixtures: control frames", () => {
  const keys = readJson<Keys>("keys.json");
  const connectionId = readJson<{ connectionId: string }>("keys.json").connectionId;
  const cases: Array<[string, ControlFrame]> = [
    ["relay_daemon_register", { type: "relay_daemon_register", v: 2, sessionId: keys.sessionId }],
    ["relay_registered", { type: "relay_registered" }],
    ["relay_client_connect", { type: "relay_client_connect", v: 2, sessionId: keys.sessionId }],
    ["relay_dial", { type: "relay_dial", connectionId }],
    [
      "relay_daemon_attach",
      { type: "relay_daemon_attach", v: 2, sessionId: keys.sessionId, connectionId },
    ],
    ["relay_paired", { type: "relay_paired", connectionId }],
  ];

  it.each(cases)("%s text equals encodeControlFrame", (name, frame) => {
    const fixture = readJson<{ type: string; text: string }>(`control.${name}.json`);
    expect(fixture.type).toBe(name);
    expect(fixture.text).toBe(encodeControlFrame(frame));
    expect(JSON.parse(fixture.text)).toEqual(frame);
  });

  it("holds the legacy relay_register frame the relay parks", () => {
    const fixture = readJson<{ text: string; parked: boolean }>(
      "control.relay_register.legacy.json",
    );
    expect(fixture.parked).toBe(true);
    expect(JSON.parse(fixture.text)).toEqual({ type: "relay_register", sessionId: keys.sessionId });
  });
});

describe("relay fixtures: close codes", () => {
  const { codes } = readJson<{
    codes: Array<{ code: number; name: string | null; sender: string; condition: string }>;
  }>("close-codes.json");

  it("lists every RELAY_CLOSE entry with its code and name", () => {
    for (const spec of Object.values(RELAY_CLOSE)) {
      const entry = codes.find((c) => c.code === spec.code);
      expect(entry, String(spec.code)).toBeDefined();
      expect(entry!.name).toBe(spec.reason);
    }
  });

  it("holds only RELAY_CLOSE codes plus 1001 and 1009, each with a sender and a condition", () => {
    const known = new Set<number>([...Object.values(RELAY_CLOSE).map((s) => s.code), 1001, 1009]);
    expect(new Set(codes.map((c) => c.code))).toEqual(known);
    for (const c of codes) {
      expect(c.sender.length).toBeGreaterThan(0);
      expect(c.condition.length).toBeGreaterThan(0);
    }
  });
});

describe("relay fixtures: channel frames", () => {
  const keys = readJson<Keys>("keys.json");
  const sharedKey = fromHex(keys.sharedKey);
  const salt = fromHex(keys.salt);
  const messages = [
    "channel.client_to_daemon.text.json",
    "channel.client_to_daemon.binary.json",
    "channel.daemon_to_client.text.json",
    "channel.daemon_to_client.binary.json",
  ];

  it("rebuilds hello and ready byte for byte through the real channel", () => {
    const wire = runChannels();
    expect(hex(wire.hello)).toBe(readJson<{ hex: string }>("channel.hello.json").hex);
    expect(hex(wire.ready)).toBe(readJson<{ hex: string }>("channel.ready.json").hex);
  });

  it("rebuilds every message byte for byte in both directions, with the recorded counters", () => {
    const wire = runChannels();
    const actual = [...wire.clientToDaemon, ...wire.daemonToClient].map(hex);
    expect(actual).toEqual(messages.map((m) => readJson<MessageFixture>(m).hex));
    const counters = messages.map((m) => readJson<MessageFixture>(m).decoded.counter);
    expect(counters).toEqual([0, 1, 1, 2]);
  });

  it.each(messages)("opens %s to its decoded form", (file) => {
    const fixture = readJson<MessageFixture>(file);
    const direction =
      fixture.direction === "client_to_daemon"
        ? CHANNEL_DIRECTION.CLIENT_TO_DAEMON
        : CHANNEL_DIRECTION.DAEMON_TO_CLIENT;
    const nonce = channelNonce(salt, direction, BigInt(fixture.decoded.counter));
    expect(hex(nonce)).toBe(fixture.decoded.nonce);
    const plain = nacl.box.open.after(fromHex(fixture.hex), nonce, sharedKey);
    expect(plain).not.toBeNull();
    expect(plain![0]).toBe(fixture.decoded.kindByte);
    const payload = plain!.subarray(1);
    if (fixture.decoded.kind === "text") {
      expect(new TextDecoder().decode(payload)).toBe(fixture.decoded.payload);
    } else {
      expect(hex(payload)).toBe(fixture.decoded.payloadHex);
    }
  });

  it("opens ready to the ready record and hello holds the client public key", () => {
    const ready = readJson<{ hex: string; decoded: { nonce: string } }>("channel.ready.json");
    const frame = fromHex(ready.hex);
    expect(frame[0]).toBe(CHANNEL_VERSION);
    expect(hex(frame.subarray(1, 1 + CHANNEL_SALT_LENGTH))).toBe(keys.salt);
    const plain = nacl.box.open.after(
      frame.subarray(1 + CHANNEL_SALT_LENGTH),
      fromHex(ready.decoded.nonce),
      sharedKey,
    );
    expect(Array.from(plain ?? [])).toEqual([RECORD_KIND.READY]);
    const hello = fromHex(readJson<{ hex: string }>("channel.hello.json").hex);
    expect(hello[0]).toBe(CHANNEL_VERSION);
    expect(hex(hello.subarray(1))).toBe(keys.clientPublicKey);
  });

  it("delivers the client fixture frames to a real daemon channel that uses the fixture salt", () => {
    const received: Array<string | Uint8Array> = [];
    const errors: Error[] = [];
    const sent: Uint8Array[] = [];
    const input: { feed: (frame: Uint8Array | string) => void } = { feed() {} };
    createDaemonChannel({
      transport: {
        send: (bytes) => sent.push(bytes),
        onFrame: (handler) => (input.feed = handler),
        onClose() {},
        close() {},
      },
      daemonKeypair: nacl.box.keyPair.fromSecretKey(fromHex(keys.daemonSecretKey)),
      randomBytes: () => salt,
      events: {
        onText: (t) => received.push(t),
        onBinary: (b) => received.push(b),
        onError: (e) => errors.push(e),
      },
    });
    input.feed(fromHex(readJson<{ hex: string }>("channel.hello.json").hex));
    expect(hex(sent[0]!)).toBe(readJson<{ hex: string }>("channel.ready.json").hex);
    for (const file of messages.slice(0, 2))
      input.feed(fromHex(readJson<MessageFixture>(file).hex));
    expect(errors).toEqual([]);
    expect(received[0]).toBe(TEXT_C2D);
    expect(hex(received[1] as Uint8Array)).toBe(hex(BINARY_C2D));
  });

  it("fails a real client channel when one byte of a fixture frame changes", () => {
    const errors: Error[] = [];
    const input: { feed: (frame: Uint8Array | string) => void } = { feed() {} };
    createClientChannel({
      transport: {
        send() {},
        onFrame: (handler) => (input.feed = handler),
        onClose() {},
        close() {},
      },
      daemonPublicKey: fromHex(keys.daemonPublicKey),
      keyPair: nacl.box.keyPair.fromSecretKey(fromHex(keys.clientSecretKey)),
      events: { onText() {}, onBinary() {}, onError: (e) => errors.push(e) },
    });
    const ready = fromHex(readJson<{ hex: string }>("channel.ready.json").hex);
    ready[ready.length - 1]! ^= 0x01;
    input.feed(ready);
    expect(errors).toHaveLength(1);
  });
});
