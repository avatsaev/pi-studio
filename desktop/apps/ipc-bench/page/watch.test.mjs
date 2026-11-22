// Run with `node --test 'apps/ipc-bench/page/*.test.mjs'` from `desktop/`. The observers of Tauri's channel and fetch
// machinery, against stand-ins for `window.__TAURI_INTERNALS__.callbacks`, `fetch` and `console`.
import assert from "node:assert/strict";
import test from "node:test";
import { watchChannel, watchPage } from "./watch.js";

/** Tauri's callback map with one registered callback, and what it received. */
function channelWith(now) {
  const callbacks = new Map();
  const got = [];
  callbacks.set(7, (raw) => got.push(raw));
  return { callbacks, got, view: watchChannel(callbacks, 7, now) };
}

test("the channel view counts raw callbacks and tracks the next index, whatever order they come in", () => {
  const { callbacks, got, view } = channelWith();
  const run = (...indexes) => indexes.forEach((index) => callbacks.get(7)({ message: `m${index}`, index }));
  run(0, 1, 2);
  assert.deepEqual(view.summary(), { rawCallbacks: 3, nextIndex: 3, highestIndex: 2, waiting: 0, missingIndexes: [], ends: 0, duplicates: 0, malformed: 0, idleMs: view.summary().idleMs });
  run(5, 6, 4);
  let s = view.summary();
  assert.deepEqual([s.nextIndex, s.highestIndex, s.waiting, s.missingIndexes], [3, 6, 3, [3]]);
  run(3);
  s = view.summary();
  assert.deepEqual([s.nextIndex, s.highestIndex, s.waiting, s.missingIndexes, s.rawCallbacks], [7, 6, 0, [], 7]);
  assert.equal(got.length, 7, "every callback reached Tauri's own handler unchanged");
  assert.deepEqual(got[0], { message: "m0", index: 0 });
});

test("a gap stays visible: what waits behind it, which index is missing, how long it has been quiet", () => {
  let clock = 1000;
  const { callbacks, view } = channelWith(() => clock);
  [0, 1, 3, 4, 5, 7].forEach((index) => callbacks.get(7)({ message: "x", index }));
  clock = 31_000;
  assert.deepEqual(view.summary(), { rawCallbacks: 6, nextIndex: 2, highestIndex: 7, waiting: 4, missingIndexes: [2, 6], ends: 0, duplicates: 0, malformed: 0, idleMs: 30_000 });
});

test("end markers, duplicates and malformed callbacks are counted apart from messages", () => {
  const { callbacks, view } = channelWith();
  const call = (raw) => callbacks.get(7)(raw);
  call({ message: "a", index: 0 });
  call({ message: "a again", index: 0 });
  call({ message: "no index" });
  call({ end: true, index: 1 });
  call(undefined);
  const s = view.summary();
  assert.deepEqual([s.rawCallbacks, s.nextIndex, s.duplicates, s.malformed, s.ends], [5, 1, 1, 2, 1]);
});

test("a callback that is not registered cannot be watched", () => {
  assert.equal(watchChannel(new Map(), 7), null);
  assert.equal(watchChannel(undefined, 7), null);
});

function fakeEnv(responder) {
  const calls = [];
  const lines = [];
  return {
    calls,
    lines,
    fetch: (url, init) => {
      calls.push([String(url), init]);
      return responder(String(url));
    },
    console: { error: (...a) => lines.push(["error", ...a]), warn: (...a) => lines.push(["warn", ...a]) },
  };
}
const answer = (tauriResponse, status = 200) => Promise.resolve({ status, headers: { get: (name) => (name === "Tauri-Response" ? tauriResponse : null) } });
const channelUrl = "ipc://localhost/plugin%3A__TAURI_CHANNEL__%7Cfetch";

test("the page watch counts the fetches of channel data by outcome and passes everything through", async () => {
  let respond = () => answer("ok");
  const env = fakeEnv((url) => respond(url));
  const watch = watchPage(env);
  assert.equal(watchPage(env), watch, "installed once");
  const first = await env.fetch(channelUrl, { method: "POST" });
  assert.equal(first.status, 200, "the caller gets the very response");
  assert.deepEqual(env.calls[0], [channelUrl, { method: "POST" }]);
  await env.fetch("ipc://localhost/bridge_ack", {});
  respond = () => answer("error", 200);
  await env.fetch(channelUrl);
  respond = () => Promise.reject(new TypeError("Load failed"));
  await assert.rejects(env.fetch(channelUrl), /Load failed/);
  await assert.rejects(env.fetch("ipc://localhost/bridge_ack"), /Load failed/);
  respond = () => new Promise(() => {});
  env.fetch(channelUrl);
  await new Promise((resolve) => setImmediate(resolve));
  const s = watch.summary();
  assert.deepEqual(s.channelFetches, { started: 4, ok: 1, errorResponses: 1, rejected: 1, pending: 1, lastFailure: "TypeError: Load failed" });
  assert.equal(s.ipcRejected, 2);
  assert.equal(s.lastIpcRejection, "TypeError: Load failed");
});

test("the page watch keeps the last console errors and warnings, and still calls the console", () => {
  const env = fakeEnv(() => answer("ok"));
  const watch = watchPage(env);
  env.console.error("data not found", new Error("boom"));
  env.console.warn("IPC custom protocol failed");
  for (let i = 0; i < 10; i++) env.console.error(`line ${i}`);
  const { console: seen } = watch.summary();
  assert.equal(seen.errors, 11);
  assert.equal(seen.warnings, 1);
  assert.equal(seen.recent.length, 8);
  assert.equal(seen.recent.at(-1), "error: line 9");
  assert.equal(env.lines.length, 12, "the console was still called");
  assert.deepEqual(env.lines[0], ["error", "data not found", env.lines[0][2]]);
});
