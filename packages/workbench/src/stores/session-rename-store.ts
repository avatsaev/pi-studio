/**
 * Which session the rename dialog is open for, if any. One global dialog instance
 * (`features/sessions/RenameSessionDialog.tsx`); the session menu opens it, the dialog closes it.
 */

import { create } from "zustand";

interface SessionRenameState {
  /** The session being renamed, or `null` while the dialog is closed. */
  sessionId: string | null;
  open(sessionId: string): void;
  close(): void;
}

export const useSessionRenameStore = create<SessionRenameState>()((set) => ({
  sessionId: null,
  open: (sessionId) => set({ sessionId }),
  close: () => set({ sessionId: null }),
}));
