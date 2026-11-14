/**
 * Announcer store — the single visually-hidden `aria-live` region's current text
 * (sprint-069/task-008, § 08/§ 11). One region for the whole app, not one per row/tab/header, so a
 * pending-question transition, a `notify` effect, or a background `set_editor_text` replacement
 * are all heard the same way regardless of which session or pane produced them.
 *
 * `announce.ts` (§ 08 pending-question transitions) and `agent-ui-store.ts`'s `notifyEffect`/
 * `composerTextEffect` (§ 11) are this store's only writers, via `speak`/`clearWhenIdle` below —
 * never `useAnnouncerStore.setState` directly from elsewhere.
 */

import { create } from "zustand";

export type AnnouncementPoliteness = "polite" | "assertive";

interface AnnouncerStoreState {
  message: string;
  politeness: AnnouncementPoliteness;
}

export const useAnnouncerStore = create<AnnouncerStoreState>()(() => ({
  message: "",
  politeness: "polite",
}));

/** § 08 "nothing pending anywhere: region emptied, nothing spoken" — the delay between the last
 *  resolution's own announcement (if any fired in the same commit) and the region being emptied.
 *  Emptying it in the *same* synchronous update as the resolution's `speak()` would let React
 *  coalesce both `setState` calls into one commit, so the intermediate "Answered in …" text would
 *  never actually reach the DOM for a screen reader to read — this delay is what makes the
 *  resolution announcement itself observable before the region goes quiet. */
export const ANNOUNCE_CLEAR_DELAY_MS = 4000;

let clearTimeoutId: ReturnType<typeof setTimeout> | null = null;

function cancelScheduledClear(): void {
  if (clearTimeoutId === null) return;
  clearTimeout(clearTimeoutId);
  clearTimeoutId = null;
}

/** Sets the live region's current text. A fresh announcement always pre-empts any clear scheduled
 *  by an earlier `clearWhenIdle` call — a new pending question arriving inside the clear delay
 *  above must not be silently wiped out by it. */
export function speak(text: string, politeness: AnnouncementPoliteness = "polite"): void {
  cancelScheduledClear();
  useAnnouncerStore.setState({ message: text, politeness });
}

/** Schedules the region to empty itself once nothing is pending anywhere. See
 *  `ANNOUNCE_CLEAR_DELAY_MS` for why this is deferred rather than immediate. Calling this again
 *  before the timer fires (e.g. two sessions both clear out in quick succession) simply restarts
 *  the same delay rather than stacking timers. */
export function clearWhenIdle(): void {
  cancelScheduledClear();
  clearTimeoutId = setTimeout(() => {
    clearTimeoutId = null;
    useAnnouncerStore.setState({ message: "" });
  }, ANNOUNCE_CLEAR_DELAY_MS);
}

/** Test-only: reset to initial state and cancel any pending timer, so one test's scheduled clear
 *  cannot fire during a later, unrelated test. */
export function resetAnnouncerStoreForTests(): void {
  cancelScheduledClear();
  useAnnouncerStore.setState({ message: "", politeness: "polite" });
}
