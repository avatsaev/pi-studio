/**
 * Boot hook: connects once on mount. With a host registry (`host.daemons`) the registry says what
 * to dial (`resolveCurrent`, via `features/daemons/daemons-store.ts#connectCurrent`) and a refusal
 * opens the Daemons screen. Without one it applies the host's launch intent — pre-fills the
 * connection bar (host/password/cwd) and connects when the intent says so. In the browser the
 * intent comes from the page URL (`host/browser-launch.ts`: `?host=&password=&cwd=&connect=1`,
 * `?pair=`, a fragment carrying `offer=`); a native shell supplies its own.
 *
 * The URL is handed to `connect()` verbatim — it detects a pairing link itself via
 * `parsePairingUrl` and branches to the relay transport when the link carries one. A pairing link
 * is its own credential, so no password is sent with it.
 */

import { useEffect, useRef } from "react";
import { parsePairingUrl } from "@av-pi-studio/client";
import { useDaemonsStore } from "../features/daemons/daemons-store.js";
import { getHost } from "../host/install.js";
import { type ConnectIntent, type WorkbenchHost } from "../host/types.js";
import { type ConnectOptions, useConnectionStore } from "../lib/connection/connection-store.js";
import { useUiStore } from "../stores/ui-store.js";

export interface ConnectIntentDeps {
  setHost(host: string): void;
  setPassword(password: string): void;
  setCwd(cwd: string): void;
  /** The connection bar's fields after pre-filling (a missing `url` keeps its current host). */
  fields(): { host: string; password: string };
  connect(options: ConnectOptions): void;
}

/** Pre-fill from `intent`, then connect to the bar's fields if it asks to. `null` does nothing. */
export function applyConnectIntent(intent: ConnectIntent | null, deps: ConnectIntentDeps): void {
  if (!intent) return;
  if (intent.url) deps.setHost(intent.url);
  if (intent.password) deps.setPassword(intent.password);
  if (intent.cwd) deps.setCwd(intent.cwd);
  if (!intent.connect) return;
  const { host, password } = deps.fields();
  const pairing = parsePairingUrl(host) !== null;
  deps.connect({ url: host, password: pairing ? undefined : password || undefined });
}

export interface ConnectBootDeps extends ConnectIntentDeps {
  /** Connect to the registry's current entry (`useDaemonsStore.connectCurrent`). */
  connectCurrent(): void;
}

/**
 * The boot decision. A host with a registry says what to dial (`resolveCurrent`), and the intent's
 * secret goes to the connection only — the connection bar's host and password fields are not
 * touched. Without one, the launch intent fills the fields as before.
 */
export function bootConnection(
  host: Pick<WorkbenchHost, "launch" | "daemons">,
  deps: ConnectBootDeps,
): void {
  if (host.daemons) deps.connectCurrent();
  else applyConnectIntent(host.launch.initialConnect(), deps);
}

export function useConnectionBoot(): void {
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    const ui = useUiStore.getState();
    bootConnection(getHost(), {
      setHost: ui.setHost,
      setPassword: ui.setPassword,
      setCwd: ui.setCwd,
      fields: () => useUiStore.getState(),
      connect: (options) => void useConnectionStore.getState().connect(options),
      connectCurrent: () => void useDaemonsStore.getState().connectCurrent(),
    });
  }, []);
}
