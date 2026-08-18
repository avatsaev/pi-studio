/**
 * Turns the connection store's `{ status, error }` plus whatever is typed in the url field into the
 * connection bar's presentation: state kind, status-pill text, whether the url/password fields are
 * shown/frozen, and the primary action's label/variant/disabled state (design spec § 08).
 *
 * Pure — no React, no store access — so it is unit-testable in the node env, per project
 * convention (the same split as `features/sessions/session-presentation.ts`).
 */

import type { ConnectionState } from "@av-pi-studio/client";
import type { StatusDotInput } from "@pi-studio-ui/ui/status-dot.js";
import { resolveConnectTarget } from "@pi-studio-ui/lib/connection/resolve-connect-target.js";

/**
 * The four states § 08 draws, plus `closing` — a real `ConnectionState` the spec doesn't cover,
 * rendered as the connected shape with a disabled action rather than inventing a fifth visual.
 */
export type ConnectionBarKind = "connected" | "connecting" | "disconnected" | "error" | "closing";

/**
 * The pill's leading dot, as `StatusDot` input. Returns null for `connecting`, which § 08 draws as
 * a `statusWarning` spinner instead — `StatusDot`'s own spinner is `accentBright` and keyed to an
 * agent turn, so the bar composes `Spinner` directly for that one state.
 *
 * This is a connection-state→dot mapping, deliberately separate from `sessions/status-map.ts`
 * (which stays the single *protocol* `AgentStatus`→dot translation point): a socket state is not
 * an agent status, it only borrows the same three colors.
 */
export function connectionDot(kind: ConnectionBarKind): StatusDotInput | null {
  switch (kind) {
    case "connected":
      return { status: "finished" }; // statusSuccess
    case "error":
      return { status: "error" }; // statusDanger
    case "disconnected":
    case "closing":
      return { status: "idle", showInactive: true }; // foregroundMuted
    case "connecting":
      return null;
  }
}

export interface ConnectionBarAction {
  label: string;
  /** `Button` primitive variant: filled `default` for connect/retry, `outline` for disconnect. */
  variant: "default" | "outline";
  disabled: boolean;
}

export interface ConnectionBarView {
  kind: ConnectionBarKind;
  /**
   * The pill's trailing state text ("connected", "connecting…", the short failure reason). Kept
   * separate from {@link hostLabel} so the host — and only the host — ellipsizes: one combined
   * span would truncate the state word off the end instead.
   */
  statusLabel: string;
  /** Host inside the connected pill; null whenever there is no live connection to name. */
  hostLabel: string | null;
  /** The url/password inputs exist only while there is no live connection. */
  showFields: boolean;
  /** Fields freeze (`readOnly`) mid-handshake so a click can't edit values in flight. */
  fieldsFrozen: boolean;
  action: ConnectionBarAction;
  /** Full, never-truncated pill text for the native `title` tooltip. */
  title: string;
}

/** Failure reasons longer than this are cut with an ellipsis; the pill also ellipsizes visually. */
const REASON_MAX_LENGTH = 40;

/**
 * A browser WebSocket failure rejects with an `Event`, not an `Error` — the platform deliberately
 * withholds the cause — so `connection-store`'s `String(error)` fallback yields the useless
 * `"[object Event]"`. Detected here so the pill shows a real reason instead of internals.
 */
function isOpaqueError(text: string): boolean {
  return /^\[object [A-Za-z]+\]$/.test(text);
}

/**
 * Collapse a raw `Error.message` into the short, human reason § 08 wants in the pill ("connection
 * refused", not a generic "error"). Falls back to the message's first line, length-capped.
 */
export function shortConnectionReason(error: string): string {
  const first = (error.split("\n")[0] ?? "").trim();
  if (first === "" || isOpaqueError(first)) return "connection failed";
  if (/refus/i.test(first)) return "connection refused";
  if (/time(?:d)?[\s-]*out|timeout/i.test(first)) return "timed out";
  if (/\b401\b|\b403\b|unauthor|forbidden|auth/i.test(first)) return "auth failed";
  if (first.length > REASON_MAX_LENGTH) return `${first.slice(0, REASON_MAX_LENGTH - 1)}…`;
  return first;
}

/**
 * Whether what the user typed resolves to something `connect()` can actually dial.
 *
 * Deliberately lenient about the scheme: § 08 says "invalid scheme (not `ws://`/`wss://`)", but
 * this client accepts a bare `host[:port]`, `http(s)://`, AND a pasted pairing link, all of which
 * `resolveConnectTarget` maps onto a real ws(s) URL. Validating the literal typed scheme would
 * reject working input, so validity is "resolves to a dialable ws(s) URL with a hostname".
 */
export function isDialableTarget(url: string): boolean {
  if (url.trim() === "") return false;
  try {
    const target = resolveConnectTarget(url);
    if (!/^wss?:\/\//i.test(target.url)) return false;
    return new URL(target.url).hostname !== "";
  } catch {
    return false;
  }
}

/** The ws(s) URL a connection is actually open against, for the connected pill's host label. */
function dialedHost(url: string): string | null {
  try {
    const { url: dialed } = resolveConnectTarget(url);
    return dialed === "" ? null : dialed;
  } catch {
    return null;
  }
}

export function connectionBarView(input: {
  status: ConnectionState;
  error: string | null;
  /** Current contents of the url field (`ui-store`'s `host`). */
  url: string;
}): ConnectionBarView {
  const { status, error, url } = input;

  if (status === "open") {
    const host = dialedHost(url);
    return {
      kind: "connected",
      statusLabel: "connected",
      hostLabel: host,
      showFields: false,
      fieldsFrozen: false,
      action: { label: "Disconnect", variant: "outline", disabled: false },
      title: host ? `${host} · connected` : "connected",
    };
  }

  if (status === "closing") {
    const host = dialedHost(url);
    return {
      kind: "closing",
      statusLabel: "disconnecting…",
      hostLabel: host,
      showFields: false,
      fieldsFrozen: false,
      action: { label: "Disconnect", variant: "outline", disabled: true },
      title: host ? `${host} · disconnecting…` : "disconnecting…",
    };
  }

  if (status === "connecting") {
    return {
      kind: "connecting",
      statusLabel: "connecting…",
      hostLabel: null,
      showFields: true,
      fieldsFrozen: true,
      action: { label: "Connecting…", variant: "default", disabled: true },
      title: "connecting…",
    };
  }

  // idle / closed — the difference between "never connected / user disconnected" and "the last
  // attempt failed" is whether the store kept an error.
  const dialable = isDialableTarget(url);
  if (error !== null && error !== "") {
    const reason = shortConnectionReason(error);
    return {
      kind: "error",
      statusLabel: reason,
      hostLabel: null,
      showFields: true,
      fieldsFrozen: false,
      action: { label: "Retry", variant: "default", disabled: !dialable },
      // The raw message is the more useful tooltip, except when it is the opaque `[object Event]`
      // a browser WebSocket failure produces — then repeating the clean reason beats internals.
      title: isOpaqueError(error.trim()) ? reason : error,
    };
  }

  return {
    kind: "disconnected",
    statusLabel: "disconnected",
    hostLabel: null,
    showFields: true,
    fieldsFrozen: false,
    action: { label: "Connect", variant: "default", disabled: !dialable },
    title: "disconnected",
  };
}
