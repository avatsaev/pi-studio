import { encodeTerminalFrame, type TerminalFrame } from "@av-pi-studio/protocol";

import type { DaemonClient } from "./daemon-client.js";

/**
 * Client-side demux of binary terminal frames to per-slot subscribers, plus outbound input/resize
 * encoding (architecture/client-app-runtime.md § Router; features/terminals.md § Binary stream
 * protocol).
 *
 * Inbound `Output`/`Snapshot`/`Restore` frames are dispatched to the subscriber registered for that
 * `slot`. Outbound `Input`/`Resize` are encoded with the right opcode + slot and sent on the data
 * path.
 */

export interface TerminalSlotSubscriber {
  /** Live terminal output bytes. */
  onOutput?: (data: Uint8Array) => void;
  /** Full-screen snapshot bytes (sent on (re)subscribe). */
  onSnapshot?: (data: Uint8Array) => void;
  /** Restore snapshot bytes (reflowable/mode-gated). */
  onRestore?: (data: Uint8Array) => void;
}

export class TerminalStreamRouter {
  private readonly subscribers = new Map<number, TerminalSlotSubscriber>();
  private detach: (() => void) | null = null;

  constructor(private readonly daemon: DaemonClient) {}

  /** Begin routing inbound terminal frames. Idempotent. */
  start(): void {
    if (this.detach) return;
    this.detach = this.daemon.onTerminalFrame((frame) => this.dispatch(frame));
  }

  /** Stop routing inbound frames (subscribers retained). */
  stop(): void {
    this.detach?.();
    this.detach = null;
  }

  /** Register (or replace) the subscriber for a slot. Returns an unsubscribe fn. */
  subscribeSlot(slot: number, subscriber: TerminalSlotSubscriber): () => void {
    this.subscribers.set(slot, subscriber);
    return () => {
      if (this.subscribers.get(slot) === subscriber) this.subscribers.delete(slot);
    };
  }

  /** True iff a subscriber is registered for the slot. */
  hasSlot(slot: number): boolean {
    return this.subscribers.has(slot);
  }

  // ─── Outbound ─────────────────────────────────────────────────────────────

  /** Send raw input bytes to a slot's PTY (opcode `Input = 0x02`). */
  sendInput(slot: number, data: Uint8Array): void {
    this.daemon.sendBinary(encodeTerminalFrame({ opcode: "Input", slot, data }));
  }

  /** Send a resize (opcode `Resize = 0x03`, JSON `{ rows, cols }` payload). */
  sendResize(slot: number, rows: number, cols: number): void {
    this.daemon.sendBinary(encodeTerminalFrame({ opcode: "Resize", slot, rows, cols }));
  }

  // ─── Inbound dispatch ───────────────────────────────────────────────────────

  private dispatch(frame: TerminalFrame): void {
    const subscriber = this.subscribers.get(frame.slot);
    if (!subscriber) return; // no subscriber for this slot — drop
    switch (frame.opcode) {
      case "Output":
        subscriber.onOutput?.(frame.data);
        return;
      case "Snapshot":
        subscriber.onSnapshot?.(frame.data);
        return;
      case "Restore":
        subscriber.onRestore?.(frame.data);
        return;
      default:
        // Input/Resize are outbound-only; ignore if echoed back.
        return;
    }
  }
}
