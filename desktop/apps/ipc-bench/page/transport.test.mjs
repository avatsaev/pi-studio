// Run with `node --test 'apps/ipc-bench/page/*.test.mjs'` from `desktop/`. The proxy transport against stand-ins for
// `window.__TAURI__.core` and the webview's `WebSocket`.
import assert from "node:assert/strict";
import test from "node:test";
import { createProxyTransport, describeProxy, TRANSPORTS } from "./transport.js";

/** A `WebSocket` that opens or fails as told, and remembers what it was given. */
function fakeWebSocket(behaviour) {
  const made = [];
  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.bufferedAmount = 0;
      made.push(this);
      queueMicrotask(() => {
        if (behaviour === "open") {
          this.readyState = 1;
          this.onopen();
        } else this.onerror({});
      });
    }
    send() {}
    close() {
      this.readyState = 3;
    }
  }
  return { FakeWebSocket, made };
}

function fakeTauri(stats = {}) {
  const calls = [];
  return {
    calls,
    invoke(cmd, args) {
      calls.push({ cmd, args });
      if (cmd === "proxy_open") return Promise.resolve({ url: "ws://127.0.0.1:5555/0123456789abcdef", id: "abc" });
      if (cmd === "proxy_stats") return Promise.resolve({ framesToPage: 1, bytesToPage: 2, framesToServer: 3, bytesToServer: 4, outstanding: 0, maxOutstanding: 65536, maxHeldToServer: 0, stalls: 0, maxWriteMs: 1, stalledAtServerFedBytes: null, refusals: 0, refused: [], expectedOrigin: "tauri://localhost", ended: null, ...stats });
      return Promise.reject(new Error(`unexpected ${cmd}`));
    },
  };
}

test("the proxy is a fourth transport, a plain WebSocket behind proxy_open, and not a bridge", () => {
  assert.deepEqual(TRANSPORTS.map((t) => t.id), ["websocket", "bridge-frame", "bridge-batch", "proxy-ws"]);
  const entry = TRANSPORTS.find((t) => t.id === "proxy-ws");
  assert.equal(entry.proxy, true);
  assert.equal(entry.bridge, false);
});

test("connect asks Rust for the URL and opens the webview's own WebSocket to it", async () => {
  const { FakeWebSocket, made } = fakeWebSocket("open");
  globalThis.WebSocket = FakeWebSocket;
  const tauri = fakeTauri();
  const transport = createProxyTransport(tauri, "tauri://localhost");
  await transport.connect("ws://127.0.0.1:7000/echo");
  assert.deepEqual(tauri.calls[0], { cmd: "proxy_open", args: { url: "ws://127.0.0.1:7000/echo" } });
  assert.equal(made[0].url, "ws://127.0.0.1:5555/0123456789abcdef");
  assert.equal(transport.isOpen, true);
  assert.equal(transport.proxy, true);
  const report = await transport.report();
  assert.equal(report.ipcPath, "loopback WebSocket (Rust proxy)");
  assert.equal(report.maxOutstanding, 65536);
  assert.equal(report.pageOrigin, "tauri://localhost");
  assert.deepEqual(tauri.calls.at(-1), { cmd: "proxy_stats", args: { id: "abc" } });
  assert.match(await transport.describe(), /Rust moved 1 frames \(2 bytes\) to the page.*the connection is still open; the WebSocket is in readyState 1/);
});

test("a refused upgrade says what Rust expected and refused, and keeps the token out of the message", async () => {
  const { FakeWebSocket } = fakeWebSocket("fail");
  globalThis.WebSocket = FakeWebSocket;
  const tauri = fakeTauri({ expectedOrigin: "http://tauri.localhost", refusals: 1, refused: ['wrong origin (origin Some("tauri://localhost"), expected "http://tauri.localhost")'] });
  const transport = createProxyTransport(tauri, "tauri://localhost");
  await assert.rejects(transport.connect("ws://127.0.0.1:7000/echo"), (error) => {
    assert.match(error.message, /did not open \(the page's origin is tauri:\/\/localhost\)/);
    assert.match(error.message, /Rust expects the origin http:\/\/tauri.localhost and refused: wrong origin/);
    assert.doesNotMatch(error.message, /0123456789abcdef/);
    return true;
  });
});

test("a proxy_open that fails is the error of the connect, and stats before a connect are an error", async () => {
  const tauri = { invoke: () => Promise.reject({ code: "invalid_address", message: "the benchmark dials only its own server" }) };
  const transport = createProxyTransport(tauri, "x");
  await assert.rejects(transport.connect("ws://example.com/"), /dials only its own server/);
  await assert.rejects(transport.stats(), /was not opened/);
  assert.match(await transport.describe(), /counters are not available: the proxy connection was not opened/);
});

test("describeProxy says what stalled and how the connection ended", () => {
  const stats = { framesToPage: 10, bytesToPage: 640, framesToServer: 0, bytesToServer: 0, outstanding: 64, maxOutstanding: 65536, maxHeldToServer: 0, stalls: 3, maxWriteMs: 2900, stalledAtServerFedBytes: 8388608, refusals: 0, refused: [], ended: { by: "server", graceful: true, code: 4002, reason: "the server closed" } };
  const text = describeProxy(stats);
  assert.match(text, /3 stalled writes to the page, the longest write 2900 ms; the first stalled write came when the server had sent 8388608 bytes/);
  assert.match(text, /ended by the server with a close handshake, code 4002 \(the server closed\)/);
  assert.match(describeProxy({ ...stats, ended: { by: "page", graceful: false, code: null, reason: null }, stalledAtServerFedBytes: null }), /no write to the page stalled.*ended by the page without one$/);
});
