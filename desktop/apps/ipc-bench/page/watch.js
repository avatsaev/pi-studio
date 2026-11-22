// What the page can see of Tauri's own channel machinery, to tell a lost message from a counting bug when a run
// stalls (see `describeStats` in `bridge.js`).
//
// Tauri 2.12.5 (`src/ipc/channel.rs`, `@tauri-apps/api` `core.js` `Channel`): Rust gives every message an
// index; a raw message under 1,024 bytes (a JSON one under 8,192) is evaluated into the page as a script, a
// larger one is parked in a cache and the evaluated script fetches it (`plugin:__TAURI_CHANNEL__|fetch`) and then
// calls the channel's callback with the index. The JS `Channel` hands messages to `onmessage` in index order and
// keeps later ones until a missing index arrives. A fetch that fails ends in `.catch(console.error)`: the index
// is never delivered, every later message waits behind it, and Rust is never told (`Channel::send` returned
// `Ok` when the script was queued).
//
// Everything here only observes: the callbacks and `fetch` are wrapped and call through, unchanged.

/** The commands of the Tauri channel plugin, as they appear in the URL of a fetch. */
const CHANNEL_FETCH = "__TAURI_CHANNEL__";
const RECENT_LINES = 8;
const MAX_LINE = 300;

/**
 * The raw callbacks of one `Channel`, before Tauri puts them in index order. `callbacks` is
 * `window.__TAURI_INTERNALS__.callbacks` (Tauri exposes it for debugging) and `id` the channel's `id`.
 * Returns `null` when the channel's callback is not there to wrap.
 */
export function watchChannel(callbacks, id, now = Date.now) {
  const original = callbacks && typeof callbacks.get === "function" ? callbacks.get(id) : undefined;
  if (typeof original !== "function") return null;
  const view = { raw: 0, ends: 0, malformed: 0, duplicates: 0, highest: -1, next: 0, above: new Set(), lastAt: null };

  function note(index) {
    if (!Number.isInteger(index) || index < 0) {
      view.malformed++;
      return;
    }
    if (index > view.highest) view.highest = index;
    if (index < view.next || view.above.has(index)) {
      view.duplicates++;
    } else if (index === view.next) {
      view.next++;
      while (view.above.delete(view.next)) view.next++;
    } else {
      view.above.add(index);
    }
  }

  callbacks.set(id, (rawMessage) => {
    view.raw++;
    view.lastAt = now();
    if (rawMessage && typeof rawMessage === "object" && "end" in rawMessage) view.ends++;
    else note(rawMessage ? rawMessage.index : undefined);
    return original(rawMessage);
  });

  return {
    /** The view as numbers: how many raw callbacks, the next index Tauri waits for, the highest seen, what waits behind a gap. */
    summary() {
      const missing = [];
      for (let i = view.next; i < view.highest && missing.length < 5; i++) if (!view.above.has(i)) missing.push(i);
      return {
        rawCallbacks: view.raw,
        nextIndex: view.next,
        highestIndex: view.highest,
        waiting: view.above.size,
        missingIndexes: missing,
        ends: view.ends,
        duplicates: view.duplicates,
        malformed: view.malformed,
        idleMs: view.lastAt === null ? null : now() - view.lastAt,
      };
    },
  };
}

const text = (value) => {
  const line = value && value.message ? `${value.name || "Error"}: ${value.message}` : String(value);
  return line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)}…` : line;
};

/**
 * Counts the page's fetches of channel data (started, answered ok, answered with an error, rejected, still
 * pending), the IPC fetches that were rejected (the one that makes Tauri fall back to `postMessage`), and what
 * the console was told (`console.error` is where Tauri puts a failed channel fetch). Installed once per page;
 * returns the same record every time.
 */
export function watchPage(env = typeof window === "undefined" ? {} : window) {
  if (env.__ipcBenchWatch) return env.__ipcBenchWatch;
  const state = {
    channelFetches: { started: 0, ok: 0, errorResponses: 0, rejected: 0, pending: 0, lastFailure: null },
    ipcRejected: 0,
    lastIpcRejection: null,
    console: { errors: 0, warnings: 0, recent: [] },
  };
  const watch = { state, summary: () => JSON.parse(JSON.stringify(state)) };
  env.__ipcBenchWatch = watch;

  if (typeof env.fetch === "function") {
    const original = env.fetch;
    env.fetch = function (input, init) {
      const url = String((input && input.url) || input);
      const channel = url.includes(CHANNEL_FETCH) ? state.channelFetches : null;
      if (channel) {
        channel.started++;
        channel.pending++;
      }
      const promise = original.call(this, input, init);
      promise.then(
        (response) => {
          if (!channel) return;
          channel.pending--;
          const header = response && response.headers && typeof response.headers.get === "function" ? response.headers.get("Tauri-Response") : "ok";
          if (header === "ok") channel.ok++;
          else {
            channel.errorResponses++;
            channel.lastFailure = `status ${response.status}, Tauri-Response ${header}`;
          }
        },
        (error) => {
          if (channel) {
            channel.pending--;
            channel.rejected++;
            channel.lastFailure = text(error);
          }
          if (url.includes("ipc")) {
            state.ipcRejected++;
            state.lastIpcRejection = text(error);
          }
        },
      );
      return promise;
    };
  }

  const consoleObject = env.console;
  for (const [level, counter] of [
    ["error", "errors"],
    ["warn", "warnings"],
  ]) {
    if (!consoleObject || typeof consoleObject[level] !== "function") continue;
    const original = consoleObject[level];
    consoleObject[level] = function (...args) {
      state.console[counter]++;
      state.console.recent.push(`${level}: ${args.map(text).join(" ")}`.slice(0, MAX_LINE));
      if (state.console.recent.length > RECENT_LINES) state.console.recent.shift();
      return original.apply(this, args);
    };
  }
  return watch;
}
