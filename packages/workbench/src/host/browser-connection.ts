/**
 * The browser host's `connection`: today's socket wiring, worker-backed reconnect timers, and the
 * page-level resume signals.
 */

import {
  createRelayTransport,
  createWebSocketTransport,
  type Transport,
} from "@av-pi-studio/client";
import { createWorkerTimers } from "./browser-worker-timers.js";
import { type ConnectTarget, type HostConnection } from "./types.js";

/** Relay transport for a relay-routed pairing link, a bearer-subprotocol socket when a password is
 *  set, otherwise the SDK's default socket. */
export function createBrowserTransport(
  target: ConnectTarget,
  options: { password?: string },
): Transport | undefined {
  if (target.mode === "relay") {
    return createRelayTransport({ daemonPublicKey: target.daemonPublicKey });
  }
  if (options.password) {
    const protocol = `pi-studio.bearer.${options.password}`;
    return createWebSocketTransport((url) => new WebSocket(url, [protocol]) as unknown as never);
  }
  return undefined;
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

export function createBrowserConnection(): HostConnection {
  return {
    createTransport: createBrowserTransport,
    // Worker-backed timers keep backoff accurate in a hidden, throttled tab (sprint-050); they fall
    // back to plain `setTimeout` when a Worker cannot be built.
    timers: createWorkerTimers(),
    onResume: onBrowserResume,
  };
}
