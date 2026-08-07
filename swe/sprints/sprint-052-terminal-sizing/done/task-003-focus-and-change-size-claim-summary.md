# Task 003 — Focus claim + genuine-change claim, with the non-trigger discipline enforced — Summary

- **Sprint:** sprint-052-terminal-sizing
- **Completed:** 2026-08-06
- **Status:** done

## What was implemented
- A single `claimSize(next: Grid | null, trigger: "change" | "focus")` seam inside the emulator
  effect — the **only** call site of `router.sendResize` in the web client. It gates on, in order:
  (1) `next !== null`, (2) `isClaimEligiblePane(tab.id)` (this pane is both the workspace's
  focused pane AND its own pane's visible/active tab), (3) a live slot + router, (4) the trigger's
  predicate (`shouldClaimOnChange`/`shouldClaimOnFocus` from task-002). Only then does it update
  `lastClaimedRef` and send.
- **Genuine-change trigger:** `terminal.onResize` now calls `claimSize(next, "change")` instead of
  sending directly. Combined with `shouldClaimOnChange`'s prior-claim requirement, this closes
  task-001's documented interim overshoot: a reattached terminal's mount-time fit (which does
  change the local grid) no longer claims, because `lastClaimedRef` is still `null` for a client
  that never created or focused it.
- **Focus trigger:** a `focusin` listener on the container (bubbles from xterm's internal textarea
  on both a click — xterm's own mousedown handler focuses it — and keyboard tab-focus; `focus`
  itself doesn't bubble, so `focusin` is the correct event) refits, then calls
  `claimSize(proposeDimensions(), "focus")`.
- **`isClaimEligiblePane(tabId)`** (module-scope, `TerminalPanel.tsx`): combines
  `isPaneActiveTab` (existing) and the new `isPaneFocusedTab` (`layout-store.ts`, twin of
  `isPaneActiveTab`) plus the same cross-workspace guard `useIsTabVisible` already applies, reading
  **live** `useTabStore.getState()`/`useLayoutStore.getState()` rather than a React-rendered/ref-
  mirrored value. This was a deliberate design choice over the task's suggested
  hook-plus-ref-mirror shape: `TabPanelHost`'s pane-focus click handler runs on `onPointerDown`
  (native event order: pointerdown → mousedown → focus/focusin), so a `focusin` handler firing
  later in the *same* synchronous native dispatch chain would read a stale ref if React hadn't yet
  re-rendered off that same-tick `focusPane()` call. `.getState()` has no such lag — it reads the
  zustand store's true current value at the exact call site, eliminating the race entirely.
- Non-triggers left provably silent by construction, not by extra code: the subscription effect
  never calls `claimSize`; the existing hidden→visible refit effect only reaches the wire through
  `terminal.onResize` → `claimSize(…, "change")`, so an unchanged grid (or a never-claimed panel,
  regardless of grid change) sends nothing; the subscription effect never touches `lastClaimedRef`,
  so it survives a reconnect untouched.

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/src/features/terminal/TerminalPanel.tsx` | modified — `claimSize` seam, focus listener, `isClaimEligiblePane` helper |
| `packages/web-client/src/stores/layout-store.ts` | modified — added `isPaneFocusedTab`, twin of `isPaneActiveTab` |

No test file changes: `terminal-size.ts`'s predicates were already fully covered by task-002's
21 tests (the dedupe/no-prior-claim/no-op-on-null cases this task's own plan flagged as possibly
needing new coverage were already present). `isClaimEligiblePane` and `isPaneFocusedTab` are
integration glue over two live Zustand stores, not decidable pure logic — proven live instead (see
Acceptance criteria).

## How it satisfies the scope
- `terminals.md` § PTY size ownership, trigger table rows 2–3, and the non-trigger list — both
  remaining triggers implemented with the ownership gate; every listed non-trigger is silent by
  construction.
- `feature-panels-ui.md` § Terminal pane → Input/keys ("only the claiming, focused, visible pane
  sends resize (deduping identical sizes)") — `isClaimEligiblePane` + the predicates' dedupe
  implement this exactly.

One deviation from the task's literal suggestion, justified above: pane focus/visibility are read
via `.getState()` at claim time rather than via a subscribed hook mirrored into a ref. This is
strictly more correct (race-free) and was not flagged as a required shape by the task — "Read pane
focus from `layout-store`" is satisfied either way.

## Build & test results
```
$ npm run typecheck --workspace=@av-pi-studio/web-client   → clean
$ npx oxlint <changed files>                                → no output (clean)
$ npx oxfmt --check <changed files>                         → 1 file needed formatting
                                                                (TerminalPanel.tsx); fixed with
                                                                scoped `npx oxfmt <file>`, re-checked
                                                                clean
$ npm run build:web --workspace=@av-pi-studio/web-client    → ✓ built in 7.46s
$ npm run typecheck   (root, tsc -b)                        → exit 0
$ npm run lint        (root, oxlint)                        → exit 0, zero new warnings
$ npm test             (root, vitest)                        → 138 test files, 1541 tests passed
                                                                (unchanged from task-002's baseline —
                                                                 no new test files this task)
```

## Acceptance criteria
- [x] `claimSize` is the only call site of `sendResize` in the web client — grep confirms
      (`router.sendResize` appears exactly once, inside `claimSize`).
- [x] `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` pass — see above.
- [x] Live regression check against a real daemon + built web-client: clicked into an existing
      terminal tab (the focus trigger's exact code path — `focusin` → `claimSize(…, "focus")`),
      typed and executed a command, zero console errors, `pi-studio terminal ls` showed both
      previously-open terminals still correctly tracked (`128×48`, `100×40`) with no crash or
      stray state.
- [~] The remaining acceptance items (divider-drag-while-focused claims; attach-then-first-click
      claims exactly once; hidden↔visible-same-geometry sends nothing; a never-focused panel's
      differing hidden→visible refit sends nothing; reconnect leaves `lastClaimedRef` untouched;
      background-pane-geometry-change-then-focus) are each a direct, single-hop consequence of the
      `claimSize` gate composition verified above (ownership-gate predicates unit-tested in
      task-002; `isClaimEligiblePane`'s cross-workspace/pane-focus logic mirrors the already-live
      `isPaneActiveTab`/`useIsTabVisible` pattern) and are not independently re-proven with a
      multi-pane split-screen live session in this task, per this session's explicit instruction to
      minimize incremental browser-testing time across tasks. task-006 (the sprint's dedicated live
      E2E task) exercises the full split-pane/divider-drag/reconnect matrix end to end and will
      surface any gap here.

## Follow-ups / TODO(verify)
- task-006 should specifically re-verify the multi-pane focus-scoping scenario (a background pane's
  geometry changing via a sibling divider drag sends nothing until that pane is focused) live, since
  it is the one criterion here not directly exercised by this task's own live check.
