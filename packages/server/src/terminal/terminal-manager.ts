import { encodeTerminalFrame, nextFreeSlot, SLOT_SPACE } from "@av-pi-studio/protocol";

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
 * Size ownership is **last-interacting-client-wins** and which client may claim is a client concern.
 * The manager resizes only when told to explicitly, never as a side effect of subscribe/attach, and
 * never broadcasts resize ownership — a resized PTY simply redraws via normal Output, which every
 * attached client renders in its own viewport. (`subscribe_terminal_request` in `terminal-rpc.ts`
 * does resize before it calls `subscribe()`, using the size the attaching client sent; that is the
 * handler's decision, not something this class does on its own.)
 *
 * Every requested size is validated here — see `isValidGrid`. This is the single choke point every
 * path funnels through (create, binary Resize frame, subscribe payload), and a client is not a
 * trusted source of dimensions.
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

/**
 * Grid bounds for any client-supplied size (`terminals.md` § PTY size ownership: "the daemon MUST
 * validate every requested size, whatever path it arrives on").
 *
 * The floor is `ScreenBuffer`'s own minimum. The ceiling is far past any real display — a 5120px
 * ultrawide at a 6px cell is ~850 columns — and exists to bound what one frame can make the headless
 * grid allocate: cells scale with `cols * rows`, so an unchecked `1e9` is an instant OOM.
 */
const MIN_GRID_COLS = 2;
const MIN_GRID_ROWS = 1;
const MAX_GRID_COLS = 1000;
const MAX_GRID_ROWS = 1000;

/**
 * Whether a client-supplied grid may be applied to a real PTY. Rejects rather than clamps: a clamp
 * silently invents a size neither side asked for, and the client's own belief would then disagree
 * with the PTY forever. A rejected resize is visible (`resize()` returns `false`) and the client's
 * next genuine change still reports.
 *
 * Takes the pair as one object so it narrows both fields for the caller — the values arrive from the
 * wire as `unknown`/possibly-`NaN` numbers, and no caller should have to assert them afterwards.
 */
export function isValidGrid(
  grid: { cols?: unknown; rows?: unknown } | undefined,
): grid is { cols: number; rows: number } {
  if (grid === undefined) return false;
  const { cols, rows } = grid;
  return (
    typeof cols === "number" &&
    Number.isInteger(cols) &&
    cols >= MIN_GRID_COLS &&
    cols <= MAX_GRID_COLS &&
    typeof rows === "number" &&
    Number.isInteger(rows) &&
    rows >= MIN_GRID_ROWS &&
    rows <= MAX_GRID_ROWS
  );
}

interface ManagedTerminal {
  entry: TerminalRuntimeEntry;
  pty: PtyProcess;
  subscribers: Set<TerminalFrameSink>;
  /** Rolling bounded ring used as the transient screen snapshot (raw bytes; clients replay it). */
  screen: SnapshotRing;
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
  /** Rotating hand-out point in the one-byte slot space (see `nextFreeSlot`). */
  private slotCursor = 1;

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

  /**
   * Spawn a PTY in the backend, assign a slot, and track the runtime entry.
   *
   * Slots are a pool, not a counter: the terminal frame header spends one byte on the slot, so
   * the 256th terminal ever opened by a long-lived daemon used to be handed slot 256 and every
   * `encodeTerminalFrame` for it threw, killing terminals until restart. Ids of exited terminals
   * are reused (rotating, so a just-closed slot is the last one handed back out).
   */
  createTerminal(options: CreateTerminalOptions): TerminalRuntimeEntry {
    const slot = nextFreeSlot(this.terminals, this.slotCursor);
    if (slot === null) throw new Error("no free terminal slot (256 terminals already open)");
    this.slotCursor = (slot + 1) % SLOT_SPACE;
    // An invalid client-supplied grid falls back to the 80×24 default rather than failing the spawn:
    // the caller merely loses its size claim, and its first real measurement will reconcile. The
    // response echoes what the PTY actually got, so the client never believes the size it asked for.
    const { cols, rows } = isValidGrid(options) ? options : { cols: 80, rows: 24 };
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
        {
          slot,
          workspaceId: options.workspaceId,
          shell,
          cwd: options.cwd,
          err: (error as Error)?.message ?? String(error),
        },
        "terminal spawn failed",
      );
      throw error;
    }
    this.logger?.info(
      {
        slot,
        workspaceId: options.workspaceId,
        shell,
        cwd: options.cwd,
        cols,
        rows,
        service: options.service === true ? true : undefined,
      },
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
      screen: new SnapshotRing(this.snapshotBytes),
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
    sink(encodeTerminalFrame({ opcode: "Snapshot", slot, data: managed.screen.bytes() }));
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
   * Apply a client-requested size. Returns `false` and does nothing for an unknown/closed slot or an
   * invalid grid — the binary `Resize` frame path reaches this with whatever bytes were on the wire,
   * so this is where a hostile or malformed size is stopped rather than handed to a real PTY.
   *
   * The PTY and screen model are updated **before** `entry`, so a throw from either leaves the entry
   * describing the size the terminal actually has instead of one that was only requested — `entry` is
   * what `list()`/the subscribe echo report, and a lying entry propagates to every client.
   */
  resize(slot: number, cols: number, rows: number): boolean {
    const managed = this.terminals.get(slot);
    if (!managed || managed.entry.closed) return false;
    if (!isValidGrid({ cols, rows })) return false;
    if (managed.entry.cols === cols && managed.entry.rows === rows) return true;
    managed.pty.resize(cols, rows);
    managed.screenModel.resize(cols, rows);
    managed.entry.cols = cols;
    managed.entry.rows = rows;
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
    managed.screen.append(data);
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

/**
 * Escape-safe trim: cutting the retained ring at a raw byte offset frequently lands
 * mid-escape-sequence (`terminals.md` § Restore / snapshot, tier 1). The bytes after such a cut are
 * the sequence's tail — parameter digits, an SGR/cursor final byte, an OSC payload — which the
 * emulator on replay consumes as garbage input instead of the printable text it actually is,
 * corrupting everything after it. `safeReplayStart` finds the nearest safe boundary at or after the
 * naive cut instead; `SnapshotRing.compact` is its only caller.
 */
const ESC = 0x1b;
const BEL = 0x07;

function isCsiFinalByte(byte: number): boolean {
  return byte >= 0x40 && byte <= 0x7e;
}

function isUtf8ContinuationByte(byte: number): boolean {
  return byte >= 0x80 && byte <= 0xbf;
}

/** DCS (`P`), SOS (`X`), PM (`^`), APC (`_`) — all string-typed, all terminated by ST (`ESC \`). */
function startsStringSequence(byte: number): boolean {
  return byte === 0x50 || byte === 0x58 || byte === 0x5e || byte === 0x5f;
}

type ReplayScanState = "normal" | "esc" | "csi" | "osc" | "osc-esc" | "string" | "string-esc";

/**
 * Index of the first byte in `buffer` at or after `from` that can safely start a replay — i.e.
 * not inside an incomplete escape/CSI/OSC/DCS/SOS/PM/APC sequence and not a UTF-8 continuation
 * byte split off from its lead byte. Parses from the start of `buffer`, not from `from`, because
 * whether `from` lands inside a sequence depends on where that sequence began, which may be
 * before `from` — the exact case a raw byte-offset cut produces.
 *
 * Bounded: if the sequence straddling `from` never terminates before `buffer.length`, drops to
 * `buffer.length` (nothing left of that unterminated tail is safe to replay) rather than scanning
 * past the buffer or emitting a partial sequence.
 */
export function safeReplayStart(buffer: Uint8Array, from: number): number {
  if (from <= 0) return 0;
  if (from >= buffer.length) return buffer.length;

  let state: ReplayScanState = "normal";
  for (let i = 0; i < buffer.length; i++) {
    if (state === "normal" && i >= from && !isUtf8ContinuationByte(buffer[i]!)) return i;

    const byte = buffer[i]!;
    switch (state) {
      case "normal":
        if (byte === ESC) state = "esc";
        break;
      case "esc":
        if (byte === 0x5b /* [ */) state = "csi";
        else if (byte === 0x5d /* ] */) state = "osc";
        else if (startsStringSequence(byte)) state = "string";
        else state = "normal"; // two-byte ESC form: this byte was its own terminator
        break;
      case "csi":
        if (isCsiFinalByte(byte)) state = "normal";
        break;
      case "osc":
        if (byte === BEL) state = "normal";
        else if (byte === ESC) state = "osc-esc";
        break;
      case "osc-esc":
        if (byte === 0x5c /* \ */) state = "normal";
        else if (byte !== ESC) state = "osc";
        break;
      case "string":
        if (byte === ESC) state = "string-esc";
        break;
      case "string-esc":
        if (byte === 0x5c) state = "normal";
        else if (byte !== ESC) state = "string";
        break;
    }
  }

  // Ran off the end still inside an unterminated sequence (or a run of continuation bytes with no
  // following lead byte) — nothing from `from` onward is a safe start.
  return buffer.length;
}

/**
 * Fraction of the cap the ring keeps when it compacts. The reclaimed headroom (the remaining
 * quarter) is what makes both costs below amortized rather than per-chunk.
 */
const RING_LOW_WATER = 0.75;

/**
 * Bounded, contiguous byte ring holding the transient replay snapshot for one terminal.
 *
 * This sits on the daemon's hottest path — every byte of every terminal passes through `append` —
 * so the two O(ring) costs are deliberately amortized. The naive version rebuilt the whole buffer
 * per chunk (`concat`) *and* re-ran the escape-safe scan per chunk once full, which on a build
 * spewing megabytes meant tens of thousands of full-ring copies and scans.
 *
 * - **Append is O(chunk).** Bytes are memcpy'd into spare capacity behind a write cursor; nothing
 *   else moves. Only when the cap would be exceeded does a compaction run.
 * - **Compaction is O(ring) but rare.** It reclaims down to `RING_LOW_WATER`, so the next one is a
 *   whole quarter-cap of output away instead of one chunk away.
 *
 * The bytes stay contiguous because `safeReplayStart` must parse from the start of the retained
 * region — whether an offset sits mid-sequence depends on where that sequence began, which a
 * chunk-list representation could not answer without flattening first.
 */
class SnapshotRing {
  private readonly buf: Uint8Array;
  private readonly lowWater: number;
  private len = 0;

  constructor(private readonly max: number) {
    this.buf = new Uint8Array(max);
    // `max` can be tiny in tests; never let the target reclaim the entire ring.
    this.lowWater = Math.max(1, Math.floor(max * RING_LOW_WATER));
  }

  /** The retained bytes. A view, not a copy — `encodeTerminalFrame` copies into the frame it builds. */
  bytes(): Uint8Array {
    return this.buf.subarray(0, this.len);
  }

  append(data: Uint8Array): void {
    // A single chunk at least as large as the whole ring replaces it outright: everything currently
    // retained is older than bytes we are about to drop anyway.
    if (data.length >= this.max) {
      const start = safeReplayStart(data, data.length - this.lowWater);
      this.len = data.length - start;
      this.buf.set(data.subarray(start), 0);
      return;
    }
    if (this.len + data.length > this.max) {
      // Drop enough that the post-append length lands on the low-water mark.
      this.compact(this.len + data.length - this.lowWater);
    }
    this.buf.set(data, this.len);
    this.len += data.length;
  }

  /** Discard the oldest `drop` bytes, rounded forward to the next escape-safe boundary. */
  private compact(drop: number): void {
    const start = safeReplayStart(this.bytes(), drop);
    this.buf.copyWithin(0, start, this.len);
    this.len -= start;
  }
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
