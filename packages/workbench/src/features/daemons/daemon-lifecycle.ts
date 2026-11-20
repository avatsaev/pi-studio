/**
 * How the window reacts to what happens to the daemon it is connected to
 * (`swe/features/desktop-daemon-registry.md` § Local daemon state, § Adding, editing, removing,
 * § Error handling): the local daemon stopping, the current entry being removed, a relay link that
 * no longer matches its daemon, a dropped connection to the local daemon, the native menu's
 * "Manage daemons…".
 *
 * `lifecycleReactions` is the decision, pure over two looks at the facts. `watchDaemonLifecycle`
 * reads the facts from the registry and the connection store, applies the decision through
 * injected effects and returns the unsubscribe. A restart changes nothing here: the connection is
 * kept and the SDK's reconnection covers the gap. The workbench never starts a daemon by itself.
 */

import { type ConnectionState, type RelayConnectReason } from "@av-pi-studio/client";
import { type DaemonEntryView, type HostDaemons, type LocalDaemonState } from "../../host/types.js";
import { useConnectionStore } from "../../lib/connection/connection-store.js";

/** What the decision looks at: the registry's current entry and the connection. */
export interface LifecycleFacts {
  currentId: string | null;
  currentKind: DaemonEntryView["kind"] | null;
  local: LocalDaemonState["state"];
  status: ConnectionState;
  errorReason: RelayConnectReason | null;
}

export type LifecycleReaction =
  /** Disconnect without retrying (what the Disconnect button does) and open the Daemons screen. */
  | { kind: "leave" }
  | { kind: "markLinkInvalid"; id: string }
  | { kind: "clearLinkInvalid"; id: string }
  /** Ask the host to probe the local daemon again; once per drop. */
  | { kind: "refreshLocal" };

export function lifecycleReactions(
  prev: LifecycleFacts,
  next: LifecycleFacts,
): LifecycleReaction[] {
  const reactions: LifecycleReaction[] = [];

  // Whoever asked for the stop (this screen, the native menu, the control socket), the window
  // ends up the same way.
  const stopping =
    next.currentKind === "local" && prev.local !== "stopping" && next.local === "stopping";
  const removed = prev.currentId !== null && next.currentId === null;
  if (stopping || removed) reactions.push({ kind: "leave" });

  if (
    next.currentId !== null &&
    next.currentKind === "relay" &&
    next.errorReason === "wrong_key" &&
    prev.errorReason !== "wrong_key"
  ) {
    reactions.push({ kind: "markLinkInvalid", id: next.currentId });
  }

  if (next.currentId !== null && next.status === "open" && prev.status !== "open") {
    reactions.push({ kind: "clearLinkInvalid", id: next.currentId });
  }

  // `open` straight to `closed` is the socket going away; a manual disconnect passes `closing`.
  if (next.currentKind === "local" && prev.status === "open" && next.status === "closed") {
    reactions.push({ kind: "refreshLocal" });
  }

  return reactions;
}

export interface LifecycleEffects {
  leave(): void;
  markLinkInvalid(id: string): void;
  clearLinkInvalid(id: string): void;
  refreshLocal(): void;
  openScreen(): void;
}

function applyReaction(effects: LifecycleEffects, reaction: LifecycleReaction): void {
  switch (reaction.kind) {
    case "leave":
      effects.leave();
      effects.openScreen();
      return;
    case "markLinkInvalid":
      effects.markLinkInvalid(reaction.id);
      return;
    case "clearLinkInvalid":
      effects.clearLinkInvalid(reaction.id);
      return;
    case "refreshLocal":
      effects.refreshLocal();
      return;
  }
}

function readFacts(daemons: HostDaemons): LifecycleFacts {
  const snapshot = daemons.snapshot();
  const { status, errorReason } = useConnectionStore.getState();
  return {
    currentId: snapshot.currentId,
    currentKind: snapshot.entries.find((entry) => entry.id === snapshot.currentId)?.kind ?? null,
    local: snapshot.local.state,
    status,
    errorReason,
  };
}

/**
 * Apply `lifecycleReactions` to every change of the registry or the connection, and open the
 * screen when the host asks for it. Returns the unsubscribe.
 */
export function watchDaemonLifecycle(daemons: HostDaemons, effects: LifecycleEffects): () => void {
  let prev = readFacts(daemons);
  const check = (): void => {
    const next = readFacts(daemons);
    const reactions = lifecycleReactions(prev, next);
    prev = next;
    for (const reaction of reactions) applyReaction(effects, reaction);
  };
  const stops = [
    daemons.subscribe(check),
    useConnectionStore.subscribe(check),
    daemons.onManageRequest(() => effects.openScreen()),
  ];
  return () => {
    for (const stop of stops) stop();
  };
}
