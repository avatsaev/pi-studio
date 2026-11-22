/**
 * The connection bar's daemon switcher as pure data: what the control shows (the current entry's
 * name and status), what its list holds, and what choosing a row does. Used instead of the
 * address/password fields when the host has a registry (`host.daemons`); `ConnectionBar.tsx` only
 * binds it to the stores and the DOM.
 *
 * Status is the one `connectionBarView` draws, except for the local entry while its daemon is not
 * running: then the local state's own label is shown ("Starting…"), because a socket that has not
 * been dialed yet has nothing to say.
 */

import type { ConnectionState } from "@av-pi-studio/client";
import type { DaemonEntryView } from "../../host/types.js";
import {
  type LocalTone,
  daemonErrorView,
  daemonFailureOf,
  localStateView,
  remoteStateView,
} from "../daemons/daemon-presentation.js";
import { LINK_INVALID_LABEL } from "../daemons/daemons-screen-view.js";
import type { DaemonsSnapshot } from "../daemons/use-daemons.js";
import {
  type ConnectionBarAction,
  type ConnectionBarKind,
  connectionBarView,
} from "./connection-presentation.js";

export const NO_DAEMON_LABEL = "No daemon selected";
export const MANAGE_DAEMONS_LABEL = "Manage daemons…";

const NO_LINKS: ReadonlySet<string> = new Set();

const KIND_LABELS: Record<DaemonEntryView["kind"], string> = {
  local: "Local",
  direct: "Direct",
  relay: "Relay",
  ssh: "SSH",
};

/** The local state's tone as the connection kind that draws the same dot (`ok` never reaches here). */
const TONE_KINDS: Record<LocalTone, ConnectionBarKind> = {
  neutral: "disconnected",
  busy: "connecting",
  ok: "connected",
  error: "error",
};

export interface DaemonSwitcherItem {
  id: string;
  name: string;
  /** "Local", "Direct" or "Relay". */
  kindLabel: string;
  current: boolean;
  /** A relay entry whose pairing link stopped working: the list says so beside its name. */
  linkInvalid: boolean;
}

/** What the bar's action button does; `null` action: no button. */
export type DaemonSwitcherActionIntent = "disconnect" | "retry";

export type SwitcherAction = ConnectionBarAction & { intent: DaemonSwitcherActionIntent };

export interface DaemonSwitcherView {
  kind: ConnectionBarKind;
  /** The current entry's name, or "No daemon selected". Ellipsised by the DOM, never cut here. */
  name: string;
  /** The status after the name; null when there is no current entry. */
  statusLabel: string | null;
  /** Full, never-truncated text for the native `title` tooltip. */
  title: string;
  /** Every entry in registry order, the current one marked. */
  items: DaemonSwitcherItem[];
  action: SwitcherAction | null;
}

export type DaemonChoice =
  /** The current entry while connected. */
  | { kind: "nothing" }
  /** The current entry while not connected: ask the registry again and dial. */
  | { kind: "reconnect" }
  | { kind: "switch"; id: string };

const DISCONNECT: SwitcherAction = {
  label: "Disconnect",
  variant: "outline",
  disabled: false,
  intent: "disconnect",
};
const RETRY: SwitcherAction = {
  label: "Retry",
  variant: "default",
  disabled: false,
  intent: "retry",
};

export function daemonSwitcherView(input: {
  snapshot: DaemonsSnapshot;
  status: ConnectionState;
  error: string | null;
  /** Relay entries marked "pairing link no longer valid"; none when omitted. */
  invalidLinks?: ReadonlySet<string>;
}): DaemonSwitcherView {
  const { snapshot, status, error, invalidLinks = NO_LINKS } = input;
  const current = snapshot.entries.find((entry) => entry.id === snapshot.currentId);
  const items = snapshot.entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    kindLabel: KIND_LABELS[entry.kind],
    current: entry.id === current?.id,
    linkInvalid: entry.kind === "relay" && invalidLinks.has(entry.id),
  }));

  // No address is typed in this mode, so the connection view is asked without one.
  const connection = connectionBarView({ status, error, url: "" });
  // The current entry's own daemon, while it is not running: the local one, or an SSH host's.
  const localView =
    current?.kind === "local" && snapshot.local.state !== "running"
      ? localStateView(snapshot.local)
      : current?.kind === "ssh" &&
          snapshot.remote !== null &&
          snapshot.remote.state !== "running" &&
          snapshot.remote.state !== "unknown"
        ? remoteStateView(snapshot.remote)
        : null;

  let action: DaemonSwitcherView["action"] = null;
  if (status === "open") {
    action = DISCONNECT;
  } else if (status === "closing") {
    action = { ...DISCONNECT, disabled: true };
  } else if (status === "connecting") {
    action = { label: "Connecting…", variant: "default", disabled: true, intent: "retry" };
  } else if (localView) {
    // The registry can act on a failed local daemon (start it again); on a missing CLI it can only
    // answer with the reason, which the Daemons screen then shows.
    action = localView.tone === "error" && localView.actions.length > 0 ? RETRY : null;
  } else if (connection.kind === "error") {
    action = RETRY;
  }

  if (!current) {
    return {
      kind: "disconnected",
      name: NO_DAEMON_LABEL,
      statusLabel: null,
      title: NO_DAEMON_LABEL,
      items,
      action,
    };
  }

  // A marked link is why the connection failed; say that instead of the generic status.
  const linkInvalid = items.some((item) => item.current && item.linkInvalid);
  const linkLabel = linkInvalid && status !== "open" && status !== "connecting";
  const statusLabel = linkLabel
    ? LINK_INVALID_LABEL
    : localView
      ? localView.label
      : connection.statusLabel;
  return {
    kind: localView ? TONE_KINDS[localView.tone] : linkLabel ? "error" : connection.kind,
    name: current.name,
    statusLabel,
    title: `${current.name} · ${linkLabel ? LINK_INVALID_LABEL : localView ? localView.label : connection.title}`,
    items,
    action,
  };
}

/** What choosing `id` in the list does. Switching reloads the page, so it is never done in place. */
export function daemonChoice(input: {
  currentId: string | null;
  id: string;
  status: ConnectionState;
}): DaemonChoice {
  if (input.id !== input.currentId) return { kind: "switch", id: input.id };
  return input.status === "open" ? { kind: "nothing" } : { kind: "reconnect" };
}

/** The toast text for a `switchTo` that rejected. */
export function switchFailureMessage(error: unknown): string {
  return daemonErrorView(daemonFailureOf(error)).message;
}
