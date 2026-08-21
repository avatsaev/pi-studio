/**
 * Toast store — sprint-069/task-005, the first consumer of `ui/toast.ts`'s previously-unimported
 * logic. Owns queueing/stacking/dismissal decisions (plain data, testable under Node) plus the
 * real dismiss timers (`setTimeout`, kept in a module-level `Map` — a timer handle is not display
 * data, so it never enters the reactive state; mirrors `agent-ui-store.ts`'s module-level cache
 * convention for the identical reason).
 *
 * Stacking (§ 11): at most `MAX_VISIBLE_TOASTS` are ever visible. `toasts` is the full FIFO queue,
 * oldest first; `toasts.slice(0, MAX_VISIBLE_TOASTS)` is what's actually shown —
 * `ToastViewport.tsx` renders exactly that slice, and the store itself never trims the array. A
 * queued (not-yet-visible) entry's dismiss countdown starts the moment it is *promoted* into a
 * visible slot, not at `show()` time — `promoteIfNewlyVisible` resets `shownAt` to that instant, so
 * a toast that waited behind others still gets its full nominal duration once actually shown.
 *
 * "Top" — what `dismissTop()` (Esc) removes, and the visually topmost slot in the top-anchored
 * viewport — is `toasts[0]`, the longest-visible entry; new toasts append below it, growing the
 * stack downward from the anchor edge.
 */

import { create } from "zustand";
import {
  buildToastEntry,
  copiedToast,
  errorToast,
  remainingMs,
  type ToastEntry,
  type ToastOptions,
} from "@pi-studio-ui/ui/toast.js";

export const MAX_VISIBLE_TOASTS = 3;

let nextId = 0;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function clearTimer(id: string): void {
  const handle = timers.get(id);
  if (handle !== undefined) {
    clearTimeout(handle);
    timers.delete(id);
  }
}

interface ToastStoreState {
  toasts: ToastEntry[];
  show(content: string, opts?: ToastOptions): string;
  copied(label?: string): string;
  error(message: string): string;
  dismiss(id: string): void;
  dismissTop(): void;
  pause(id: string): void;
  resume(id: string): void;
}

export const useToastStore = create<ToastStoreState>((set, get) => {
  function promoteIfNewlyVisible(id: string): void {
    const idx = get().toasts.findIndex((t) => t.id === id);
    if (idx === -1 || idx >= MAX_VISIBLE_TOASTS || timers.has(id)) return;
    const entry = get().toasts[idx]!;
    if (entry.durationMs === null || entry.paused) return; // sticky, or arrived already paused
    const shown: ToastEntry = { ...entry, shownAt: Date.now() };
    set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? shown : t)) }));
    timers.set(
      id,
      setTimeout(() => get().dismiss(id), shown.durationMs!),
    );
  }

  return {
    toasts: [],

    show(content, opts = {}) {
      const id = `toast-${++nextId}`;
      set((s) => ({ toasts: [...s.toasts, buildToastEntry(id, content, opts)] }));
      promoteIfNewlyVisible(id);
      return id;
    },

    copied(label) {
      const { content, opts } = copiedToast(label);
      return get().show(content, opts);
    },

    error(message) {
      const { content, opts } = errorToast(message);
      return get().show(content, opts);
    },

    dismiss(id) {
      clearTimer(id);
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      // A queued entry may have just been promoted into the slot this one freed.
      for (const entry of get().toasts.slice(0, MAX_VISIBLE_TOASTS)) {
        promoteIfNewlyVisible(entry.id);
      }
    },

    dismissTop() {
      const top = get().toasts[0];
      if (top) get().dismiss(top.id);
    },

    pause(id) {
      const entry = get().toasts.find((t) => t.id === id);
      if (!entry || entry.durationMs === null || entry.paused) return;
      const remaining = remainingMs(entry, null, Date.now()) ?? entry.durationMs;
      clearTimer(id);
      set((s) => ({
        toasts: s.toasts.map((t) =>
          t.id === id ? { ...t, paused: true, pausedRemaining: remaining } : t,
        ),
      }));
    },

    resume(id) {
      const entry = get().toasts.find((t) => t.id === id);
      if (!entry || !entry.paused) return;
      const remaining = entry.pausedRemaining ?? entry.durationMs ?? 0;
      const shownAt = Date.now() - ((entry.durationMs ?? 0) - remaining);
      const resumed: ToastEntry = { ...entry, paused: false, pausedRemaining: undefined, shownAt };
      set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? resumed : t)) }));
      timers.set(
        id,
        setTimeout(() => get().dismiss(id), remaining),
      );
    },
  };
});

/** Test-only: clears live timers and resets state — a fresh `useToastStore.setState({ toasts: [] })`
 * alone would leak `timers`/`nextId` across test cases, the same class of bug `test/reset-stores.ts`'s
 * header comment warns about for every other store. */
export function resetToastStoreForTests(): void {
  for (const handle of timers.values()) clearTimeout(handle);
  timers.clear();
  nextId = 0;
  useToastStore.setState({ toasts: [] });
}
