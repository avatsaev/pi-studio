// Run with `node --test 'apps/ipc-bench/page/*.test.mjs'` from `desktop/`. The bridge transport against a stand-in
// for `window.__TAURI__.core`: what it invokes, in which order, and what it hands to `onMessage`.
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { ACK_BYTES, ACK_MS, CLOSED_GRACE_MS, createBridgeTransport, describeStats, diagnose, ipcPathOf } from "./bridge.js";
import { KIND_BINARY, KIND_TEXT, encodeBatch, forEachItem } from "./batch.js";

/** A stand-in for Tauri's core API: records invokes, answers `bridge_open` at once, the others when told. */
function fakeTauri({ maxMessages = 512 } = {}) {
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
      if (cmd === "bridge_open") return Promise.resolve({ handle: "h1", ...(maxMessages === undefined ? {} : { maxMessages }) });
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
  assert.deepEqual(tauri.of("bridge_ack")[0].args, { handle: "h1", bytes: 1000, messages: 1 });
  // Enough bytes: at once, without waiting for the timer.
  tauri.deliver(bytes(ACK_BYTES - 1).buffer);
  assert.equal(tauri.of("bridge_ack").length, 1);
  tauri.deliver(bytes(1).buffer);
  assert.deepEqual(tauri.of("bridge_ack")[1].args, { handle: "h1", bytes: ACK_BYTES, messages: 2 });
});

test("the page acknowledges before Rust's message bound: at a quarter of it, whatever the bytes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const tauri = fakeTauri({ maxMessages: 8 });
  const { transport } = await connected({ inbound: "batch", outbound: "frame" }, tauri);
  transport.onMessage = () => {};
  tauri.deliver("a");
  assert.equal(tauri.of("bridge_ack").length, 0, "one message of two is not enough");
  tauri.deliver("bb");
  assert.deepEqual(tauri.of("bridge_ack")[0].args, { handle: "h1", bytes: 3, messages: 2 }, "two messages are a quarter of 8");
  // A batch is one message, however many frames it holds.
  tauri.deliver(
    encodeBatch([
      { kind: KIND_TEXT, data: "x" },
      { kind: KIND_TEXT, data: "y" },
      { kind: KIND_TEXT, data: "z" },
    ]).buffer,
  );
  assert.equal(tauri.of("bridge_ack").length, 1);
  const stats = transport.stats();
  tauri.of("bridge_stats")[0].resolve({});
  assert.equal((await stats).page.messagesDelivered, 3);
});

test("without a bound in the open answer, the default one (512) is assumed", async () => {
  const tauri = fakeTauri({ maxMessages: undefined });
  const { transport } = await connected({ inbound: "frame", outbound: "frame" }, tauri);
  transport.onMessage = () => {};
  for (let i = 0; i < 127; i++) tauri.deliver("a");
  assert.equal(tauri.of("bridge_ack").length, 0);
  tauri.deliver("a");
  assert.deepEqual(tauri.of("bridge_ack")[0].args, { handle: "h1", bytes: 128, messages: 128 });
});

test("describeStats says what stalled: counters, bounds, and why the connection ended", () => {
  const stats = {
    framesIn: 12130,
    bytesIn: 388160,
    channelMessages: 12130,
    outstanding: 100,
    messagesOutstanding: 12,
    maxOutstanding: 400,
    maxMessagesInFlight: 513,
    windowHighBytes: 8388608,
    windowMaxMessages: 512,
    mayRead: true,
    page: { framesDelivered: 12118, channelMessages: 12118 },
    ended: { byPage: false, code: 1006, reason: "", error: { code: "channel_failed", message: "failed to send message to the webview" } },
  };
  const text = describeStats(stats);
  assert.match(text, /Rust sent 12130 frames \(388160 bytes\) in 12130 channel messages \(\? Channel::send errors\), the page delivered 12118 frames in 12118 messages/);
  assert.match(text, /12 messages unacknowledged \(peak 400 bytes of 8388608, 513 messages of 512\)/);
  assert.match(text, /ended by itself: code 1006, channel_failed: failed to send message to the webview/);
  assert.match(describeStats({ ...stats, ended: null }), /the connection is still open/);
  assert.match(describeStats({ ...stats, ended: { byPage: true, code: 1000, reason: "done", error: null } }), /ended by the page: code 1000 \(done\)/);
});

/** The macOS runner's stall: 24425 messages sent, 23912 delivered and acknowledged, 513 outstanding in Rust. */
const stalled = {
  framesIn: 24425,
  bytesIn: 100044800,
  channelMessages: 24425,
  channelSendErrors: 0,
  outstanding: 2101248,
  messagesOutstanding: 513,
  maxOutstanding: 2101248,
  maxMessagesInFlight: 513,
  windowHighBytes: 8388608,
  windowMaxMessages: 512,
  mayRead: false,
  ended: null,
  page: { framesDelivered: 23912, messagesDelivered: 23912, ackedMessages: 23912, acksSent: 190 },
};
const channelOf = (over) => ({ rawCallbacks: 24424, nextIndex: 23912, highestIndex: 24424, waiting: 512, missingIndexes: [23912], ends: 0, duplicates: 0, malformed: 0, idleMs: 30000, ...over });

test("the stall report names a lost channel message when later ones wait behind a gap", () => {
  const fetches = { channelFetches: { started: 24000, ok: 23999, errorResponses: 1, rejected: 0, pending: 0, lastFailure: "status 200, Tauri-Response error" } };
  const text = describeStats({ ...stalled, page: { ...stalled.page, channel: channelOf(), fetches, console: { recent: ["error: data not found"] } } });
  assert.match(text, /Tauri's channel in the page got 24424 raw callbacks \(the last 30000 ms ago\), waits for index 23912, highest index seen 24424, 512 waiting behind a gap at 23912/);
  assert.match(text, /fetches of channel data: 24000 started, 23999 ok, 1 answered with an error, 0 rejected, 0 pending \(last failure: status 200, Tauri-Response error\)/);
  assert.match(text, /console: error: data not found/);
  assert.match(text, /DIAGNOSIS: Tauri's channel lost message 23912: it never reached the page, and 512 later messages wait behind it$/);
});

test("the diagnosis tells a lost tail, lost acknowledgements and no evidence apart", () => {
  const tail = diagnose({ ...stalled, page: { ...stalled.page, channel: channelOf({ rawCallbacks: 23912, highestIndex: 23911, waiting: 0, missingIndexes: [] }) } });
  assert.match(tail, /^513 of the messages Rust sent never reached the page \(the channel's last index seen is 23911, Rust sent 24425\)$/);
  const arrived = channelOf({ rawCallbacks: 24425, nextIndex: 24425, highestIndex: 24424, waiting: 0, missingIndexes: [] });
  const everything = { ...stalled, page: { ...stalled.page, channel: arrived, ackedMessages: 24425 } };
  assert.match(diagnose(everything), /^acknowledgements the page sent never reached Rust \(the page acknowledged 24425 messages, Rust has 23912\)$/);
  assert.equal(diagnose({ ...everything, page: { ...everything.page, ackedMessages: 23912 } }), "");
  assert.equal(diagnose({ ...stalled, page: { ...stalled.page, channel: null } }), "");
  assert.match(describeStats({ ...stalled, page: { ...stalled.page, channel: null } }), /the channel's raw callbacks could not be observed; fetches of channel data are not observed/);
});

test("describe answers with the counters, or says they are not available", async () => {
  const { transport, tauri } = await connected({ inbound: "frame", outbound: "frame" });
  const pending = transport.describe();
  tauri.of("bridge_stats")[0].resolve({ framesIn: 1, bytesIn: 2, channelMessages: 1, outstanding: 0, messagesOutstanding: 0, mayRead: true, ended: null });
  assert.match(await pending, /Rust sent 1 frames/);
  const failing = transport.describe();
  tauri.of("bridge_stats")[1].reject({ code: "unknown_handle", message: "no such connection" });
  assert.match(await failing, /counters are not available: no such connection/);
});

test("what onMessage returned from is acknowledged, even when it threw", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { transport, tauri } = await connected({ inbound: "frame", outbound: "frame" });
  transport.onMessage = () => {
    throw new Error("the handler failed");
  };
  assert.throws(() => tauri.deliver("abc"), /the handler failed/);
  t.mock.timers.tick(ACK_MS);
  assert.deepEqual(tauri.of("bridge_ack")[0].args, { handle: "h1", bytes: 3, messages: 1 });
});

test("the no-acknowledgement mode never acknowledges until enableAck, which acknowledges what is owed", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { transport, tauri } = await connected({ inbound: "frame", outbound: "frame", ack: false });
  transport.onMessage = () => {};
  tauri.deliver(bytes(ACK_BYTES * 2).buffer);
  t.mock.timers.tick(ACK_MS * 10);
  assert.equal(tauri.of("bridge_ack").length, 0);
  transport.enableAck();
  assert.deepEqual(tauri.of("bridge_ack")[0].args, { handle: "h1", bytes: ACK_BYTES * 2, messages: 1 });
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

const unknownHandle = { code: "unknown_handle", message: "no such connection" };

test("the socket ends while the page is still working through the flood: late acknowledgements are ignored, every frame is delivered, the report still works", async () => {
  const { transport, tauri } = await connected({ inbound: "frame", outbound: "frame" });
  const got = [];
  const events = [];
  transport.onMessage = (m) => got.push(m);
  transport.onError = (e) => events.push(["error", e.message]);
  transport.onClose = (code, reason) => events.push(["close", code, reason]);
  // 256 KiB delivered: an acknowledgement goes out at once and is still in flight when the socket ends.
  tauri.deliver(bytes(ACK_BYTES).buffer);
  tauri.deliver("last frame");
  const inFlight = tauri.of("bridge_ack");
  assert.equal(inFlight.length, 1);
  // The channel keeps the order: the frames, then `closed`, then (below) the answers to what the page sent meanwhile.
  tauri.deliver({ closed: { code: 1006, reason: "" } });
  inFlight[0].reject(unknownHandle);
  await tick();
  assert.equal(got.length, 2, "everything Rust sent before the end was delivered");
  assert.equal(got[1], "last frame");
  assert.deepEqual(events, [["close", 1006, ""]], "the late acknowledgement is not an error");
  // The report after the end: Rust still answers with the counters it had.
  const pending = transport.report();
  tauri.of("bridge_stats")[0].resolve({ rawBodies: 0, jsonArrayBodies: 0, outOfOrder: 0, framesIn: 2 });
  assert.equal((await pending).framesIn, 2);
  assert.deepEqual(events, [["close", 1006, ""]]);
});

test("an acknowledgement refused for another reason is still an error", async () => {
  const { transport, tauri } = await connected({ inbound: "frame", outbound: "frame" });
  const errors = [];
  transport.onMessage = () => {};
  transport.onError = (e) => errors.push(e.message);
  tauri.deliver(bytes(ACK_BYTES).buffer);
  tauri.of("bridge_ack")[0].reject({ code: "bad_ack", message: "the page acknowledged 9 bytes but only 0 are outstanding" });
  await tick();
  assert.deepEqual(errors, ["the page acknowledged 9 bytes but only 0 are outstanding"]);
});

test("a send that finds the connection gone is an error, after the closed message had its moment to explain", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { transport, tauri } = await connected({ inbound: "frame", outbound: "frame" });
  const events = [];
  transport.onError = (e) => events.push(["error", e.message]);
  transport.onClose = (code) => events.push(["close", code]);
  // Rust has forgotten the connection: the send is refused, and nothing says why yet.
  transport.sendBinary(bytes(10));
  tauri.of("bridge_send_binary")[0].reject(unknownHandle);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(events, [], "it waits for the closed message");
  assert.equal(transport.bufferedAmount, 0);
  t.mock.timers.tick(CLOSED_GRACE_MS);
  assert.deepEqual(events, [["error", "no such connection"]], "no closed message came: the refusal is the error");

  // The closed message arrives within the moment: it is the cause, and the refusal adds nothing.
  const second = await connected({ inbound: "frame", outbound: "batch" });
  const seen = [];
  second.transport.onError = (e) => seen.push(["error", e.message]);
  second.transport.onClose = (code) => seen.push(["close", code]);
  second.transport.sendText("x");
  await Promise.resolve();
  second.tauri.of("bridge_send_batch")[0].reject(unknownHandle);
  await Promise.resolve();
  await Promise.resolve();
  second.tauri.deliver({ closed: { code: 1006, reason: "", error: { code: "read_failed", message: "the server reset the connection" } } });
  t.mock.timers.tick(CLOSED_GRACE_MS);
  assert.deepEqual(seen, [["error", "read_failed: the server reset the connection"], ["close", 1006]]);
});

test("a send after the closed message is refused at once, as an error", async () => {
  const { transport, tauri } = await connected({ inbound: "frame", outbound: "frame" });
  const errors = [];
  transport.onError = (e) => errors.push(e.message);
  tauri.deliver({ closed: { code: 1006, reason: "" } });
  transport.sendBinary(bytes(1));
  transport.sendText("x");
  assert.deepEqual(errors, ["the connection is not open", "the connection is not open"]);
  assert.equal(tauri.of("bridge_send_binary").length + tauri.of("bridge_send_text").length, 0, "nothing was invoked");
});
