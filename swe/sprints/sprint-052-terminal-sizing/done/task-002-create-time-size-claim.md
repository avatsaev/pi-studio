# Task 002 — Create-time size claim: spawn the PTY at the client's measured grid

- **Sprint:** sprint-052-terminal-sizing
- **Status:** done
- **Type:** bugfix
- **Estimated size:** S
- **Depends on:** task-001

## Goal
Fill `CreateTerminalRequest.cols`/`.rows` from the creating panel's measured grid so a new PTY spawns
at the size it will actually be displayed at, and introduce the `lastClaimed` size bookkeeping that
task-003 and task-004 build on.

## This is the task that fixes the reported bug
After this task, `stty size` in a freshly opened terminal reports the rendered grid. Everything the
user reported — unused horizontal space, mangled long-command editing, ghost characters on
backspace, scrambled redraws, misaligned output — is the shell's line editor computing wraps and
cursor moves for 80 columns while ~140 are on screen.

## Background / why
`terminals.md` § PTY size ownership names three size-claim triggers; **create** is the first, and it
is deliberately not a `Resize` frame — the terminal does not exist yet, so nothing is being taken
from another client. The daemon side already supports it end to end and needs **no change**:
`packages/server/src/terminal/terminal-rpc.ts:53-54` forwards `cols`/`rows` from the request, and
`terminal-manager.ts:114-115,171` uses them for both the PTY spawn and the `ScreenBuffer` grid.
The web client simply never sends them (`TerminalPanel.tsx:127` posts only `workspaceId` and `cwd`).

The measurement seam is `FitAddon.proposeDimensions()`, which returns `undefined` when the panel is
not measurable — not laid out, or hidden under `display:none` (`FitAddon.ts:50-65`). That case is
normal and must degrade cleanly: omit both fields, let the PTY spawn at 80×24, and rely on the
focus trigger (task-003) once the user interacts — under the ownership gate, the visibility refit
of a panel that never claimed is deliberately silent. Never send a guessed or zero/NaN size.

## Scope references
- `clean-room-scope/features/terminals.md` § PTY size ownership (the **Create** row and its "cannot
  measure → omit both fields" clause), § Control RPCs (`CreateTerminalRequest`)
- `packages/web-client/src/features/terminal/TerminalPanel.tsx` (slot-creation effect, post-task-001)
- `packages/server/src/terminal/terminal-rpc.ts:47-58` (already forwards `cols`/`rows` — verify, do
  not modify)
- `packages/server/src/terminal/terminal-manager.ts:110-181` (spawn + `ScreenBuffer` sizing)
- `packages/client/src/terminal-stream-router.ts:63-65` (`sendResize(slot, rows, cols)` — note the
  **rows-before-cols** parameter order, opposite to `TerminalManager.resize(slot, cols, rows)`)

## What to build
- New pure module `packages/web-client/src/features/terminal/terminal-size.ts`, no DOM imports, so it
  is unit-testable under the repo's Node-only vitest environment:
  ```ts
  export interface Grid { cols: number; rows: number }
  /** A proposal is usable only if both dimensions are finite integers ≥ the emulator minimum. */
  export function isMeasurable(proposed: Partial<Grid> | undefined | null): proposed is Grid;
  export function sameGrid(a: Grid | null, b: Grid | null): boolean;
  /** Genuine-change trigger — fires only for a panel that already holds a claim.
   *  True iff `next` is measurable, `lastClaimed` is non-null, and the two differ. */
  export function shouldClaimOnChange(next: Grid | null, lastClaimed: Grid | null): boolean;
  /** Focus trigger — takes ownership. True iff `next` is measurable and differs from
   *  `lastClaimed` (`null` counts as differing). */
  export function shouldClaimOnFocus(next: Grid | null, lastClaimed: Grid | null): boolean;
  ```
  `isMeasurable` rejects `undefined`, `NaN`, `0`, negatives, and non-integers; the emulator minimum
  is `cols ≥ 2`, `rows ≥ 1` (`FitAddon.ts:22-23`). The two claim predicates encode
  `terminals.md` § PTY size ownership's ownership gate: a panel that has never claimed (did not
  create the PTY with a size, has not been focused since attach) must stay silent on its own
  refits — the mount-time and hidden→visible fits change the local grid without any user intent,
  and letting them claim would resize a PTY this client is only watching.
- New `packages/web-client/src/features/terminal/terminal-size.test.ts` covering every branch of the
  four functions, including `NaN`, `0`, fractional, negative, `null`, the equal-grid case, and the
  no-prior-claim case for each predicate.
- In `TerminalPanel.tsx`: read `fitAddonRef.current?.proposeDimensions()` **at request time** inside
  the create effect (never a cached value), relying on the emulator effect being declared before the
  create effect — effects in one commit run in declaration order, so the first `fit()` has already
  run when the request fires. When `isMeasurable`, include `cols`/`rows` in
  `create_terminal_request` and record that grid as `lastClaimedRef`. When not measurable, send the
  request without them and leave `lastClaimedRef` `null`.
- Reconcile against the response: `create_terminal_response.terminal` echoes the entry's actual
  `cols`/`rows`. Set `lastClaimedRef` from the echoed values, not the requested ones, so a daemon
  that clamped or defaulted differently does not leave this client believing it owns a size it does
  not. Widen the panel-local `CreateTerminalResponse` interface (`TerminalPanel.tsx:32-34`, today
  `{ terminal: { slot: number } }`) with the echoed `cols`/`rows` — the daemon already returns the
  full runtime entry (`terminal-rpc.ts:57`).
- The reattach path (a tab opened with a known `data.slot`, e.g. from `use-terminal-restore.ts`)
  sends **nothing** here — it did not create the terminal. It is task-003's focus trigger that lets
  it take ownership.

## Out of scope
- Any server-side change. If `cols`/`rows` do not reach the PTY, that is a bug to *find*, not a
  reason to add a new code path — the forwarding already exists.
- The focus trigger and the genuine-change trigger — task-003.
- Coalescing — task-004.

## Acceptance criteria
- [ ] `terminal-size.test.ts` covers `isMeasurable` (undefined/null/NaN/0/negative/fractional/
      below-minimum/valid), `sameGrid` (null pairs, one null, equal, differing on each axis),
      `shouldClaimOnChange` (unmeasurable → false, no prior claim → false, equal → false,
      differing with a prior claim → true), and `shouldClaimOnFocus` (unmeasurable → false,
      equal → false, differing → true, no prior claim → true).
- [ ] A terminal opened in a visible pane spawns at the measured grid: `stty size` inside the new
      shell prints the rendered rows/cols, and `pi-studio terminal ls` reports the same, not `80`/`24`.
- [ ] A terminal opened into a pane where it is **not** the visible tab spawns at 80×24 with no
      `cols`/`rows` in the request (unmeasurable → omitted, never guessed or zero).
- [ ] `lastClaimedRef` holds the daemon-echoed size after create, not the requested size.
- [ ] A reattaching panel (`data.slot` non-null on first render) sends no size on mount — verified in
      the browser devtools network/WS frame log: no binary `Resize` frame, and no `cols`/`rows` in
      any request.
- [ ] `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` pass.

## Test / verification plan
- Unit: `npx vitest run packages/web-client/src/features/terminal`.
- Build/typecheck/lint: `npm run build`, `npm run typecheck`, `npm run lint`.
- Manual, against `npm start`:
  1. `Ctrl+T`, then `stty size` → matches the visible grid. Confirm with `pi-studio terminal ls`.
  2. Maximise the window before opening a terminal, then open one → still matches (no stale
     measurement).
  3. Open a terminal in a split pane that is narrow → the spawned size matches that pane, not the
     window.
  4. `echo $COLUMNS` and a line of `printf '%.0s-' {1..200}` → wraps exactly at the rendered width.

## Notes
`sendResize(slot, rows, cols)` (client SDK) and `TerminalManager.resize(slot, cols, rows)` (daemon)
take their arguments in **opposite** order; the binary `Resize` payload is JSON `{ rows, cols }` so
the wire is unambiguous, but the two call sites are easy to transpose. `Grid` is deliberately
`{ cols, rows }` object-shaped everywhere in this module so no positional mistake is possible in the
new code.
