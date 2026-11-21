// A workload run's deadline and failure channel, and its stall watchdog.
//
// The run timeout (10 minutes) is the last resort. A run that has seen nothing for `stallMs` has stalled and
// fails at once, with what the transport knows of itself: when a webview's channel fails, the `closed` message
// that would explain it cannot be delivered either, so the page may otherwise wait for the whole timeout
// for an end that will never come (found on Windows/WebView2 with a flood of small frames).
//
// Progress is: a frame handed to `onMessage` (`run.touch()`), a change of `fingerprint()` (the transport's
// `bufferedAmount`, so that an upload that drains counts), or a harness command that is still running
// (`busy()`; a window the page holds for 30 s is not a stall).

const EXPLAIN_MS = 2000;

/**
 * `await run.wait(promise)` settles with the promise, or rejects when the run times out, stalls, or is failed
 * (`run.fail`, by the socket closing before the run is over).
 *
 * @param {number} timeoutMs the run's whole deadline
 * @param {{ stallMs?: number, checkMs?: number, fingerprint?: () => unknown, busy?: () => boolean, explain?: () => Promise<string> | string }} [options]
 *   `stallMs` 0 turns the watchdog off; `explain` answers what the transport knows (the counters), for the error.
 */
export function newRun(timeoutMs, { stallMs = 30_000, checkMs = 1000, fingerprint = () => 0, busy = () => false, explain = () => "" } = {}) {
  let fail;
  const failed = new Promise((_, reject) => {
    fail = reject;
  });
  failed.catch(() => {});
  let over = false;
  let ticks = 0;
  let seen = null;
  let lastProgress = Date.now();
  let stalled = false;
  const timer = setTimeout(() => fail(new Error(`no end after ${timeoutMs / 1000} s`)), timeoutMs);

  async function report(quietMs) {
    let why = "";
    let giveUp = null;
    try {
      const answer = new Promise((resolve) => {
        giveUp = setTimeout(() => resolve("(the counters did not answer in 2 s)"), EXPLAIN_MS);
      });
      why = await Promise.race([Promise.resolve().then(explain), answer]);
    } catch (error) {
      why = `(the counters are not available: ${error && error.message ? error.message : String(error)})`;
    } finally {
      clearTimeout(giveUp);
    }
    if (!over) fail(new Error(`stalled: no frame and no end for ${Math.round(quietMs / 1000)} s${why ? `; ${why}` : ""}`));
  }

  function check() {
    if (over || stalled) return;
    const current = `${ticks}/${fingerprint()}`;
    if (current !== seen || busy()) {
      seen = current;
      lastProgress = Date.now();
      return;
    }
    const quietMs = Date.now() - lastProgress;
    if (quietMs < stallMs) return;
    stalled = true;
    report(quietMs);
  }

  const watchdog = stallMs > 0 ? setInterval(check, checkMs) : null;
  return {
    fail,
    wait: (promise) => Promise.race([promise, failed]),
    /** A frame arrived (or any sign of life the fingerprint does not show). */
    touch() {
      ticks++;
    },
    get over() {
      return over;
    },
    end() {
      over = true;
      clearTimeout(timer);
      clearInterval(watchdog);
    },
  };
}

/**
 * Makes every `onMessage` handler assigned to `transport` count a frame for `run`, so that the watchdog sees
 * the traffic without the workloads knowing. The handler is called exactly as before.
 */
export function watchFrames(transport, run) {
  let wrapped = null;
  Object.defineProperty(transport, "onMessage", {
    configurable: true,
    enumerable: true,
    get: () => wrapped,
    set: (handler) => {
      wrapped = typeof handler === "function" ? (data) => (run.touch(), handler(data)) : handler;
    },
  });
}
