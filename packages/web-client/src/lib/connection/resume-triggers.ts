/**
 * Thin DOM wiring for the resume triggers (clean-room-scope/features/connection-resilience.md
 * § Purpose item 2, § Behavior & Algorithms). Subscribes to `visibilitychange` (hidden → visible
 * only) and `online`; feeds the live connection state through {@link resolveResumeAction} and
 * executes the result against the store's *live* handles — read at signal time, never captured,
 * since `connection-store` replaces `daemon`/`reconnection` on every `connect()`.
 *
 * Installed once at module scope in `main.tsx`, outside React: that file renders under
 * `<StrictMode>`, whose dev-mode double-invoked effects would otherwise attach two listener sets.
 */
import { useConnectionStore } from "./connection-store.js";
import { resolveResumeAction } from "./resume-action.js";

/** Deliberately shorter than `DaemonClient.ping()`'s 10s default: the daemon answers pings from
 * its socket read loop, so this much silence on a working link is already pathological. */
export const PROBE_TIMEOUT_MS = 5_000;

/** Subscribes to `visibilitychange` (hidden → visible only) and `online`. Returns a detach fn. */
export function attachResumeTriggers(): () => void {
  let probeInFlight = false;

  function onResume(): void {
    const { status, reconnection, daemon } = useConnectionStore.getState();
    const action = resolveResumeAction({
      status,
      managerActive: reconnection !== null,
      probeInFlight,
    });

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
  }

  function onVisibilityChange(): void {
    if (document.visibilityState === "visible") onResume();
  }

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("online", onResume);

  return () => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("online", onResume);
  };
}
