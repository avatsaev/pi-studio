/**
 * "Connect to the current registry entry" as one decision, shared by boot, the connection bar's
 * Retry and the Daemons screen's "Reconnect now". Pure over injected dependencies, like
 * `applyConnectIntent`.
 *
 * The intent carries a secret: it goes to `connect` and nowhere else, and is never logged.
 */

import { parsePairingUrl } from "@av-pi-studio/client";
import { type HostDaemons } from "../../host/types.js";
import { type ConnectOptions } from "../../lib/connection/connection-store.js";
import { type DaemonFailure, daemonFailureOf } from "./daemon-presentation.js";

export interface ConnectCurrentDeps {
  connect(options: ConnectOptions): void;
  /** `resolveCurrent` resolved: whatever failure was held no longer applies. */
  resolved(): void;
  /** `resolveCurrent` rejected: nothing is dialed. */
  rejected(failure: DaemonFailure): void;
}

export async function connectCurrent(
  daemons: Pick<HostDaemons, "resolveCurrent">,
  deps: ConnectCurrentDeps,
): Promise<void> {
  let intent;
  try {
    intent = await daemons.resolveCurrent();
  } catch (error) {
    deps.rejected(daemonFailureOf(error));
    return;
  }
  deps.resolved();
  if (!intent.connect || !intent.url) return;
  // A pairing link is its own credential: no password goes with it.
  const pairing = parsePairingUrl(intent.url) !== null;
  deps.connect({ url: intent.url, password: pairing ? undefined : intent.password || undefined });
}
