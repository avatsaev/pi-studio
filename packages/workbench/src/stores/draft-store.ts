/**
 * Draft store — per-session composer text, lifted out of `Composer.tsx`'s local `useState`
 * (sprint-069/task-007) so a `set_editor_text` extension effect can write a session's draft even
 * when no composer for that session is currently mounted (no chat tab ever opened for it): the
 * text lands here and is picked up as the initial value the moment a composer for that session
 * first mounts. `TabPanelHost.tsx` keeps every *opened* tab's composer mounted-but-hidden for
 * life, so in practice this also just naturally survives ordinary tab switches — the same "one
 * source of truth outside the component" shape as `toast-store.ts`, not a new pattern.
 *
 * `pendingFeedback` is the visible/deferred-note handoff for § 11's `set_editor_text` treatment:
 * `replaceDraft`'s caller decides `flash` (true only when applied while that session's composer
 * was on screen at that exact moment — never replayed later), and the border flash/note UI those
 * are rendered as is owned entirely by `Composer.tsx`, not this store. One-shot by design: § 11's
 * background-pane note "appears the first time the pane is shown, then expires" — `consumeFeedback`
 * pops the entry so a second mount/visibility-flip of the same composer sees nothing.
 */

import { create } from "zustand";

export interface DraftFeedback {
  /** "filled" when the prior draft was empty, "replaced" otherwise — § 11's two copy variants
   *  ("Your message was filled in" / "Your draft was replaced"), decided from the draft's PRIOR
   *  state, never from whether the incoming text itself happens to be empty. */
  copy: "replaced" | "filled";
  /** Whether to play the border flash. `false` means note-only — either because the composer was
   *  not visible at the moment of replacement (§ 11's background-pane rule), or because there is
   *  no composer mounted anywhere for this session yet. */
  flash: boolean;
}

interface DraftStoreState {
  /** Per-session draft text. A session with no entry has an empty draft — same default as the
   *  old per-composer `useState("")`. */
  drafts: Record<string, string>;
  /** At most one queued `set_editor_text` feedback per session, consumed exactly once. */
  pendingFeedback: Record<string, DraftFeedback>;
  /** Ordinary user-driven draft edits (typing, slash-command completion, clearing on submit) —
   *  never produces feedback. */
  setDraft(sessionId: string, text: string): void;
  /** `set_editor_text` effect application. `visible` is the target session's composer's on-screen
   *  state at the exact moment this is called — the caller (`agent-ui-store.ts`) must compute it
   *  fresh per effect, never cache it. */
  replaceDraft(sessionId: string, text: string, visible: boolean): void;
  /** Pops and returns `sessionId`'s queued feedback, or `undefined` if none is pending. */
  consumeFeedback(sessionId: string): DraftFeedback | undefined;
}

export const useDraftStore = create<DraftStoreState>()((set, get) => ({
  drafts: {},
  pendingFeedback: {},

  setDraft(sessionId, text) {
    set((s) => ({ drafts: { ...s.drafts, [sessionId]: text } }));
  },

  replaceDraft(sessionId, text, visible) {
    const priorWasEmpty = (get().drafts[sessionId] ?? "") === "";
    const feedback: DraftFeedback = { copy: priorWasEmpty ? "filled" : "replaced", flash: visible };
    set((s) => ({
      drafts: { ...s.drafts, [sessionId]: text },
      pendingFeedback: { ...s.pendingFeedback, [sessionId]: feedback },
    }));
  },

  consumeFeedback(sessionId) {
    const feedback = get().pendingFeedback[sessionId];
    if (feedback === undefined) return undefined;
    set((s) => {
      const next = { ...s.pendingFeedback };
      delete next[sessionId];
      return { pendingFeedback: next };
    });
    return feedback;
  },
}));
