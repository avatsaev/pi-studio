// Run with `node --test 'apps/ipc-bench/page/*.test.mjs'` from `desktop/`. The bridge transport against a stand-in
// for `window.__TAURI__.core`: what it invokes, in which order, and what it hands to `onMessage`.
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { ACK_BYTES, ACK_MS, createBridgeTransport, ipcPathOf } from "./bridge.js";
import { KIND_BINARY, KIND_TEXT, encodeBatch, forEachItem } from "./batch.js";

/** A stand-in for Tauri's core API: records invokes, answers `bridge_open` at once, the others when told. */
function fakeTauri() {
  const calls = [];
  const fake = {
    calls,
    channel: null,
    Channel: class {
      constructor() {
        fake.channel = this;
      }
    },
    invoke(cmd, args, options) {
      const call = { cmd, args, options };
      calls.push(call);
      if (cmd === "bridge_open") return Promise.resolve({ handle: "h1" });
      return new Promise((resolve, reject) => Object.assign(call, { resolve, reject }));
    },
    /** The calls to `cmd` so far. */
    of: (cmd) => calls.filter((c) => c.cmd === cmd),
    deliver: (message) => fake.channel.onmessage(message),
  };
  return fake;
}

async function connected(options, tauri = fakeTauri()) {
  const transport = createBridgeTransport(options, tauri);
  await transport.connect("ws://127.0.0.1:1/echo");
  return { transport, tauri };
}

const bytes = (n, fill = 0) => new Uint8Array(n).fill(fill);
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("connect opens with the url, the inbound mode and a channel, and answers the handle", async () => {
  const { transport, tauri } = await connected({ inbound: "batch", outbound: "frame" });
  const [open] = tauri.of("bridge_open");
  assert.equal(open.args.url, "ws://127.0.0.1:1/echo");
  assert.equal(open.args.inbound, "batch");
  assert.equal(open.args.onMessage, tauri.channel);
  assert.equal(transport.isOpen, true);
  assert.equal(transport.bufferedAmount, 0);
});

test("a failed open rejects with the error's message", async () => {
  const tauri = fakeTauri();
  tauri.invoke = () => Promise.reject({ code: "limit", message: "4 bridged sockets are open" });
  const transport = createBridgeTransport({ inbound: "frame", outbound: "frame" }, tauri);
  await assert.rejects(transport.connect("ws://x"), /4 bridged sockets are open/);
  assert.equal(transport.isOpen, false);
});

test("per-frame sends carry handle and seq, and bufferedAmount is added at send and subtracted at the answer", async () => {
  const { transport, tauri } = await connected({ inbound: "frame", outbound: "frame" });
  transport.sendBinary(bytes(100));
  transport.sendText("héllo");
  transport.sendBinary(bytes(50));
  const [a, b, c] = [...tauri.of("bridge_send_binary"), ...tauri.of("bridge_send_text")].sort((x, y) => tauri.calls.indexOf(x) - tauri.calls.indexOf(y));
  assert.equal(a.options.headers.seq, "0");
  assert.equal(a.options.headers.handle, "h1");
  assert.deepEqual(b.args, { handle: "h1", seq: 1, data: "héllo" });
  assert.equal(c.options.headers.seq, "2");
  assert.equal(transport.bufferedAmount, 100 + 6 + 50);
  b.resolve();
  await tick();
  assert.equal(transport.bufferedAmount, 150);
  a.resolve();
  c.resolve();
  await tick();
  assert.equal(transport.bufferedAmount, 0);
});

test("a failed send calls onError, gives its bytes back and does not throw", async () => {
  const { transport, tauri } = await connected({ inbound: "frame", outbound: "frame" });
  const errors = [];
  transport.onError = (e) => errors.push(e.message);
  transport.sendBinary(bytes(10));
  assert.equal(transport.bufferedAmount, 10);
  tauri.of("bridge_send_binary")[0].reject({ code: "send_order", message: "send 1 arrived twice" });
  await tick();
  assert.deepEqual(errors, ["send 1 arrived twice"]);
  assert.equal(transport.bufferedAmount, 0);
});

test("a send on a connection that is not open is an error, not an exception", async () => {
  const transport = createBridgeTransport({ inbound: "frame", outbound: "frame" }, fakeTauri());
  const errors = [];
  transport.onError = (e) => errors.push(e.message);
  transport.sendText("x");
  transport.sendBinary(bytes(1));
  assert.deepEqual(errors, ["the connection is not open", "the connection is not open"]);
});

test("frames queued in one task go out as one raw invoke, in order, with one seq", async () => {
  const { transport, tauri } = await connected({ inbound: "frame", outbound: "batch" });
  transport.sendBinary(bytes(4, 7));
  transport.sendText("go");
  transport.sendBinary(bytes(3, 9));
  assert.equal(tauri.of("bridge_send_batch").length, 0, "nothing goes before the task is over");
  assert.equal(transport.bufferedAmount, 4 + 2 + 3);
  await Promise.resolve();
  const [batch] = tauri.of("bridge_send_batch");
  assert.equal(tauri.of("bridge_send_batch").length, 1);
  assert.deepEqual(batch.options.headers, { handle: "h1", seq: "0" });
  const seen = [];
  forEachItem(batch.args.buffer, (kind, start, end) => seen.push([kind, [...new Uint8Array(batch.args.buffer, start, end - start)]]));
  assert.deepEqual(seen, [
    [KIND_BINARY, [7, 7, 7, 7]],
    [KIND_TEXT, [103, 111]],
    [KIND_BINARY, [9, 9, 9]],
  ]);
  transport.sendText("next task");
  await Promise.resolve();
  assert.equal(tauri.of("bridge_send_batch")[1].options.headers.seq, "1");
  batch.resolve();
  await tick();
  assert.equal(transport.bufferedAmount, 9, "the answer of the first batch gives back its three frames");
});

test("a batch that reaches four MiB is sent at once", async () => {
  const { transport, tauri } = await connected({ inbound: "frame", outbound: "batch" });
  transport.sendBinary(bytes(4 * 1024 * 1024));
  assert.equal(tauri.of("bridge_send_batch").length, 1);
});

test("inbound frames reach onMessage once each, in order, as a string or an ArrayBuffer", async () => {
  const { transport, tauri } = await connected({ inbound: "frame", outbound: "frame" });
  const got = [];
  transport.onMessage = (m) => got.push(m);
  const raw = bytes(4, 5).buffer;
  tauri.deliver("one");
  tauri.deliver(raw);
  tauri.deliver("héllo");
  assert.equal(got.length, 3);
  assert.equal(got[0], "one");
  assert.equal(got[1], raw);
  assert.equal(got[2], "héllo");
  assert.equal(transport.bytesDelivered, 3 + 4 + 6);
});

test("a batch is split into the frames it holds, text as a string and binary as its own ArrayBuffer", async () => {
  const { transport, tauri } = await connected({ inbound: "batch", outbound: "frame" });
  const got = [];
  transport.onMessage = (m) => got.push(m);
  const batch = encodeBatch([
    { kind: KIND_BINARY, data: bytes(3, 1) },
    { kind: KIND_TEXT, data: "ok" },
    { kind: KIND_BINARY, data: bytes(2, 2) },
  ]);
  tauri.deliver(batch.buffer);
  assert.equal(got.length, 3);
  assert.deepEqual([...new Uint8Array(got[0])], [1, 1, 1]);
  assert.equal(got[1], "ok");
  assert.deepEqual([...new Uint8Array(got[2])], [2, 2]);
  assert.ok(got[0] instanceof ArrayBuffer && got[0].byteLength === 3, "a frame is its own buffer, not a view of the batch");
  assert.equal(transport.bytesDelivered, 7);
});

test("a batch that cannot be read is an error, and the frames before the bad item were delivered", async () => {
  const { transport, tauri } = await connected({ inbound: "batch", outbound: "frame" });
  const got = [];
  const errors = [];
  transport.onMessage = (m) => got.push(m);
  transport.onError = (e) => errors.push(e.message);
  tauri.deliver(new Uint8Array([2, 1, 0, 0, 0, 9, 7, 0, 0, 0, 0]).buffer);
  assert.equal(got.length, 1);
  assert.match(errors[0], /unknown kind 7/);
});

test("the page acknowledges every 256 KiB, or 50 ms after the first byte it owes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { transport, tauri } = await connected({ inbound: "frame", outbound: "frame" });
  transport.onMessage = () => {};
  tauri.deliver(bytes(1000).buffer);
  assert.equal(tauri.of("bridge_ack").length, 0);
  t.mock.timers.tick(ACK_MS - 1);
  assert.equal(tauri.of("bridge_ack").length, 0);
  t.mock.timers.tick(1);
  assert.deepEqual(tauri.of("bridge_ack")[0].args, { handle: "h1", bytes: 1000 });
  // Enough bytes: at once, without waiting for the timer.
  tauri.deliver(bytes(ACK_BYTES - 1).buffer);
  assert.equal(tauri.of("bridge_ack").length, 1);
  tauri.deliver(bytes(1).buffer);
  assert.deepEqual(tauri.of("bridge_ack")[1].args, { handle: "h1", bytes: ACK_BYTES });
});

test("what onMessage returned from is acknowledged, even when it threw", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { transport, tauri } = await connected({ inbound: "frame", outbound: "frame" });
  transport.onMessage = () => {
    throw new Error("the handler failed");
  };
  assert.throws(() => tauri.deliver("abc"), /the handler failed/);
  t.mock.timers.tick(ACK_MS);
  assert.deepEqual(tauri.of("bridge_ack")[0].args, { handle: "h1", bytes: 3 });
});

test("the no-acknowledgement mode never acknowledges until enableAck, which acknowledges what is owed", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { transport, tauri } = await connected({ inbound: "frame", outbound: "frame", ack: false });
  transport.onMessage = () => {};
  tauri.deliver(bytes(ACK_BYTES * 2).buffer);
  t.mock.timers.tick(ACK_MS * 10);
  assert.equal(tauri.of("bridge_ack").length, 0);
  transport.enableAck();
  assert.deepEqual(tauri.of("bridge_ack")[0].args, { handle: "h1", bytes: ACK_BYTES * 2 });
  tauri.deliver(bytes(ACK_BYTES).buffer);
  assert.equal(tauri.of("bridge_ack").length, 2, "from then on it acknowledges as usual");
});

test("a closed message ends the connection once; with an error, onError comes first and the code is 1006", async () => {
  const { transport, tauri } = await connected({ inbound: "frame", outbound: "frame" });
  const events = [];
  transport.onError = (e) => events.push(["error", e.message]);
  transport.onClose = (code, reason) => events.push(["close", code, reason]);
  tauri.deliver({ closed: { code: 1000, reason: "bye", error: { code: "send_order", message: "send 3 arrived twice" } } });
  tauri.deliver({ closed: { code: 1000, reason: "again" } });
  assert.deepEqual(events, [["error", "send_order: send 3 arrived twice"], ["close", 1006, ""]]);
  assert.equal(transport.isOpen, false);

  const second = await connected({ inbound: "frame", outbound: "frame" });
  const closes = [];
  second.transport.onClose = (code, reason) => closes.push([code, reason]);
  second.tauri.deliver({ closed: { code: 4001, reason: "done" } });
  assert.deepEqual(closes, [[4001, "done"]]);
});

test("close asks Rust to close once and stops the transport", async () => {
  const { transport, tauri } = await connected({ inbound: "frame", outbound: "frame" });
  transport.close(4000, "why");
  transport.close();
  assert.equal(tauri.of("bridge_close").length, 1);
  assert.deepEqual(tauri.of("bridge_close")[0].args, { handle: "h1", code: 4000, reason: "why" });
  assert.equal(transport.isOpen, false);
});

test("the report carries Rust's counters and the IPC path the raw bodies took", async () => {
  assert.equal(ipcPathOf({ rawBodies: 3, jsonArrayBodies: 0 }), "custom protocol (raw bytes)");
  assert.equal(ipcPathOf({ rawBodies: 0, jsonArrayBodies: 3 }), "postMessage (JSON array)");
  assert.equal(ipcPathOf({ rawBodies: 1, jsonArrayBodies: 3 }), "mixed");
  assert.equal(ipcPathOf({ rawBodies: 0, jsonArrayBodies: 0 }), "no raw body sent");
  const { transport, tauri } = await connected({ inbound: "batch", outbound: "frame" });
  const pending = transport.report();
  tauri.of("bridge_stats")[0].resolve({ rawBodies: 2, jsonArrayBodies: 0, outOfOrder: 1 });
  const report = await pending;
  assert.equal(report.ipcPath, "custom protocol (raw bytes)");
  assert.equal(report.outOfOrder, 1);
  assert.equal(report.page.inbound, "batch");
});
