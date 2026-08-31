/**
 * Fork dialog state (sprint-072) — one dialog, two steps (visual spec § 07's "open question 5"
 * decision), shared globally across every open chat pane since a fork can be triggered from any
 * of them but only one fork dialog is ever open at a time. A dedicated store rather than folding
 * into `ui-store.ts` (despite both holding ephemeral overlay state): this carries richer
 * fork-domain state than `ui-store.ts`'s `{ id, x, y }` menu-target shape — the same reasoning
 * that keeps `agent-ui-store.ts` a separate file from `ui-store.ts`.
 *
 * Entry points (task-002/task-003):
 * - Row affordance, correlation matched -> `openConfirm` directly, `backTo: null` (no picker to
 *   return to — visual spec § 07: "Entry point A opens the same dialog already on step 2, with no
 *   Back control").
 * - Row affordance, correlation failed -> `openPicker`.
 * - Session "⋮" menu ("Fork from…") -> `openPicker` directly.
 * - Picker row selected -> `selectFromPicker`, which swaps to the confirm step carrying
 *   `backTo: messages` so `‹ Back` (rendered only when `backTo` is non-null) returns to the exact
 *   same list without a second `forkMessages()` call.
 *
 * `triggerElement` (sprint-072/task-005, visual spec § 11) — the control that opened this whole
 * flow, captured by the CALLER synchronously at click-time (never re-derived from
 * `document.activeElement` inside this store, since `openConfirm`/`openPicker` fire from inside
 * an async `forkMessages()` callback, by which point focus could in principle have moved).
 * Carried unchanged through `selectFromPicker`/`backToPicker` — the picker step's own rows are
 * destroyed the moment the dialog closes, so restoring focus to one would be meaningless; the
 * ORIGINAL row button / "⋮" menu item is what `ForkDialog`'s `onCloseAutoFocus` restores focus to
 * on close, falling back to that session's composer when the row no longer exists (a successful
 * fork's own timeline reset routinely removes it before the dialog even finishes closing).
 */

import { create } from "zustand";
import type { ForkTarget } from "@pi-studio-ui/features/chat/fork-correlation.js";

export type ForkDialogState =
  | { status: "closed" }
  | {
      status: "confirm";
      agentId: string;
      target: ForkTarget;
      /** True while `fork(entryId)` is in flight — both footer buttons disabled, spinner shown,
       * outside-click/Esc inert (visual spec § 06 "in-flight"). */
      pending: boolean;
      /** The picker's message list to return to via `‹ Back`, or `null` when this step was
       * reached directly (row affordance, correlation matched) and there is nothing to go back
       * to. */
      backTo: ForkTarget[] | null;
      triggerElement: HTMLElement | null;
    }
  | {
      status: "picker";
      agentId: string;
      messages: ForkTarget[];
      triggerElement: HTMLElement | null;
    };

interface ForkStoreState {
  dialog: ForkDialogState;
  /** Verified single-target match — opens the confirm step directly, no `‹ Back` control.
   * `triggerElement` is the control to restore focus to on close (captured by the caller). */
  openConfirm(agentId: string, target: ForkTarget, triggerElement: HTMLElement | null): void;
  /** Ordinal out of range, text mismatch, or the "Fork from…" menu item — opens the picker,
   * never forking an unverified entry. */
  openPicker(agentId: string, messages: ForkTarget[], triggerElement: HTMLElement | null): void;
  /** A picker row was selected — swap to the confirm step for it, remembering the list for Back.
   * No-op if the dialog isn't currently showing the picker. */
  selectFromPicker(target: ForkTarget): void;
  /** `‹ Back` from the confirm step — no-op if there's nothing to go back to (or not confirming). */
  backToPicker(): void;
  /** Flip the confirm step's in-flight flag. No-op outside the confirm step. */
  setPending(pending: boolean): void;
  close(): void;
}

export const useForkStore = create<ForkStoreState>()((set) => ({
  dialog: { status: "closed" },
  openConfirm: (agentId, target, triggerElement) =>
    set({
      dialog: { status: "confirm", agentId, target, pending: false, backTo: null, triggerElement },
    }),
  openPicker: (agentId, messages, triggerElement) =>
    set({ dialog: { status: "picker", agentId, messages, triggerElement } }),
  selectFromPicker: (target) =>
    set((s) => {
      if (s.dialog.status !== "picker") return s;
      return {
        dialog: {
          status: "confirm",
          agentId: s.dialog.agentId,
          target,
          pending: false,
          backTo: s.dialog.messages,
          triggerElement: s.dialog.triggerElement,
        },
      };
    }),
  backToPicker: () =>
    set((s) => {
      if (s.dialog.status !== "confirm" || s.dialog.backTo === null) return s;
      return {
        dialog: {
          status: "picker",
          agentId: s.dialog.agentId,
          messages: s.dialog.backTo,
          triggerElement: s.dialog.triggerElement,
        },
      };
    }),
  setPending: (pending) =>
    set((s) => (s.dialog.status === "confirm" ? { dialog: { ...s.dialog, pending } } : s)),
  close: () => set({ dialog: { status: "closed" } }),
}));
