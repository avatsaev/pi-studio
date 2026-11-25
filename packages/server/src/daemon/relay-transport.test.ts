import { type AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";
import nacl from "tweetnacl";
import { WebSocket, WebSocketServer } from "ws";

import {
  createClientChannel,
  deriveRelaySessionId,
  RELAY_CLOSE,
  type Channel,
} from "@av-pi-studio/relay";
import {
  startRelayServer,
  type RelayLimits,
  type RelayServerHandle,
} from "@av-pi-studio/relay/server";

import type { Logger } from "../logging/logger.js";
import type { RelayConnection } from "./relay-connection.js";
import {
  connectRelay,
  type RelayConfig,
  type RelayTimers,
  type RelayTransportHandle,
  type RelayTransportLimits,
} from "./relay-transport.js";

/**
 * Integration tests for the daemon's control socket (architecture/relay-protocol.md § Behavior —
 * Daemon (control loop), § 2, § 3, § Error handling): the real relay server with short timers; the
 * test plays the client (or a second daemon, or an outdated relay) with raw sockets and
 * `createClientChannel`. Backoff, silence and replaced waits are asserted on injected timers.
 */

const keypair = nacl.box.keyPair();
const SESSION = deriveRelaySessionId(keypair.publicKey);

/** Distinct timer values so a fake timer's purpose can be told from its delay. */
const REGISTRATION_MS = 111_111;
const SILENCE_MS = 222_222;
const REPLACED_MS = 333_333;

let relay: RelayServerHandle | undefined;
let handle: RelayTransportHandle | undefined;
let fakeServer: WebSocketServer | undefined;
const sockets: WebSocket[] = [];

afterEach(async () => {
  handle?.close();
  handle = undefined;
  for (const s of sockets.splice(0)) s.terminate();
  if (fakeServer) {
    for (const client of fakeServer.clients) client.terminate();
    await new Promise<void>((resolve) => fakeServer!.close(() => resolve()));
    fakeServer = undefined;
  }
  await relay?.close();
  relay = undefined;
});

// Real delay only where the test asserts that something does NOT happen (or that pings arrive on a
// real socket); every awaited condition polls `until`, and every protocol timer is injected.
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("until: timed out");
    await wait(5);
  }
}

interface LogLine {
  level: string;
  msg: string;
  obj?: unknown;
}

/** A `Logger` that records every line; children log into the same list. */
function captureLogger(): { logger: Logger; lines: LogLine[] } {
  const lines: LogLine[] = [];
  const record =
    (level: string) =>
    (first: unknown, second?: string): void => {
      lines.push(
        typeof first === "string"
          ? { level, msg: first }
          : { level, msg: second ?? "", obj: first },
      );
    };
  const logger = {
    trace: record("trace"),
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
    fatal: record("fatal"),
    child: () => logger,
  } as unknown as Logger;
  return { logger, lines };
}

interface FakeTimer {
  ms: number;
  fn: () => void;
  active: boolean;
}

/** Records every timer the control loop sets; tests fire them by hand. */
function fakeTimers(): {
  timers: RelayTimers;
  /** Delays of the pending redial timers (anything that is not a registration or silence timer). */
  redials(): number[];
  /** Fire the pending timer with this delay. */
  fire(ms: number): void;
  isPending(ms: number): boolean;
} {
  const all: FakeTimer[] = [];
  const pending = (): FakeTimer[] => all.filter((t) => t.active);
  const redialDelay = (t: FakeTimer): boolean => t.ms !== REGISTRATION_MS && t.ms !== SILENCE_MS;
  return {
    timers: {
      setTimeout: (fn, ms) => {
        const timer = { ms, fn, active: true };
        all.push(timer);
        return timer;
      },
      clearTimeout: (h) => {
        if (h) (h as FakeTimer).active = false;
      },
    },
    redials: () =>
      pending()
        .filter(redialDelay)
        .map((t) => t.ms),
    fire: (ms) => {
      const timer = pending().find((t) => t.ms === ms);
      if (!timer) throw new Error(`no pending timer with delay ${ms}`);
      timer.active = false;
      timer.fn();
    },
    isPending: (ms) => pending().some((t) => t.ms === ms),
  };
}

function configFor(port: number): RelayConfig {
  return { enabled: true, endpoint: `127.0.0.1:${port}`, useTls: false, publicUseTls: false };
}

async function startRelay(limits?: Partial<RelayLimits>, port = 0): Promise<RelayServerHandle> {
  relay = await startRelayServer({ host: "127.0.0.1", port, limits });
  return relay;
}

interface Raw {
  ws: WebSocket;
  texts: string[];
  closed: Promise<{ code: number; reason: string }>;
}

async function openRaw(port: number): Promise<Raw> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  sockets.push(ws);
  const texts: string[] = [];
  ws.on("message", (data: Buffer, isBinary: boolean) => {
    if (!isBinary) texts.push(data.toString("utf8"));
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    ws.on("close", (code, reason: Buffer) => resolve({ code, reason: reason.toString("utf8") }));
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return { ws, texts, closed };
}

/** Open a client socket and send `relay_client_connect`. */
async function connectClient(port: number): Promise<Raw> {
  const client = await openRaw(port);
  client.ws.send(JSON.stringify({ type: "relay_client_connect", v: 2, sessionId: SESSION }));
  return client;
}

interface ClientSide {
  channel: Channel;
  texts: string[];
}

/** The client side after `relay_paired`: an encrypted channel over the raw socket. */
async function startClientChannel(client: Raw): Promise<ClientSide> {
  await until(() => client.texts.some((t) => t.includes("relay_paired")));
  const texts: string[] = [];
  let ready = false;
  const channel = createClientChannel({
    daemonPublicKey: keypair.publicKey,
    transport: {
      send: (bytes) => client.ws.send(bytes),
      onFrame: (h) =>
        client.ws.on("message", (data: Buffer, isBinary: boolean) =>
          h(isBinary ? new Uint8Array(data) : data.toString("utf8")),
        ),
      onClose: (h) => client.ws.on("close", (code, reason: Buffer) => h(code, reason.toString())),
      close: (code, reason) => client.ws.close(code, reason),
    },
    events: {
      onText: (t) => texts.push(t),
      onReady: () => {
        ready = true;
      },
    },
  });
  await until(() => ready);
  return { channel, texts };
}

/** Echo every text the connection receives, prefixed, so a test can prove it works. */
function echo(conn: RelayConnection): void {
  conn.onText((text) => conn.sendText(`echo:${text}`));
}

function start(
  port: number,
  options: {
    logger?: Logger;
    limits?: RelayTransportLimits;
    random?: () => number;
    timers?: RelayTimers;
    onConnection?: (conn: RelayConnection) => void;
  } = {},
): RelayTransportHandle {
  handle = connectRelay(keypair, configFor(port), {
    logger: options.logger ?? captureLogger().logger,
    onConnection: options.onConnection ?? (() => {}),
    limits: options.limits,
    random: options.random,
    timers: options.timers,
  });
  return handle;
}

describe("connectRelay", () => {
  it("registers, and a client connect yields onConnection with a working connection", async () => {
    const server = await startRelay();
    const { logger, lines } = captureLogger();
    const conns: RelayConnection[] = [];
    start(server.port, {
      logger,
      onConnection: (conn) => {
        conns.push(conn);
        echo(conn);
      },
    });
    expect(handle!.sessionId).toBe(SESSION);
    await until(() => server.counts().controls === 1);
    await until(() => lines.some((l) => l.msg === "relay registered"));
    expect(lines.map((l) => l.msg)).toEqual(
      expect.arrayContaining(["relay connected", "relay registered"]),
    );

    const client = await connectClient(server.port);
    await until(() => conns.length === 1);
    const side = await startClientChannel(client);
    side.channel.send("hi");
    await until(() => side.texts.length === 1);
    expect(side.texts).toEqual(["echo:hi"]);
    expect(conns[0]!.isOpen).toBe(true);
    expect(typeof conns[0]!.bufferedAmount).toBe("number");
  });

  it("strips a pasted scheme from the endpoint and uses useTls for the scheme", async () => {
    const server = await startRelay();
    handle = connectRelay(
      keypair,
      { ...configFor(server.port), endpoint: `http://127.0.0.1:${server.port}/` },
      { logger: captureLogger().logger, onConnection: () => {} },
    );
    await until(() => server.counts().controls === 1);
  });

  it("spaces redials with the backoff while the relay is down, and relay_registered resets it", async () => {
    const down = await startRelay();
    const port = down.port;
    await down.close();
    relay = undefined;

    const fake = fakeTimers();
    // Jitter source: -20 %, +20 %, none; afterwards 0.5 (none).
    const randoms = [0, 1, 0.5];
    const { logger, lines } = captureLogger();
    start(port, { logger, timers: fake.timers, random: () => randoms.shift() ?? 0.5 });

    await until(() => fake.redials().length === 1);
    expect(fake.redials()).toEqual([800]); // 1 s · 0.8
    fake.fire(800);
    await until(() => fake.redials().length === 1);
    expect(fake.redials()).toEqual([2400]); // 2 s · 1.2
    fake.fire(2400);
    await until(() => fake.redials().length === 1);
    expect(fake.redials()).toEqual([4000]); // 4 s · 1.0

    // The log says why and when: control socket closed with the code and the next delay.
    const closedLine = lines.find((l) => l.msg === "relay control socket closed");
    expect(closedLine?.obj).toMatchObject({ code: 1006, nextRedialMs: 800 });

    // The relay comes back: the redial registers, which resets the backoff.
    const back = await startRelay(undefined, port);
    fake.fire(4000);
    await until(() => back.counts().controls === 1);
    await until(() => lines.some((l) => l.msg === "relay registered"));
    await back.close();
    relay = undefined;
    // 1001 from the shutting-down relay: the next delay starts over at 1 s, not at 8 s.
    await until(() => fake.redials().length === 1);
    expect(fake.redials()).toEqual([1000]);
  });

  it("caps the backoff at its maximum", async () => {
    const down = await startRelay();
    const port = down.port;
    await down.close();
    relay = undefined;

    const fake = fakeTimers();
    start(port, { timers: fake.timers, random: () => 0.5, limits: { backoffMaxMs: 3000 } });
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      await until(() => fake.redials().length === 1);
      const [delay] = fake.redials();
      seen.push(delay!);
      fake.fire(delay!);
    }
    expect(seen).toEqual([1000, 2000, 3000, 3000]);
  });

  it("logs once and backs off when the relay never answers the registration (outdated relay)", async () => {
    // Accepts the dial, reads the registration, answers nothing: a relay of protocol 1.
    fakeServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    const received: string[] = [];
    let accepted = 0;
    fakeServer.on("connection", (socket) => {
      accepted += 1;
      socket.on("message", (data: Buffer) => received.push(data.toString("utf8")));
    });
    await new Promise<void>((resolve) => fakeServer!.once("listening", () => resolve()));
    const port = (fakeServer.address() as AddressInfo).port;

    const fake = fakeTimers();
    const { logger, lines } = captureLogger();
    start(port, {
      logger,
      timers: fake.timers,
      random: () => 0.5,
      limits: { registrationAnswerTimeoutMs: REGISTRATION_MS, silenceTimeoutMs: SILENCE_MS },
    });

    await until(() => received.length === 1);
    expect(JSON.parse(received[0]!)).toEqual({
      type: "relay_daemon_register",
      v: 2,
      sessionId: SESSION,
    });
    expect(fake.isPending(REGISTRATION_MS)).toBe(true);
    const outdated = (): LogLine[] => lines.filter((l) => l.msg.includes("must be updated"));
    expect(outdated()).toHaveLength(0);

    fake.fire(REGISTRATION_MS);
    expect(outdated()).toHaveLength(1);
    expect(outdated()[0]!.level).toBe("warn");
    // A backoff redial is pending, and nothing dials again until it fires.
    expect(fake.redials()).toEqual([1000]);
    await wait(100);
    expect(accepted).toBe(1);

    fake.fire(1000);
    await until(() => accepted === 2);
    fake.fire(REGISTRATION_MS);
    // Second failure: one more line, and the delay has doubled.
    expect(outdated()).toHaveLength(2);
    expect(fake.redials()).toEqual([2000]);
  });

  it("waits the replaced delay after close code 4107 and leaves an open connection working", async () => {
    const server = await startRelay();
    const fake = fakeTimers();
    const { logger, lines } = captureLogger();
    const conns: RelayConnection[] = [];
    start(server.port, {
      logger,
      timers: fake.timers,
      limits: {
        registrationAnswerTimeoutMs: REGISTRATION_MS,
        silenceTimeoutMs: SILENCE_MS,
        replacedWaitMs: REPLACED_MS,
      },
      onConnection: (conn) => {
        conns.push(conn);
        echo(conn);
      },
    });
    await until(() => server.counts().controls === 1);

    const client = await connectClient(server.port);
    await until(() => conns.length === 1);
    const side = await startClientChannel(client);

    // A second daemon registers the same session id: the relay closes the first control socket.
    const rival = await openRaw(server.port);
    rival.ws.send(JSON.stringify({ type: "relay_daemon_register", v: 2, sessionId: SESSION }));
    await until(() => rival.texts.length === 1);
    await until(() => fake.redials().length === 1);
    expect(fake.redials()).toEqual([REPLACED_MS]);
    const closedLine = lines.find((l) => l.msg === "relay control socket closed");
    expect(closedLine?.obj).toMatchObject({
      code: RELAY_CLOSE.REPLACED.code,
      reason: RELAY_CLOSE.REPLACED.reason,
      nextRedialMs: REPLACED_MS,
    });
    expect(lines.some((l) => l.msg.includes("another daemon"))).toBe(true);

    // The connection is independent of the control socket and keeps working.
    side.channel.send("still there");
    await until(() => side.texts.length === 1);
    expect(side.texts).toEqual(["echo:still there"]);
    expect(conns[0]!.isOpen).toBe(true);

    // The daemon does not re-register before the replaced delay is up…
    await wait(100);
    expect(server.counts().controls).toBe(1);
    expect(await Promise.race([rival.closed, wait(50).then(() => "open")])).toBe("open");

    // …and when it is, the daemon registers again and displaces the rival with 4107.
    fake.fire(REPLACED_MS);
    expect((await rival.closed).code).toBe(RELAY_CLOSE.REPLACED.code);
    expect(lines.filter((l) => l.msg === "relay registered").length).toBeGreaterThanOrEqual(2);
  });

  it("replaces a control socket that hears nothing for the silence timeout", async () => {
    const server = await startRelay();
    const fake = fakeTimers();
    const { logger, lines } = captureLogger();
    start(server.port, {
      logger,
      timers: fake.timers,
      random: () => 0.5,
      limits: { registrationAnswerTimeoutMs: REGISTRATION_MS, silenceTimeoutMs: SILENCE_MS },
    });
    await until(() => server.counts().controls === 1);
    await until(() => lines.some((l) => l.msg === "relay registered"));
    expect(fake.isPending(SILENCE_MS)).toBe(true);
    expect(fake.isPending(REGISTRATION_MS)).toBe(false); // answered, so no longer armed

    fake.fire(SILENCE_MS);
    expect(lines.some((l) => l.level === "warn" && l.msg.includes("silent"))).toBe(true);
    expect(fake.redials()).toEqual([1000]);
    await until(() => server.counts().controls === 0); // the dead socket is gone

    fake.fire(1000);
    await until(() => server.counts().controls === 1); // a fresh one registered
  });

  it("keeps a control socket alive while the relay's pings arrive", async () => {
    const server = await startRelay({ pingIntervalMs: 40 });
    const { logger, lines } = captureLogger();
    start(server.port, { logger, limits: { silenceTimeoutMs: 200 } });
    await until(() => server.counts().controls === 1);
    await wait(700); // well over three silence timeouts: only pings keep it open
    expect(lines.some((l) => l.msg.includes("silent"))).toBe(false);
    expect(lines.filter((l) => l.msg === "relay registered")).toHaveLength(1);
    expect(server.counts().controls).toBe(1);
  });

  it("ignores a relay_dial above the cap and logs it", async () => {
    const server = await startRelay({ attachTimeoutMs: 400 });
    const { logger, lines } = captureLogger();
    const conns: RelayConnection[] = [];
    start(server.port, {
      logger,
      limits: { maxConnections: 2 },
      onConnection: (conn) => conns.push(conn),
    });
    await until(() => server.counts().controls === 1);

    const first = await connectClient(server.port);
    const second = await connectClient(server.port);
    await until(() => conns.length === 2);
    await until(
      () =>
        first.texts.some((t) => t.includes("relay_paired")) &&
        second.texts.some((t) => t.includes("relay_paired")),
    );

    const third = await connectClient(server.port);
    await until(() => lines.some((l) => l.msg.includes("ignored")));
    expect(lines.find((l) => l.msg.includes("ignored"))?.level).toBe("warn");
    expect(conns).toHaveLength(2);
    // Nobody attached for the third client, so the relay gives up on it.
    expect((await third.closed).code).toBe(RELAY_CLOSE.DAEMON_UNRESPONSIVE.code);

    // A closed connection frees its slot.
    conns[0]!.close(1000, "done");
    await until(() => !conns[0]!.isOpen);
    const fourth = await connectClient(server.port);
    await until(() => conns.length === 3);
    await until(() => fourth.texts.some((t) => t.includes("relay_paired")));
  });

  it("stopAccepting() ignores every later relay_dial and leaves an open connection working", async () => {
    const server = await startRelay({ attachTimeoutMs: 400 });
    const { logger, lines } = captureLogger();
    const conns: RelayConnection[] = [];
    start(server.port, { logger, onConnection: (conn) => conns.push(conn) });
    await until(() => server.counts().controls === 1);
    const first = await connectClient(server.port);
    await until(() => conns.length === 1);
    echo(conns[0]!);
    const side = await startClientChannel(first);

    handle!.stopAccepting();

    const late = await connectClient(server.port);
    await until(() => lines.some((l) => l.msg.includes("ignored")));
    expect(conns).toHaveLength(1);
    // Nobody attached for the late client, so the relay gives up on it.
    expect((await late.closed).code).toBe(RELAY_CLOSE.DAEMON_UNRESPONSIVE.code);

    expect(conns[0]!.isOpen).toBe(true);
    side.channel.send("still there");
    await until(() => side.texts.includes("echo:still there"));
  });

  it("ignores unknown control frames", async () => {
    // A relay of the future: registers the daemon, then sends a frame type this daemon lacks.
    fakeServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    let control: WebSocket | undefined;
    fakeServer.on("connection", (socket) => {
      control = socket;
      socket.on("message", () => socket.send(JSON.stringify({ type: "relay_registered" })));
    });
    await new Promise<void>((resolve) => fakeServer!.once("listening", () => resolve()));
    const port = (fakeServer.address() as AddressInfo).port;

    const { logger, lines } = captureLogger();
    const conns: RelayConnection[] = [];
    start(port, { logger, onConnection: (conn) => conns.push(conn) });
    await until(() => lines.some((l) => l.msg === "relay registered"));
    control!.send(JSON.stringify({ type: "relay_future_frame", x: 1 }));
    control!.send("not json");
    await wait(100);
    expect(conns).toHaveLength(0);
    expect(control!.readyState).toBe(WebSocket.OPEN);
  });

  it("close() stops redialing, closes the control socket and every open connection", async () => {
    const server = await startRelay();
    const fake = fakeTimers();
    const conns: RelayConnection[] = [];
    start(server.port, { timers: fake.timers, onConnection: (conn) => conns.push(conn) });
    await until(() => server.counts().controls === 1);
    const client = await connectClient(server.port);
    await until(() => conns.length === 1);
    await startClientChannel(client);

    handle!.close();
    const closed = await client.closed;
    expect(closed.code).toBe(1001);
    await until(() => server.counts().controls === 0);
    expect(conns[0]!.isOpen).toBe(false);
    expect(fake.redials()).toEqual([]);
    handle = undefined;
  });
});
