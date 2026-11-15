import nacl from "tweetnacl";
import { describe, expect, it } from "vitest";
import {
  type ChannelEvents,
  type Transport,
  channelNonce,
  createClientChannel,
  createDaemonChannel,
} from "./channel.js";

type Frame = Uint8Array | string;

class MemTransport implements Transport {
  peer!: MemTransport;
  sent: Uint8Array[] = [];
  closes: Array<[number | undefined, string | undefined]> = [];
  frameHandler: (f: Frame) => void = () => {};
  closeHandler: (c?: number, r?: string) => void = () => {};
  /** When set, sends are captured and not delivered (a test relays by hand). */
  hold = false;
  held: Uint8Array[] = [];
  send(bytes: Uint8Array): void {
    this.sent.push(bytes);
    if (this.hold) this.held.push(bytes);
    else this.peer.frameHandler(bytes.slice());
  }
  onFrame(h: (f: Frame) => void): void {
    this.frameHandler = h;
  }
  onClose(h: (c?: number, r?: string) => void): void {
    this.closeHandler = h;
  }
  close(code?: number, reason?: string): void {
    this.closes.push([code, reason]);
  }
  deliver(f: Frame): void {
    this.frameHandler(f);
  }
}

function pair(): [MemTransport, MemTransport] {
  const a = new MemTransport();
  const b = new MemTransport();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

interface Log {
  texts: string[];
  bins: Uint8Array[];
  errors: Error[];
  ready: number;
  closed: Array<[number | undefined, string | undefined]>;
}
function recorder(): [Log, ChannelEvents] {
  const log: Log = { texts: [], bins: [], errors: [], ready: 0, closed: [] };
  return [
    log,
    {
      onText: (t) => log.texts.push(t),
      onBinary: (b) => log.bins.push(b),
      onReady: () => void log.ready++,
      onError: (e) => log.errors.push(e),
      onClose: (c, r) => log.closed.push([c, r]),
    },
  ];
}

const daemonKeypair = nacl.box.keyPair();

function setup(opts: { hold?: boolean; counterLimit?: bigint; wrongKey?: boolean } = {}) {
  const [ct, dt] = pair();
  const [cl, ce] = recorder();
  const [dl, de] = recorder();
  const salt = new Uint8Array(15).fill(7);
  const clientKp = nacl.box.keyPair();
  // Daemon first (it only reacts to frames), then the client sends hello.
  const daemon = createDaemonChannel({
    transport: dt,
    daemonKeypair,
    events: de,
    randomBytes: () => salt,
    counterLimit: opts.counterLimit,
  });
  const client = createClientChannel({
    transport: ct,
    daemonPublicKey: opts.wrongKey ? nacl.box.keyPair().publicKey : daemonKeypair.publicKey,
    events: ce,
    keyPair: clientKp,
    counterLimit: opts.counterLimit,
  });
  return { ct, dt, cl, dl, daemon, client, salt, clientKp };
}

const CHANNEL_ERROR: [number, string] = [4200, "channel_error"];

describe("channel v2", () => {
  it("exchanges text and binary both ways, in order", () => {
    const { client, daemon, cl, dl } = setup();
    expect(cl.ready).toBe(1);
    expect(dl.ready).toBe(1);
    client.send("a");
    client.sendBinary(new Uint8Array([1, 2]));
    client.send("c");
    daemon.send("x");
    daemon.sendBinary(new Uint8Array([9]));
    expect(dl.texts).toEqual(["a", "c"]);
    expect(dl.bins).toEqual([new Uint8Array([1, 2])]);
    expect(cl.texts).toEqual(["x"]);
    expect(cl.bins).toEqual([new Uint8Array([9])]);
    expect(cl.errors).toEqual([]);
    expect(dl.errors).toEqual([]);
  });

  it("uses the byte layout of § 4", () => {
    const { ct, dt, salt, clientKp, client, daemon } = setup();
    const hello = ct.sent[0]!;
    expect(hello.length).toBe(33);
    expect(hello[0]).toBe(1);
    expect(hello.subarray(1)).toEqual(clientKp.publicKey);

    const ready = dt.sent[0]!;
    expect(ready[0]).toBe(1);
    expect(ready.subarray(1, 16)).toEqual(salt);
    const key = nacl.box.before(clientKp.publicKey, daemonKeypair.secretKey);
    const nonceFor = (dir: number, n: number) => {
      const nonce = new Uint8Array(24);
      nonce.set(salt, 0);
      nonce[15] = dir;
      nonce[23] = n;
      return nonce;
    };
    expect(nacl.box.open.after(ready.subarray(16), nonceFor(2, 0), key)).toEqual(
      new Uint8Array([0]),
    );

    client.send("hi");
    client.sendBinary(new Uint8Array([5]));
    daemon.send("yo");
    expect(nacl.box.open.after(ct.sent[1]!, nonceFor(1, 0), key)).toEqual(
      new Uint8Array([1, ...new TextEncoder().encode("hi")]),
    );
    expect(nacl.box.open.after(ct.sent[2]!, nonceFor(1, 1), key)).toEqual(new Uint8Array([2, 5]));
    expect(nacl.box.open.after(dt.sent[1]!, nonceFor(2, 1), key)).toEqual(
      new Uint8Array([1, ...new TextEncoder().encode("yo")]),
    );
    expect(channelNonce(salt, 1, 258n).slice(15)).toEqual(
      new Uint8Array([1, 0, 0, 0, 0, 0, 0, 1, 2]),
    );
  });

  it("draws a different salt per connection for the same hello", () => {
    const hello = new Uint8Array(33);
    hello[0] = 1;
    hello.set(nacl.box.keyPair().publicKey, 1);
    const salts = [0, 1].map(() => {
      const [, dt] = pair();
      const [, de] = recorder();
      createDaemonChannel({ transport: dt, daemonKeypair, events: de });
      dt.deliver(hello.slice());
      return dt.sent[0]!.slice(1, 16);
    });
    expect(salts[0]).not.toEqual(salts[1]);
  });

  describe("failures close with channel_error and deliver nothing", () => {
    function held() {
      const s = setup();
      s.ct.hold = true;
      s.dt.hold = true;
      return s;
    }
    const failed = (log: Log, t: MemTransport) => {
      expect(t.closes).toEqual([CHANNEL_ERROR]);
      expect(log.closed).toEqual([CHANNEL_ERROR]);
      expect(log.errors.length).toBe(1);
      expect(log.texts).toEqual([]);
      expect(log.bins).toEqual([]);
    };

    it("a modified box", () => {
      const s = held();
      s.client.send("a");
      const f = s.ct.held[0]!.slice();
      f[f.length - 1] ^= 1;
      s.dt.deliver(f);
      failed(s.dl, s.dt);
    });

    it("a replayed box", () => {
      const s = held();
      s.client.send("a");
      s.dt.deliver(s.ct.held[0]!.slice());
      expect(s.dl.texts).toEqual(["a"]);
      s.dt.deliver(s.ct.held[0]!.slice());
      expect(s.dt.closes).toEqual([CHANNEL_ERROR]);
      expect(s.dl.texts).toEqual(["a"]);
    });

    it("two boxes swapped", () => {
      const s = held();
      s.client.send("a");
      s.client.send("b");
      s.dt.deliver(s.ct.held[1]!.slice());
      failed(s.dl, s.dt);
    });

    it("a dropped box", () => {
      const s = held();
      s.client.send("a");
      s.client.send("b");
      s.dt.deliver(s.ct.held[1]!.slice());
      failed(s.dl, s.dt);
    });

    it("a box sent back to its sender", () => {
      const s = held();
      s.client.send("a");
      s.ct.deliver(s.ct.held[0]!.slice());
      failed(s.cl, s.ct);
    });

    it("a daemon box reflected to the daemon", () => {
      const s = held();
      s.daemon.send("a");
      s.dt.deliver(s.dt.held[0]!.slice());
      failed(s.dl, s.dt);
    });

    it("a text frame after the exchange", () => {
      const s = setup();
      s.dt.deliver("hello");
      failed(s.dl, s.dt);
      const c = setup();
      c.ct.deliver("hello");
      failed(c.cl, c.ct);
    });

    it("a second hello", () => {
      const s = setup();
      const hello = s.ct.sent[0]!.slice();
      s.dt.deliver(hello);
      failed(s.dl, s.dt);
    });

    it("a ready record after the first box, and an unknown kind", () => {
      for (const kind of [0x00, 0x09]) {
        const s = held();
        // Seal a hand-built record with the next client counter (0).
        const key = nacl.box.before(daemonKeypair.publicKey, s.clientKp.secretKey);
        const box = nacl.box.after(new Uint8Array([kind, 1]), channelNonce(s.salt, 1, 0n), key);
        s.dt.deliver(box);
        failed(s.dl, s.dt);
      }
    });

    it("a malformed hello", () => {
      const [, dt] = pair();
      const [log, de] = recorder();
      createDaemonChannel({ transport: dt, daemonKeypair, events: de });
      dt.deliver(new Uint8Array([1, 2, 3]));
      failed(log, dt);
      expect(dt.sent).toEqual([]);
    });
  });

  it("delivers nothing on the daemon before a valid hello", () => {
    const [, dt] = pair();
    const [log, de] = recorder();
    const daemon = createDaemonChannel({ transport: dt, daemonKeypair, events: de });
    expect(() => daemon.send("x")).toThrow();
    dt.deliver(new Uint8Array(40));
    expect(log.texts).toEqual([]);
    expect(log.ready).toBe(0);
  });

  it("a client with the wrong daemon key fails at ready", () => {
    const { cl, ct, client } = setup({ wrongKey: true });
    expect(cl.ready).toBe(0);
    expect(ct.closes).toEqual([CHANNEL_ERROR]);
    expect(cl.errors.length).toBe(1);
    expect(() => client.send("x")).toThrow();
  });

  it("the client cannot send before ready opened", () => {
    const [ct] = pair();
    const [, ce] = recorder();
    const client = createClientChannel({
      transport: ct,
      daemonPublicKey: daemonKeypair.publicKey,
      events: ce,
    });
    expect(() => client.send("x")).toThrow();
    expect(() => client.sendBinary(new Uint8Array(1))).toThrow();
    expect(ct.sent.length).toBe(1);
  });

  it("carries a 5 MiB text message as one frame", () => {
    const { client, ct, dl } = setup();
    const text = "é".repeat((5 * 1024 * 1024) / 2);
    const before = ct.sent.length;
    client.send(text);
    expect(ct.sent.length).toBe(before + 1);
    expect(dl.texts[0]).toBe(text);
  });

  it("closes instead of wrapping at the counter limit", () => {
    // ready uses d→c counter 0; with limit 3 the daemon can send two more boxes.
    const { daemon, dt, dl, cl } = setup({ counterLimit: 3n });
    daemon.send("1");
    daemon.send("2");
    expect(cl.texts).toEqual(["1", "2"]);
    expect(() => daemon.send("3")).toThrow();
    expect(dt.closes).toEqual([CHANNEL_ERROR]);
    expect(dl.errors.length).toBe(1);
    expect(cl.texts).toEqual(["1", "2"]);
  });

  it("closes when a received counter reaches the limit", () => {
    const { client, ct, cl } = setup({ counterLimit: 3n });
    client.send("a");
    client.send("b");
    client.send("c");
    expect(() => client.send("d")).toThrow();
    expect(ct.closes).toEqual([CHANNEL_ERROR]);
    expect(cl.errors.length).toBe(1);
  });

  it("reports the transport's close once", () => {
    const { ct, cl, client } = setup();
    ct.closeHandler(1000, "bye");
    expect(cl.closed).toEqual([[1000, "bye"]]);
    expect(() => client.send("x")).toThrow();
  });
});
