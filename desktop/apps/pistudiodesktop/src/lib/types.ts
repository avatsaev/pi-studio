// The shapes the shell sends: `control::view` in crates/shell and `document.inspect` in
// crates/engine. Keep them in step with the Rust side; the frontend never builds these itself.

export type Theme = "dark" | "light";

export interface UiState {
  theme: Theme;
  hideDone: boolean;
  /** The last command's error. Empty after a success. */
  status: string;
}

export interface Item {
  /** A `u64` on the Rust side. JSON numbers are exact only below 2^53. */
  id: number;
  text: string;
  done: boolean;
}

export interface DocumentView {
  title: string;
  items: Item[];
  revision: number;
  path: string | null;
  dirty: boolean;
  undo: string | null;
  redo: string | null;
}

export interface Shortcut {
  /** As written in the registry, e.g. `Cmd+Shift+Z`. */
  text: string;
  /** The platform's command key: Cmd on macOS, Ctrl elsewhere. */
  cmd: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  /** The lowercased `KeyboardEvent.key` to match. */
  key: string;
}

export interface MenuItem {
  id: string;
  label: string;
  shortcut: Shortcut | null;
  enabled: boolean;
  /** Why the item is disabled. */
  reason: string | null;
  /** Not `null` for a toggle. */
  checked: boolean | null;
}

export interface Menu {
  label: string;
  items: MenuItem[];
}

/** Everything the frontend draws: what `ui.inspect` returns. */
export interface View {
  ui: UiState;
  document: DocumentView | null;
  menus: Menu[];
  shellCommands: { id: string; label: string; checked: boolean }[];
}

export type Reply<T = unknown> = { ok: true; result: T } | { ok: false; error: string };

/** The frontend's only way to the app. Components get one as a prop, so tests pass a fake. */
export interface Backend {
  /** A control-protocol call: `engine.execute`, `engine.commands`, `ui.inspect`, `ui.set`. */
  control(method: string, params?: Record<string, unknown>): Promise<Reply>;
  /** A menu click or a shortcut: the shell collects what the command needs, then runs it. */
  invoke(command: string): Promise<Reply>;
  /** Call `draw` whenever what should be on screen has changed. Resolves to "stop listening". */
  onView(draw: (view: View) => void): Promise<() => void>;
}
