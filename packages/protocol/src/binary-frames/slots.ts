/**
 * Slot/stream id allocation for the binary frame protocols (architecture/websocket-protocol.md
 * § Binary frames).
 *
 * Both binary framings — terminal (`[opcode][slot]`) and file transfer (`[opcode][stream]`) —
 * spend exactly ONE byte on the multiplexing id, so the id space is 0–255 and is a **reusable
 * pool, not a monotonic counter**. Every allocator that hands out these ids must therefore recycle
 * ids of finished transfers/terminals; a bare `next++` silently produces 256 after 255 hand-outs
 * and every subsequent `encode*Frame` call throws, killing the feature until the process restarts.
 *
 * Allocation walks forward from a caller-held cursor rather than always returning the lowest free
 * id: a just-released id is then the LAST one reused, which keeps a stale peer-side subscription
 * (a client that never unsubscribed from a closed terminal) from being re-pointed at a brand new
 * transfer the moment the old one ends.
 */

/** Size of the one-byte slot/stream id space shared by both binary frame protocols. */
export const SLOT_SPACE = 256;

/**
 * Lowest free id at or after `cursor` (wrapping), or `null` when all {@link SLOT_SPACE} ids are
 * live. `inUse` is anything keyed by slot id — a `Map` or `Set` of live transfers satisfies it.
 */
export function nextFreeSlot(inUse: { has(id: number): boolean }, cursor = 0): number | null {
  const start = ((cursor % SLOT_SPACE) + SLOT_SPACE) % SLOT_SPACE;
  for (let i = 0; i < SLOT_SPACE; i++) {
    const slot = (start + i) % SLOT_SPACE;
    if (!inUse.has(slot)) return slot;
  }
  return null;
}
