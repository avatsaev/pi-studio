/**
 * Terminal store — the right-sidebar Terminals tab's live view of every PTY currently running on
 * the daemon (server-authoritative `TerminalRuntimeEntry[]`, features/terminals.md § Control
 * RPCs). Exists to surface — and let the user kill — terminals that outlive their tab: closing a
 * terminal tab now sends `kill_terminal_request` (see `TerminalPanel.tsx`), but a terminal can
 * still end up orphaned (a daemon restart losing the tab's in-memory link, a dev-mode
 * double-mount race losing the created slot before it's persisted onto the tab, or simply a
 * terminal created outside this UI, e.g. via the CLI/MCP) — this store is the safety net for all
 * of those, not just the common case.
 */

import { create } from "zustand";

export interface TerminalRuntimeEntry {
  slot: number;
  workspaceId: string;
  name: string;
  cwd?: string;
  shell: string;
  cols: number;
  rows: number;
  closed: boolean;
  service?: boolean;
}

interface TerminalStoreState {
  terminals: TerminalRuntimeEntry[];

  setTerminals(terminals: TerminalRuntimeEntry[]): void;
}

export const useTerminalStore = create<TerminalStoreState>()((set) => ({
  terminals: [],

  setTerminals: (terminals) => set({ terminals }),
}));
