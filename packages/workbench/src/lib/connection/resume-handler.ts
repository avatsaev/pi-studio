/**
 * What to do when the host signals a possible resume (swe/features/connection-resilience.md
 * § Behavior & Algorithms): the browser host fires on `visibilitychange` (hidden → visible) and
 * `online`; a native host may also fire on wake from sleep. The handler feeds the live connection
 * state through {@link resolveResumeAction} and executes the result against the store's *live*
 * handles — read at signal time, never captured, since `connection-store` replaces
 * `daemon`/`reconnection` on every `connect()`.
 */
import { useConnectionStore } from "./connection-store.js";
import { resolveResumeAction } from "./resume-action.js";

/** Deliberately shorter than `DaemonClient.ping()`'s 10s default: the daemon answers pings from
 * its socket read loop, so this much silence on a working link is already pathological. */
export const PROBE_TIMEOUT_MS = 5_000;

/**
 * A resume listener with its own probe-in-flight latch. Subscribe it to `host.connection.onResume`.
 * `connectAgain` is the app's "connect to the current entry" (the connection bar's Retry): it
 * runs when the first connect of the live client never opened, since that client has no backoff
 * ladder for `reconnectNow()` to cut short.
 */
export function createResumeHandler(connectAgain: () => void): () => void {
  let probeInFlight = false;

  return function onResume(): void {
    const { status, reconnection, daemon } = useConnectionStore.getState();
    const action = resolveResumeAction({
      status,
      managerActive: reconnection !== null,
      managerStarted: reconnection?.isActive ?? false,
      probeInFlight,
    });

    if (action === "connect-again") {
      connectAgain();
      return;
    }

    if (action === "reconnect-now") {
      reconnection?.reconnectNow();
      return;
    }

    if (action === "probe") {
      if (!daemon) return; // managerActive implied it, but keep the type checker honest
      probeInFlight = true;
      daemon
        .ping(PROBE_TIMEOUT_MS)
        .catch(() => {
          // Identity guard: the user may have disconnected, or reconnected to a different
          // daemon, while this probe was pending — only close the instance we actually probed.
          if (useConnectionStore.getState().daemon === daemon) {
            // close() -> "closed" transition -> the active ReconnectionManager's own rung-1
            // retry (~500ms) performs the reconnect. Calling reconnectNow() here would always
            // no-op (close() sets "closing" synchronously, so a same-tick call never sees
            // "closed") and would be dead code implying an immediacy that doesn't exist — see
            // the spec's § Why the probe closing the socket does NOT violate invariant 6.
            daemon.close(4000, "stale-connection-probe");
          }
        })
        .finally(() => {
          probeInFlight = false;
        });
    }
  };
}
