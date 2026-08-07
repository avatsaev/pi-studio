/**
 * Terminal PTY size-claim decisions (`swe/features/terminals.md` § PTY size
 * ownership). Pure and DOM-free so the ownership gate is unit-testable under the repo's Node-only
 * vitest environment — `TerminalPanel.tsx` is the only caller.
 *
 * The model separates two things an earlier revision conflated into one `lastClaimed` ref, which is
 * what made restored terminals unfixable-by-resize:
 *
 * - **Knowledge** — `believed`: the grid this client thinks the PTY currently has (from a
 *   create-time echo, or from the last size it successfully sent). Only ever used to dedupe.
 * - **Permission** — `isSizeAuthority` in `TerminalPanel.tsx`: whether this panel is the one
 *   rendering the terminal in the foreground right now.
 *
 * Conflating them meant "I have never sent a size" (`believed === null`, always true for a
 * *restored* terminal, whose PTY predates this client) was read as "I am not allowed to send one",
 * so a restored terminal ignored every divider drag and window resize forever.
 */

export interface Grid {
  cols: number;
  rows: number;
}

// Mirrors `@xterm/addon-fit`'s own `MINIMUM_COLS`/`MINIMUM_ROWS` (`FitAddon.ts:22-23`) — a grid
// below this is not a real proposal, it is what `proposeDimensions()` returns while the panel is
// still settling.
const MIN_COLS = 2;
const MIN_ROWS = 1;

/** A proposal is usable only if both dimensions are finite integers ≥ the emulator minimum. */
export function isMeasurable(proposed: Partial<Grid> | undefined | null): proposed is Grid {
  if (proposed == null) return false;
  const { cols, rows } = proposed;
  return (
    typeof cols === "number" &&
    Number.isInteger(cols) &&
    cols >= MIN_COLS &&
    typeof rows === "number" &&
    Number.isInteger(rows) &&
    rows >= MIN_ROWS
  );
}

export function sameGrid(a: Grid | null, b: Grid | null): boolean {
  if (a === null || b === null) return a === b;
  return a.cols === b.cols && a.rows === b.rows;
}

/**
 * Whether a measured grid is worth sending as a Resize frame, given what this client believes the
 * PTY's grid already is. Pure dedupe + validity: it answers "would this frame change anything?",
 * never "am I allowed to send it?" — permission is the caller's `isSizeAuthority` gate.
 *
 * `believed === null` (a restored terminal, whose PTY this client never sized) counts as differing:
 * an unknown remote size is exactly the case that most needs reconciling, since the PTY is
 * typically still at the 80×24 spawn default while the panel renders far wider.
 */
export function shouldClaimSize(next: Grid | null, believed: Grid | null): next is Grid {
  if (!isMeasurable(next)) return false;
  return !sameGrid(next, believed);
}
