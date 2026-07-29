import { encodeTerminalFrame } from "@av-pi-studio/protocol";

import type { Logger } from "../logging/logger.js";
import {
  createDefaultPtyBackend,
  type PtyBackend,
  type PtyProcess,
  resolveExecutable,
} from "./pty-backend.js";
import { ScreenBuffer } from "./screen-buffer.js";

/**
 * Workspace-scoped PTY terminal manager (features/terminals.md § Behavior, § PTY size ownership,
 * § Output coalescing). PTYs are multiplexed over the binary terminal stream protocol by `slot`.
 *
 * Size ownership is **last-interacting-client-wins** and is a client concern: the manager only
 * resizes the PTY when a client explicitly sends a Resize (genuine viewport change / focus). It
 * NEVER resizes on subscribe/attach, and never broadcasts resize ownership — a resized PTY simply
 * redraws via normal Output, which every attached client renders in its own viewport.
 */

/** A subscriber sink receives fully-encoded binary terminal frames. */
export type TerminalFrameSink = (frame: Uint8Array) => void;

export interface TerminalRuntimeEntry {
  slot: number;
  workspaceId: string;
  name: string;
  cwd?: string;
  shell: string;
  cols: number;
  rows: number;
  /** `true` once the PTY has exited. */
  closed: boolean;
  /** Marks a service-script-backed terminal (handed to the service proxy elsewhere). */
  service?: boolean;
}

export interface CreateTerminalOptions {
  workspaceId: string;
  cwd?: string;
  shell?: string;
  args?: string[];
  name?: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
  service?: boolean;
}

export interface TerminalManagerOptions {
  backend?: PtyBackend;
  /** Output coalescing window in ms (batch before broadcast). Default 4ms. */
  coalesceMs?: number;
  /** Max bytes retained as the transient "screen" snapshot. Default 64KiB. */
  snapshotBytes?: number;
  defaultShell?: string;
  /** Operational logger: terminal opened/killed/exited (info), spawn failures (error). */
  logger?: Logger;
}

interface ManagedTerminal {
  entry: TerminalRuntimeEntry;
  pty: PtyProcess;
  subscribers: Set<TerminalFrameSink>;
  /** Rolling buffer used as the transient screen snapshot (raw bytes; clients replay it). */
  screen: Uint8Array;
  /** Headless terminal grid used for screen-accurate text capture (CLI/MCP). */
  screenModel: ScreenBuffer;
  /** Pending coalesced output. */
  pending: Uint8Array[];
  flushTimer: ReturnType<typeof setTimeout> | null;
}

export class TerminalManager {
  private readonly backend: PtyBackend;
  private readonly coalesceMs: number;
  private readonly snapshotBytes: number;
  private readonly defaultShell: string;
  private readonly terminals = new Map<number, ManagedTerminal>();
  private readonly logger?: Logger;
  private nextSlot = 1;

  constructor(options: TerminalManagerOptions = {}) {
    this.backend = options.backend ?? createDefaultPtyBackend();
    this.coalesceMs = options.coalesceMs ?? 4;
    this.snapshotBytes = options.snapshotBytes ?? 64 * 1024;
    this.logger = options.logger;
    this.defaultShell = resolveExecutable(options.defaultShell ?? process.env.SHELL ?? "/bin/sh");
  }

  /** All live terminal runtime entries. */
  list(): TerminalRuntimeEntry[] {
    return [...this.terminals.values()].map((t) => t.entry);
  }

  get(slot: number): TerminalRuntimeEntry | undefined {
    return this.terminals.get(slot)?.entry;
  }

  /** Spawn a PTY in the backend, assign a slot, and track the runtime entry. */
  createTerminal(options: CreateTerminalOptions): TerminalRuntimeEntry {
    const slot = this.nextSlot++;
    const cols = options.cols ?? 80;
    const rows = options.rows ?? 24;
    const shell = options.shell ?? this.defaultShell;

    let pty: PtyProcess;
    try {
      pty = this.backend.spawn({
        shell,
        args: options.args,
        cwd: options.cwd,
        env: options.env,
        cols,
        rows,
      });
    } catch (error) {
      this.logger?.error(
        { slot, workspaceId: options.workspaceId, shell, cwd: options.cwd, err: (error as Error)?.message ?? String(error) },
        "terminal spawn failed",
      );
      throw error;
    }
    this.logger?.info(
      { slot, workspaceId: options.workspaceId, shell, cwd: options.cwd, cols, rows, service: options.service === true ? true : undefined },
      "terminal opened",
    );

    const entry: TerminalRuntimeEntry = {
      slot,
      workspaceId: options.workspaceId,
      name: options.name ?? `terminal-${slot}`,
      cwd: options.cwd,
      shell,
      cols,
      rows,
      closed: false,
      service: options.service,
    };

    const managed: ManagedTerminal = {
      entry,
      pty,
      subscribers: new Set(),
      screen: new Uint8Array(0),
      screenModel: new ScreenBuffer(cols, rows),
      pending: [],
      flushTimer: null,
    };
    this.terminals.set(slot, managed);

    pty.onData((data) => this.onOutput(managed, data));
    pty.onExit(() => this.onExit(managed));

    return entry;
  }

  /**
   * Subscribe to a slot: emit a Snapshot frame (current screen) immediately, then live Output frames.
   * Does NOT resize the PTY (passive attach must not claim size). Returns an unsubscribe fn.
   */
  subscribe(slot: number, sink: TerminalFrameSink): () => void {
    const managed = this.terminals.get(slot);
    if (!managed) throw new Error(`no terminal in slot ${slot}`);

    // Snapshot first (rebuilds screen state), then live output.
    sink(encodeTerminalFrame({ opcode: "Snapshot", slot, data: managed.screen.slice() }));
    managed.subscribers.add(sink);

    return () => {
      managed.subscribers.delete(sink);
    };
  }

  rename(slot: number, name: string): boolean {
    const managed = this.terminals.get(slot);
    if (!managed) return false;
    managed.entry.name = name;
    return true;
  }

  /** Forward input bytes to the PTY. */
  input(slot: number, bytes: Uint8Array): boolean {
    const managed = this.terminals.get(slot);
    if (!managed || managed.entry.closed) return false;
    managed.pty.write(bytes);
    return true;
  }

  /**
   * Explicit, client-initiated resize (genuine viewport change / focus). The only path that claims
   * PTY size. Never called from subscribe/attach.
   */
  resize(slot: number, cols: number, rows: number): boolean {
    const managed = this.terminals.get(slot);
    if (!managed || managed.entry.closed) return false;
    managed.entry.cols = cols;
    managed.entry.rows = rows;
    managed.pty.resize(cols, rows);
    managed.screenModel.resize(cols, rows);
    return true;
  }

  /** One-shot current screen text (for CLI/MCP capture). Does not subscribe. Screen-accurate. */
  capture(slot: number): string | null {
    const managed = this.terminals.get(slot);
    if (!managed) return null;
    return managed.screenModel.snapshotText();
  }

  /** Terminate the PTY and notify subscribers. */
  kill(slot: number): boolean {
    const managed = this.terminals.get(slot);
    if (!managed) return false;
    this.logger?.info({ slot, workspaceId: managed.entry.workspaceId }, "terminal kill requested");
    managed.pty.kill();
    this.onExit(managed);
    return true;
  }

  /** Kill every live terminal and clear its pending flush timer. Call on daemon shutdown so no
   * PTY can emit output after the transports/sinks it would flush through have been torn down
   * (a stray coalesce timer firing post-shutdown used to throw "cannot send after close()" from
   * inside a bare `setTimeout` callback, crashing the process). */
  killAll(): void {
    for (const slot of Array.from(this.terminals.keys())) {
      this.kill(slot);
    }
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  private onOutput(managed: ManagedTerminal, data: Uint8Array): void {
    // Append to the transient screen snapshot (bounded ring) for binary client replay.
    managed.screen = appendBounded(managed.screen, data, this.snapshotBytes);
    // Feed the headless grid for screen-accurate text capture.
    managed.screenModel.write(data);
    // Coalesce before broadcast.
    managed.pending.push(data);
    if (managed.flushTimer) return;
    managed.flushTimer = setTimeout(() => this.flush(managed), this.coalesceMs);
  }

  private flush(managed: ManagedTerminal): void {
    managed.flushTimer = null;
    if (managed.pending.length === 0) return;
    const batch = concat(managed.pending);
    managed.pending = [];
    const frame = encodeTerminalFrame({ opcode: "Output", slot: managed.entry.slot, data: batch });
    for (const sink of managed.subscribers) sink(frame);
  }

  private onExit(managed: ManagedTerminal): void {
    if (managed.entry.closed) return;
    if (managed.flushTimer) {
      clearTimeout(managed.flushTimer);
      this.flush(managed);
    }
    managed.entry.closed = true;
    this.logger?.info(
      { slot: managed.entry.slot, workspaceId: managed.entry.workspaceId },
      "terminal exited",
    );
    managed.screenModel.dispose();
    this.terminals.delete(managed.entry.slot);
    // Notify subscribers the terminal closed (empty Output then drop). Clients treat an exited
    // terminal as closed; no dedicated close opcode exists in the binary protocol.
    managed.subscribers.clear();
  }
}

function appendBounded(buffer: Uint8Array, data: Uint8Array, max: number): Uint8Array {
  const combined = concat([buffer, data]);
  return combined.length <= max ? combined : combined.slice(combined.length - max);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
