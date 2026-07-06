/**
 * Terminal stream controller and React hooks — sprint-023 / task-003
 *
 * Manages xterm ↔ daemon binary frames, session retention (ref-counted keepalive),
 * debounced+deduped resize, and snapshot restore on reconnect.
 *
 * See: clean-room-scope/features/terminals.md
 *      clean-room-scope/architecture/websocket-protocol.md § binary frames
 */

import type { TerminalStreamRouter } from "@av-pi-studio/client";

// ─── Resize dedup helper ──────────────────────────────────────────────────────

/**
 * Returns true if the new dimensions differ from the last sent dimensions
 * (i.e. the resize SHOULD be sent). Updates `last` in place.
 *
 * Mirrors the `dedupResize` logic from sprint-022 terminal pane.
 */
export function dedupResize(
  last: { cols: number; rows: number } | undefined,
  cols: number,
  rows: number,
): boolean {
  if (!last) return true;
  return last.cols !== cols || last.rows !== rows;
}

// ─── Terminal stream controller ───────────────────────────────────────────────

export interface TerminalControllerOptions {
  /** Binary frame router from PiStudioClient. */
  router: TerminalStreamRouter;
  /** The numeric slot this terminal occupies. */
  slot: number;
  /** Called with decoded output bytes from the PTY. */
  onOutput: (data: Uint8Array) => void;
  /** Called when a full-screen snapshot arrives (on subscribe / reconnect). */
  onSnapshot: (data: Uint8Array) => void;
  /** Called when a restore-snapshot arrives (reflowable restore). */
  onRestore?: (data: Uint8Array) => void;
}

export interface TerminalController {
  /** Write input (as UTF-8 bytes) to the PTY. */
  writeInput(data: Uint8Array): void;
  /** Send a resize if dimensions changed. Returns true if resize was sent. */
  resize(cols: number, rows: number): boolean;
  /** Subscribe to this slot's output (idempotent). Returns unsub fn. */
  subscribe(): () => void;
  /** True once at least one snapshot has been received (restored state). */
  readonly snapshotRestored: boolean;
}

export function createTerminalController(opts: TerminalControllerOptions): TerminalController {
  let snapshotRestored = false;
  let lastSize: { cols: number; rows: number } | undefined;
  let unsubSlot: (() => void) | null = null;

  const controller: TerminalController = {
    get snapshotRestored() {
      return snapshotRestored;
    },

    subscribe() {
      if (unsubSlot) return unsubSlot;
      unsubSlot = opts.router.subscribeSlot(opts.slot, {
        onOutput: opts.onOutput,
        onSnapshot: (data) => {
          snapshotRestored = true;
          opts.onSnapshot(data);
        },
        onRestore: (data) => {
          snapshotRestored = true;
          opts.onRestore?.(data);
        },
      });
      return unsubSlot;
    },

    writeInput(data) {
      opts.router.sendInput(opts.slot, data);
    },

    resize(cols, rows) {
      if (!dedupResize(lastSize, cols, rows)) return false;
      lastSize = { cols, rows };
      opts.router.sendResize(opts.slot, rows, cols);
      return true;
    },
  };

  return controller;
}

// ─── Terminal session registry ────────────────────────────────────────────────

/**
 * Ref-counted terminal session registry.
 *
 * Keeps sessions alive while any pane holds a reference. When the ref count
 * drops to zero, starts an eviction timer (KEEPALIVE_TTL_MS). Sessions beyond
 * MAX_SESSIONS are evicted LRU.
 *
 * This is a pure-logic module (no React) so it can be instantiated once at
 * the connection-provider level.
 */

export interface TerminalSession {
  terminalId: string;
  slot: number;
  controller: TerminalController;
  refs: number;
  lastUsed: number;
}

const MAX_SESSIONS = 6;
const KEEPALIVE_TTL_MS = 60_000; // 1 minute after last ref drop

export class TerminalSessionRegistry {
  private readonly sessions = new Map<string, TerminalSession>();
  private readonly evictionTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Acquire a session for a terminal. Creates if needed; increments ref.
   * Returns the session and an `release()` function.
   */
  acquire(
    terminalId: string,
    factory: (terminalId: string) => { slot: number; controller: TerminalController },
  ): { session: TerminalSession; release: () => void } {
    // Cancel any pending eviction
    const pendingEvict = this.evictionTimers.get(terminalId);
    if (pendingEvict) {
      clearTimeout(pendingEvict);
      this.evictionTimers.delete(terminalId);
    }

    let session = this.sessions.get(terminalId);
    if (!session) {
      const { slot, controller } = factory(terminalId);
      session = { terminalId, slot, controller, refs: 0, lastUsed: Date.now() };
      this.sessions.set(terminalId, session);
      this.evictLRU();
    }

    session.refs++;
    session.lastUsed = Date.now();

    const release = () => {
      const s = this.sessions.get(terminalId);
      if (!s) return;
      s.refs = Math.max(0, s.refs - 1);
      s.lastUsed = Date.now();
      if (s.refs === 0) {
        // Schedule eviction
        const timer = setTimeout(() => {
          this.sessions.delete(terminalId);
          this.evictionTimers.delete(terminalId);
        }, KEEPALIVE_TTL_MS);
        this.evictionTimers.set(terminalId, timer);
      }
    };

    return { session, release };
  }

  /** Return a session without incrementing its ref count (for read access). */
  peek(terminalId: string): TerminalSession | undefined {
    return this.sessions.get(terminalId);
  }

  /** Active session count. */
  get size(): number {
    return this.sessions.size;
  }

  /** Evict all sessions and cancel timers (e.g. on disconnect). */
  clear(): void {
    for (const timer of this.evictionTimers.values()) clearTimeout(timer);
    this.evictionTimers.clear();
    this.sessions.clear();
  }

  private evictLRU(): void {
    if (this.sessions.size <= MAX_SESSIONS) return;
    // Find the session with lowest refs then oldest lastUsed
    let oldest: TerminalSession | undefined;
    for (const s of this.sessions.values()) {
      if (s.refs === 0 && (!oldest || s.lastUsed < oldest.lastUsed)) {
        oldest = s;
      }
    }
    if (oldest) {
      const timer = this.evictionTimers.get(oldest.terminalId);
      if (timer) clearTimeout(timer);
      this.evictionTimers.delete(oldest.terminalId);
      this.sessions.delete(oldest.terminalId);
    }
  }
}

// ─── Debounced resize helper ──────────────────────────────────────────────────

/**
 * Returns a debounced resize function that coalesces rapid resize events.
 * Only the final dimensions within the debounce window are sent.
 */
export function createDebouncedResize(
  controller: TerminalController,
  debounceMs = 100,
): (cols: number, rows: number) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;

  return (cols: number, rows: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      controller.resize(cols, rows);
      timer = undefined;
    }, debounceMs);
  };
}

// ─── Hook type stubs (for React component consumption) ───────────────────────
//
// These hooks would normally depend on `useEffect` / `useRef` and a DOM xterm
// instance. Since xterm requires a browser DOM and this package builds both for
// Node (tests) and browser, we export the plain logic above plus typed interfaces
// for the React hook shapes so TypeScript callers have stable signatures.

export interface UseTerminalSessionResult {
  status: "idle" | "connecting" | "connected" | "error";
  controller: TerminalController | null;
  /** Called by TerminalPane when its container div mounts. */
  attachToRef: (el: HTMLDivElement | null) => void;
  /** Debounced resize — call from ResizeObserver. */
  handleResize: (cols: number, rows: number) => void;
}

export interface UseWorkspaceTerminalsResult {
  terminalIds: string[];
  isLoading: boolean;
}
