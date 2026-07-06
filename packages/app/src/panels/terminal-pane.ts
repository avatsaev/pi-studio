// Terminal pane view model.
// clean-room-scope/features/feature-panels-ui.md § Terminal pane

// ─── Terminal connection state ─────────────────────────────────────────────

export type TerminalStatus =
  | { kind: "connecting" }
  | { kind: "connected"; terminalId: string }
  | { kind: "exited"; code?: number }
  | { kind: "error"; message: string }
  | { kind: "not-connected" };

export type TerminalPaneState = {
  terminalId: string;
  status: TerminalStatus;
  title?: string;
  cwd?: string;
  workspaceAvailable: boolean;
  isActive: boolean;
  isPaneFocused: boolean;
  snapshotRestored: boolean;
  lastKnownSize: { cols: number; rows: number } | undefined;
};

export const INITIAL_TERMINAL_PANE: TerminalPaneState = {
  terminalId: "",
  status: { kind: "not-connected" },
  workspaceAvailable: true,
  isActive: false,
  isPaneFocused: false,
  snapshotRestored: false,
  lastKnownSize: undefined,
};

// ─── Subscription / router contract ──────────────────────────────────────

export type TerminalSubscribeRequest = {
  terminalId: string;
  restoreSnapshot?: boolean;
  preferredCols: number;
  preferredRows: number;
};

export type TerminalInputPayload = { data: string } | { key: string; modifiers: TerminalModifiers };

export type TerminalModifiers = { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean };

export type TerminalResizePayload = { cols: number; rows: number };

// The claiming pane is the only one that should send resize.
export function shouldSendResize(state: TerminalPaneState): boolean {
  return state.status.kind === "connected" && state.isActive && state.isPaneFocused && state.workspaceAvailable;
}

export function shouldSendOutput(state: TerminalPaneState): boolean {
  return state.status.kind === "connected" && state.isActive && state.workspaceAvailable;
}

// Dedup: only send resize if dimensions actually changed.
export function dedupResize(current: { cols: number; rows: number } | undefined, next: { cols: number; rows: number }): boolean {
  if (!current) return true;
  return current.cols !== next.cols || current.rows !== next.rows;
}

// ─── Restore / snapshot ──────────────────────────────────────────────────

export type RestoreSnapshot = {
  terminalId: string;
  scope: string; // `serverId:cwd`
  data: string;
  cols: number;
  rows: number;
};

export type SnapshotCache = Map<string, RestoreSnapshot>;

export function snapshotCacheKey(serverId: string, cwd: string): string {
  return `${serverId}:${cwd}`;
}

export function storeSnapshot(cache: SnapshotCache, snapshot: RestoreSnapshot): SnapshotCache {
  const next = new Map(cache);
  next.set(snapshot.scope, snapshot);
  return next;
}

export function clearSnapshot(cache: SnapshotCache, scope: string): SnapshotCache {
  const next = new Map(cache);
  next.delete(scope);
  return next;
}

// ─── LRU keepalive ───────────────────────────────────────────────────────
// The terminal tab stays mounted-but-hidden in the LRU so sessions survive background.
// The LRU logic itself lives in workspace/keepalive.ts; this is just the flag.

export function terminalShouldKeepMounted(state: TerminalPaneState): boolean {
  return state.status.kind === "connected" || state.status.kind === "connecting";
}

// ─── Descriptor ──────────────────────────────────────────────────────────

export function terminalDescriptorLabel(state: TerminalPaneState): string {
  if (state.title) return state.title;
  if (state.cwd) return state.cwd.split("/").filter(Boolean).at(-1) ?? "Terminal";
  return "Terminal";
}

export function terminalStatusBucket(state: TerminalPaneState): "running" | "idle" | "failed" | undefined {
  switch (state.status.kind) {
    case "connected": return "running";
    case "error": return "failed";
    case "exited": return "idle";
    default: return undefined;
  }
}

// ─── Mobile key bar ──────────────────────────────────────────────────────

export type KeyBarKey = {
  label: string;
  /** The character sequence to send, or a special key name. */
  sequence: string;
  isModifier: boolean;
};

export const MOBILE_KEY_BAR: KeyBarKey[] = [
  { label: "Esc", sequence: "\x1b", isModifier: false },
  { label: "Tab", sequence: "\t", isModifier: false },
  { label: "Ctrl", sequence: "ctrl", isModifier: true },
  { label: "↑", sequence: "\x1b[A", isModifier: false },
  { label: "Shift", sequence: "shift", isModifier: true },
  { label: "⌫", sequence: "\x7f", isModifier: false },
  { label: "Alt", sequence: "alt", isModifier: true },
  { label: "Space", sequence: " ", isModifier: false },
  { label: "←", sequence: "\x1b[D", isModifier: false },
  { label: "↓", sequence: "\x1b[B", isModifier: false },
  { label: "→", sequence: "\x1b[C", isModifier: false },
  { label: "↵", sequence: "\r", isModifier: false },
];

export type KeyBarState = {
  ctrlDown: boolean;
  shiftDown: boolean;
  altDown: boolean;
};

export const INITIAL_KEY_BAR: KeyBarState = { ctrlDown: false, shiftDown: false, altDown: false };

export function applyKeyBarPress(state: KeyBarState, key: KeyBarKey): { newState: KeyBarState; sequence: string | null } {
  if (key.label === "Ctrl") return { newState: { ...state, ctrlDown: !state.ctrlDown }, sequence: null };
  if (key.label === "Shift") return { newState: { ...state, shiftDown: !state.shiftDown }, sequence: null };
  if (key.label === "Alt") return { newState: { ...state, altDown: !state.altDown }, sequence: null };

  // Apply sticky modifiers and produce the chord
  let seq = key.sequence;
  if (state.ctrlDown && seq.length === 1) {
    const code = seq.toUpperCase().charCodeAt(0) - 64;
    if (code > 0 && code < 32) seq = String.fromCharCode(code);
  }
  if (state.altDown) seq = `\x1b${seq}`;
  // Reset sticky modifiers after use
  return { newState: INITIAL_KEY_BAR, sequence: seq };
}
