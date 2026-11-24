/**
 * Shows the outdated-daemon notice (`outdated-daemon.ts`) as a toast, once per established
 * connection (sprint-110/task-006). A connection is "established" while the status is `open` and
 * the handshake's `server_info` is in the store: the first `open` of a `connect()` precedes the
 * store receiving `server_info`, so `open` alone would read no version. Each rise into that state
 * (the first connect, and every reconnect after a drop) gets one notice; re-renders and further
 * store changes while it holds get none. Nothing is watched when the host sets no minimum.
 */

import { type ConnectionState } from "@av-pi-studio/client";
import { type ServerInfoPayload } from "@av-pi-studio/protocol";
import { useToastStore, type ToastAction, type ToastOptions } from "@av-pi-studio/ui-library";
import { useEffect, useRef } from "react";
import { getHost } from "../../host/install.js";
import { useConnectionStore } from "../../lib/connection/connection-store.js";
import { useDaemonsStore } from "../daemons/daemons-store.js";
import { outdatedDaemonNotice } from "./outdated-daemon.js";

/** Long enough to read and act on; still dismisses itself. */
const NOTICE_DURATION_MS = 12_000;

/** Whether the previous look at the connection found it established. */
export interface EstablishedTracker {
  established: boolean;
}

/** Records the connection's current state in `tracker`; the notice text on the rise into
 *  "established" if one is due, otherwise `null`. */
export function noticeOnEstablish(
  tracker: EstablishedTracker,
  minVersion: string,
  status: ConnectionState,
  serverInfo: ServerInfoPayload | null,
): string | null {
  const established = status === "open" && serverInfo !== null;
  const rose = established && !tracker.established;
  tracker.established = established;
  return rose ? outdatedDaemonNotice(minVersion, serverInfo?.version) : null;
}

/**
 * Watches the connection store and calls `show` with the notice for each established connection
 * that is older than `minVersion`. Checks the current state first, then every change. Returns the
 * unsubscribe. Without a `minVersion` (a browser host) it subscribes to nothing.
 */
export function watchOutdatedDaemon(
  tracker: EstablishedTracker,
  minVersion: string | undefined,
  show: (notice: string) => void,
): () => void {
  if (minVersion === undefined) return () => {};
  const check = (state: { status: ConnectionState; serverInfo: ServerInfoPayload | null }) => {
    const notice = noticeOnEstablish(tracker, minVersion, state.status, state.serverInfo);
    if (notice !== null) show(notice);
  };
  check(useConnectionStore.getState());
  return useConnectionStore.subscribe(check);
}

/** The action is there only where the host has a daemon registry (the Daemons screen's Update). */
const OPEN_DAEMONS_ACTION: ToastAction = {
  label: "Open Daemons",
  onSelect: () => useDaemonsStore.getState().openScreen(),
};

/** How the notice is shown: for how long, and with the button that opens the Daemons screen when the host has one. */
export function noticeToastOptions(hasDaemons: boolean): ToastOptions {
  return {
    durationMs: NOTICE_DURATION_MS,
    ...(hasDaemons ? { action: OPEN_DAEMONS_ACTION } : {}),
  };
}

function showNotice(notice: string): void {
  useToastStore.getState().show(notice, noticeToastOptions(getHost().daemons !== undefined));
}

/** Mount once, inside the workbench shell. Does nothing without `app.minDaemonVersion`. */
export function useOutdatedDaemonNotice(): void {
  const minVersion = getHost().app.minDaemonVersion;
  // A ref, not effect state: a development remount must not count the same connection twice.
  const tracker = useRef<EstablishedTracker>({ established: false });

  useEffect(() => watchOutdatedDaemon(tracker.current, minVersion, showNotice), [minVersion]);
}
