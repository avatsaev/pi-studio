/**
 * `setTimeout`/`clearTimeout` equivalents backed by a dedicated Web Worker
 * (swe/features/connection-resilience.md § Purpose item 1).
 *
 * Dedicated-worker timers are exempt from a hidden tab's page-visibility throttling (Chrome
 * intensive throttling clamps chained main-thread `setTimeout` chains to ~1 fire/minute after
 * ~5 minutes hidden — see the spec for the user-facing symptom this fixes). The worker is built
 * from an inline `Blob` URL: no separate asset file, no bundler/Vite worker-plugin config, nothing
 * for the build to resolve.
 *
 * Falls back to plain `setTimeout`/`clearTimeout` if `Worker`/`Blob`/`URL.createObjectURL` is
 * unavailable or Worker construction throws (e.g. a CSP without `worker-src blob:` — see
 * `docker/web-client.nginx.conf.template`, which today sets no CSP at all, so this is a
 * forward-looking safety net rather than an active constraint). The fallback decision is latched
 * on first use: a throwing Worker is never retried on a later `setTimer` call. Behavior in the
 * fallback path is identical to not having this module at all — the feature degrades, never
 * regresses.
 */

interface TimerBackend {
  setTimer: (cb: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

const WORKER_SOURCE = `
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

function createFallbackBackend(): TimerBackend {
  return {
    setTimer: (cb, ms) => setTimeout(cb, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}

function createWorkerBackend(): TimerBackend {
  const blob = new Blob([WORKER_SOURCE], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);
  URL.revokeObjectURL(url); // the Worker already holds its own reference to the blob's bytes

  const callbacks = new Map<number, () => void>();
  let nextId = 1;

  worker.addEventListener("message", (e: MessageEvent<{ id: number }>) => {
    const cb = callbacks.get(e.data.id);
    callbacks.delete(e.data.id);
    cb?.();
  });

  return {
    setTimer: (cb, ms) => {
      const id = nextId++;
      callbacks.set(id, cb);
      worker.postMessage({ id, ms });
      return id;
    },
    clearTimer: (handle) => {
      const id = handle as number;
      if (!callbacks.delete(id)) return; // already fired or never armed — nothing to cancel
      worker.postMessage({ id, cancel: true });
    },
  };
}

let backend: TimerBackend | null = null;

function getBackend(): TimerBackend {
  if (backend) return backend;
  try {
    backend = createWorkerBackend();
  } catch {
    // Worker construction threw (e.g. CSP without `worker-src blob:`, or no Worker/Blob support
    // at all) — latch the plain-timer fallback permanently rather than retrying per call.
    backend = createFallbackBackend();
  }
  return backend;
}

/**
 * Returns `setTimer`/`clearTimer` backed by a lazily-created, module-level shared Worker (created
 * on first `setTimer`, not at import time — importing this module has no side effects).
 */
export function createWorkerTimers(): TimerBackend {
  return {
    setTimer: (cb, ms) => getBackend().setTimer(cb, ms),
    clearTimer: (handle) => getBackend().clearTimer(handle),
  };
}
