# Task 002 — Create-time size claim: spawn the PTY at the client's measured grid — Summary

- **Sprint:** sprint-052-terminal-sizing
- **Completed:** 2026-08-06
- **Status:** done

## What was implemented
- New pure module `terminal-size.ts`: `Grid`, `isMeasurable` (rejects non-numbers, `NaN`,
  non-integers, and below-minimum `cols < 2` / `rows < 1`, mirroring `@xterm/addon-fit`'s own
  `MINIMUM_COLS`/`MINIMUM_ROWS`), `sameGrid`, and the two ownership-gate predicates
  `shouldClaimOnChange` (requires a prior claim — task-003's genuine-change trigger) and
  `shouldClaimOnFocus` (takes ownership unconditionally — task-003's focus trigger). Both
  predicates are exported now even though only `isMeasurable` is consumed by this task, since
  task-003 depends on this module and the task description specified the full four-function
  surface as one unit.
- `TerminalPanel.tsx`'s slot-creation effect: reads `fitAddonRef.current?.proposeDimensions()` at
  request time (the emulator effect, declared earlier in the component, has already run its first
  `fit()` by the time this effect's body executes — same-commit declaration order). When
  measurable, includes `cols`/`rows` in `create_terminal_request` and — once the response
  resolves — records the **daemon-echoed** `cols`/`rows` (not the requested ones) into
  `lastClaimedRef`. When not measurable, sends the request without those fields and leaves
  `lastClaimedRef` `null`, so this client is still "never claimed" for the ownership gate and
  needs task-003's focus trigger to take over later.
- Widened the local `CreateTerminalResponse` interface to `{ terminal: { slot, cols, rows } }` —
  the daemon already returns the full runtime entry.
- No server-side change (confirmed by reading, not modified): `terminal-rpc.ts:53-54` already
  forwards `cols`/`rows`, `terminal-manager.ts:114-115` already applies them to the PTY spawn and
  the `ScreenBuffer`.

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/src/features/terminal/terminal-size.ts` | created |
| `packages/web-client/src/features/terminal/terminal-size.test.ts` | created — 21 tests |
| `packages/web-client/src/features/terminal/TerminalPanel.tsx` | modified — create-time claim, widened response type, `lastClaimedRef` |

## How it satisfies the scope
- `terminals.md` § PTY size ownership — **Create** row: measures at creation, spawns at the real
  grid, omits both fields (never a guessed/zero size) when unmeasurable.
- Encodes the ownership gate the scope review added to this same section: a client that could not
  measure at create time remains "never claimed" rather than being treated as having claimed the
  80×24 default it happened to receive.

No deviations. `shouldClaimOnChange`/`shouldClaimOnFocus` are unused by this task's own wiring
(task-003 consumes them) — flagged in the task file itself as intentional, not a leftover.

## Build & test results
```
$ npm run typecheck --workspace=@av-pi-studio/web-client   → clean
$ npx oxlint packages/web-client/src/features/terminal/    → no output (clean)
$ npx oxfmt --check packages/web-client/src/features/terminal/
    → 1 file needed formatting (terminal-size.test.ts); fixed with scoped `npx oxfmt <file>`,
      re-checked clean (no other files touched)
$ npx vitest run packages/web-client/src/features/terminal  → 21/21 passed (terminal-size.test.ts)
$ npm run build:web --workspace=@av-pi-studio/web-client    → ✓ built in 7.55s
$ npm run typecheck   (root, tsc -b)                        → exit 0
$ npm run lint        (root, oxlint)                        → exit 0, zero new warnings
$ npm test             (root, vitest)                        → 138 test files, 1541 tests passed
                                                                (+1 file / +21 tests vs task-001's
                                                                 baseline of 137/1520)
```

## Acceptance criteria
- [x] `terminal-size.test.ts` covers every branch listed (measurability incl. undefined/null/NaN/
      0/negative/fractional/below-minimum/valid; `sameGrid` null pairs and each differing axis;
      both claim predicates' no-prior-claim/equal/differing cases) — 21 tests, all passing.
- [x] A terminal opened in a visible pane spawns at the measured grid, not `80`/`24` — verified
      live against a real daemon + built web-client: a freshly created terminal (slot 2) spawned
      at `100×40` per `pi-studio terminal ls`, not the 80×24 default.
- [x] A terminal opened where it is not the visible tab spawns at 80×24 with no `cols`/`rows` in
      the request — verified by code inspection: `isMeasurable(undefined)` is `false` when
      `proposeDimensions()` returns `undefined` (unmeasurable/hidden case, per `FitAddon.ts:50-65`
      reviewed in task-001), so `grid` is `null` and the spread omits both fields entirely.
- [x] `lastClaimedRef` holds the daemon-echoed size, not the requested size — verified by code
      inspection: it is set from `res.terminal.cols`/`.rows` (the response), never from the local
      `grid` variable (the request).
- [x] A reattaching panel sends no size on mount — unaffected by this task: the slot-creation
      effect's early-return (`slotRef.current !== null`) still guards this exactly as before task-001;
      this task only changed what happens inside the branch that *does* create a terminal.
- [x] `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` pass — see above.

## Follow-ups / TODO(verify)
- None.
