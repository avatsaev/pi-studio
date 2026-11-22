// The worker timers of the app, as row B8 measures them: a copy of
// `packages/workbench/src/host/browser-worker-timers.ts` (decision P7 keeps those timers as the
// reconnect timers), with the worker's source and its protocol unchanged. `worker-timers.test.mjs`
// checks that the source here is the one in that file, so a change there fails the test here.
//
// Differences from the original, for the benchmark only: the backend is made when asked (not on
// first use), says which one it is (`worker`, or `fallback` to the page's own timers when a Worker
// cannot be made: a Content-Security-Policy without `worker-src blob:`), and can be torn down.

export const WORKER_SOURCE = `
  const pending = new Set();
  self.onmessage = (e) => {
    const msg = e.data;
    if (msg.cancel) {
      pending.delete(msg.id);
      return;
    }
    pending.add(msg.id);
    setTimeout(() => {
      if (!pending.has(msg.id)) return; // cancelled before it fired
      pending.delete(msg.id);
      self.postMessage({ id: msg.id });
    }, msg.ms);
  };
`;

function createFallbackBackend() {
  return {
    backend: "fallback",
    setTimer: (cb, ms) => setTimeout(cb, ms),
    clearTimer: (handle) => clearTimeout(handle),
    dispose() {},
  };
}

function createWorkerBackend() {
  const blob = new Blob([WORKER_SOURCE], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);
  URL.revokeObjectURL(url); // the Worker already holds its own reference to the blob's bytes

  const callbacks = new Map();
  let nextId = 1;

  worker.addEventListener("message", (e) => {
    const cb = callbacks.get(e.data.id);
    callbacks.delete(e.data.id);
    if (cb) cb();
  });

  return {
    backend: "worker",
    setTimer: (cb, ms) => {
      const id = nextId++;
      callbacks.set(id, cb);
      worker.postMessage({ id, ms });
      return id;
    },
    clearTimer: (handle) => {
      if (!callbacks.delete(handle)) return; // already fired or never armed: nothing to cancel
      worker.postMessage({ id: handle, cancel: true });
    },
    dispose() {
      worker.terminate();
    },
  };
}

/** `{ backend, setTimer, clearTimer, dispose }`: the app's worker timers, or the plain timers when no Worker can be made. */
export function createWorkerTimers() {
  try {
    return createWorkerBackend();
  } catch {
    return createFallbackBackend();
  }
}
