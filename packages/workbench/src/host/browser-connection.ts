/**
 * The browser host's `connection`: today's socket wiring, worker-backed reconnect timers, and the
 * page-level resume signals.
 */

import { createRelayTransport, type Transport } from "@av-pi-studio/client";
import { createWorkerTimers } from "./browser-worker-timers.js";
import { type ConnectTarget, type HostConnection } from "./types.js";

/** What the browser host says to a target it will not dial. */
export const LITE_REFUSAL =
  "Pi Studio Lite connects with a pairing link. Use the desktop app to connect to a daemon directly.";

/**
 * Relay transport for a relay-routed pairing link. Anything else is refused, except the developer
 * switch: `devDirectUrl` (the page's same-origin `/daemon-ws` proxy) is dialed with the SDK's
 * default socket. The bearer subprotocol is never offered.
 */
export function createBrowserTransport(
  target: ConnectTarget,
  devDirectUrl?: string,
): Transport | undefined {
  if (target.mode === "relay") {
    return createRelayTransport({ daemonPublicKey: target.daemonPublicKey });
  }
  if (devDirectUrl !== undefined && target.url === devDirectUrl) return undefined;
  throw new Error(LITE_REFUSAL);
}

/** The page's same-origin `/daemon-ws` URL (`ws://` or `wss://`). */
export function sameOriginDaemonUrl(location: { protocol: string; host: string }): string {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/daemon-ws`;
}

/** `visibilitychange` (hidden → visible only) and `online`. Returns the unsubscribe. */
function onBrowserResume(listener: () => void): () => void {
  const onVisibilityChange = (): void => {
    if (document.visibilityState === "visible") listener();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("online", listener);
  return () => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("online", listener);
  };
}

export function createBrowserConnection(options: { devDirect?: boolean } = {}): HostConnection {
  const devDirectUrl = options.devDirect ? sameOriginDaemonUrl(window.location) : undefined;
  return {
    createTransport: (target) => createBrowserTransport(target, devDirectUrl),
    // Worker-backed timers keep backoff accurate in a hidden, throttled tab (sprint-050); they fall
    // back to plain `setTimeout` when a Worker cannot be built.
    timers: createWorkerTimers(),
    onResume: onBrowserResume,
  };
}
