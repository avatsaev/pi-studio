/**
 * Fork affordance wiring (sprint-072/task-002/003) — combines the session-level visibility gate
 * (`fork-gate.ts`), the per-row ordinal map, and the click handlers that call `forkMessages()`
 * fresh every time (never cached — the list is only valid against the CURRENT branch) and
 * correlate the result (`fork-correlation.ts`) into either a confirm-dialog target or a picker
 * fallback. These hooks only commit the outcome into `fork-store.ts`; the dialog/picker
 * components themselves render from that store (task-003's `ForkDialog`).
 */

import { useCallback, useMemo } from "react";
import { useClient, useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import type { SessionEntry } from "@pi-studio-ui/stores/session-store.js";
import { useForkStore } from "@pi-studio-ui/stores/fork-store.js";
import {
  buildConfirmedOrdinalByRowId,
  collectConfirmedUserRows,
  correlateForkTarget,
} from "./fork-correlation.js";
import { canOfferFork } from "./fork-gate.js";

export interface ForkRowWiring {
  /** Session-level gate — whether ANY row in this session can offer a fork button right now. */
  canFork: boolean;
  /** Confirmed user row id -> ordinal (transcript order among confirmed user rows). A row absent
   * from this map (pending/failed, or `canFork` false) never renders a button. */
  ordinalByRowId: ReadonlyMap<string, number>;
  /** Click handler for a row's fork button — `ordinal` is its `ordinalByRowId` value. */
  onForkFromRow: (ordinal: number) => void;
}

const EMPTY_ORDINALS: ReadonlyMap<string, number> = new Map();

/** The session-level fork visibility gate alone — shared by `useForkAction` (row buttons) and
 * `useForkMenu` (the "⋮" menu item), which must agree on the exact same predicate (task-003's
 * "gated identically to the affordance... reuse that predicate, do not re-derive it"). */
export function useCanFork(session: SessionEntry | undefined): boolean {
  const serverInfo = useConnectionStore((s) => s.serverInfo);
  const forkTimelineSync = Boolean(serverInfo?.features?.["forkTimelineSync"]);
  return canOfferFork({
    forkTimelineSync,
    running: session?.status === "running",
    agentId: session?.agentId ?? null,
  });
}

export function useForkAction(session: SessionEntry): ForkRowWiring {
  const client = useClient();
  const openConfirm = useForkStore((s) => s.openConfirm);
  const openPicker = useForkStore((s) => s.openPicker);
  const canFork = useCanFork(session);

  const rows = session.timeline.rows;
  const ordinalByRowId = useMemo(
    () => (canFork ? buildConfirmedOrdinalByRowId(rows) : EMPTY_ORDINALS),
    [canFork, rows],
  );

  const agentId = session.agentId;
  const onForkFromRow = useCallback(
    (ordinal: number) => {
      if (!client || !agentId) return;
      // Captured synchronously here, not inside the `.then()` below — clicking a button moves
      // focus to it before `onClick` fires, so this reliably reads the fork button itself even
      // though the correlation result (and which dialog step opens) is only known after the
      // async `forkMessages()` round trip (task-005, visual spec § 11 focus-return).
      const triggerElement =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      void client
        .agent(agentId)
        .forkMessages()
        .then(({ messages }) => {
          const confirmedTexts = collectConfirmedUserRows(session.timeline.rows);
          const result = correlateForkTarget(confirmedTexts, ordinal, messages);
          if (result.outcome === "matched") openConfirm(agentId, result.target, triggerElement);
          else openPicker(agentId, messages, triggerElement);
        })
        .catch((error: unknown) => {
          // Toasts/error surfacing are task-004's scope — logged so a failure is at least
          // observable in the meantime, never silently swallowed.
          console.error("[fork] forkMessages() failed", error);
        });
    },
    [client, agentId, session, openConfirm, openPicker],
  );

  return { canFork, ordinalByRowId, onForkFromRow };
}

export interface ForkMenuWiring {
  /** Same session-level gate as `useForkAction` — hide the whole "⋮" item, never disable it. */
  canFork: boolean;
  /** "Fork from…" menu item handler — always opens the picker step directly (task-003), unlike
   * the row affordance which tries to correlate a specific message first. */
  openForkPicker: () => void;
}

export function useForkMenu(session: SessionEntry | undefined): ForkMenuWiring {
  const client = useClient();
  const openPicker = useForkStore((s) => s.openPicker);
  const canFork = useCanFork(session);
  const agentId = session?.agentId;

  const openForkPicker = useCallback(() => {
    if (!client || !agentId) return;
    const triggerElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    void client
      .agent(agentId)
      .forkMessages()
      .then(({ messages }) => openPicker(agentId, messages, triggerElement))
      .catch((error: unknown) => {
        console.error("[fork] forkMessages() failed", error);
      });
  }, [client, agentId, openPicker]);

  return { canFork, openForkPicker };
}
