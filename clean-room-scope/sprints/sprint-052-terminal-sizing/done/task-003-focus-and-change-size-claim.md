# Task 003 — Focus claim + genuine-change claim, with the non-trigger discipline enforced

- **Sprint:** sprint-052-terminal-sizing
- **Status:** done
- **Type:** bugfix
- **Estimated size:** S
- **Depends on:** task-002

## Goal
Implement the two remaining size-claim triggers from `terminals.md` § PTY size ownership — **genuine
viewport change** and **focus/tap** — deduped against the last claimed size, and make the explicit
non-triggers provably silent.

## Background / why
The scope's size-ownership rule has two halves and the implementation has never had either:

> A client claims PTY size **only** when its viewport genuinely changes size **or the user
> focuses/taps the terminal.**

The genuine-change half is *almost* free after task-001 (with `onResize` attached before the first
`fit()`, a real dimension change now reaches `sendResize`), but it needs the dedupe so an
`onResize` triggered by a refit that lands on the same numbers is not sent — and
`feature-panels-ui.md` § Terminal pane → Input/keys states the dedupe as a requirement
("deduping identical sizes").

The focus half has never existed at all, and it is what makes **reattach** correct. A terminal
created by `pi-studio terminal create` (80×24), or one whose size another connected client last
claimed, is attached by this client passively — and attach must not resize, by rule. Without a focus
trigger the mismatch persists until the user happens to drag a divider, which is exactly the class of
"terminal looks broken" the user reported. Focus is the moment this client stops being a passive
observer and becomes the interacting one, so it is the correct, spec-sanctioned moment to claim.

## Scope references
- `clean-room-scope/features/terminals.md` § PTY size ownership (trigger table rows 2 and 3; the
  explicit non-trigger list)
- `clean-room-scope/features/feature-panels-ui.md` § Terminal pane → Input/keys ("only the claiming,
  focused, visible pane sends resize (deduping identical sizes)"), § Reconnect/restore ("on
  focus/visibility change … force a fresh resize")
- `packages/web-client/src/features/terminal/TerminalPanel.tsx`
- `packages/web-client/src/features/terminal/terminal-size.ts` (`shouldClaimOnChange` /
  `shouldClaimOnFocus`, from task-002)
- `packages/web-client/src/stores/tab-store.ts` (`useIsTabVisible`)
- `packages/web-client/src/stores/layout-store.ts` (`focusedPaneId` — the pane-level notion of focus)

## What to build
- A single `claimSize(next: Grid | null, trigger: "change" | "focus")` seam in `TerminalPanel` that
  is the **only** place a `Resize` frame originates. It sends
  `router.sendResize(slot, next.rows, next.cols)` and updates `lastClaimedRef` iff the trigger's
  predicate passes — `shouldClaimOnChange` for `"change"`, `shouldClaimOnFocus` for `"focus"`
  (task-002's module); otherwise it does nothing.
- **Genuine change:** `terminal.onResize` → `claimSize(next, "change")`. Because `FitAddon.fit()`
  only resizes on an actual change and `claimSize` dedupes again, a refit that lands on the same
  grid is doubly silent — and because the change predicate also requires a prior claim, the
  mount-time fit of a reattached terminal and the hidden→visible refit of a never-focused panel are
  silent even though their dimensions differ. This removes task-001's known interim overshoot
  (claim-on-reattach).
- **Focus/tap:** on the emulator gaining focus (xterm's own focus event, or a `focusin`/pointerdown
  on the panel container — pick the one that fires for both keyboard focus and a click), refit and
  then `claimSize(proposeDimensions(), "focus")`. This is the reattach fix: the first interaction with a
  differently-sized PTY corrects it.
- **Non-triggers stay silent** — assert this by construction, not by hoping:
  - the subscription effect must not call `claimSize`;
  - the hidden→visible effect refits but only reaches the wire through `claimSize(…, "change")`, so
    an unchanged grid sends nothing — and a never-claimed panel sends nothing even on a changed grid;
  - a reconnect (new `client`) re-subscribes without claiming. `lastClaimedRef` must **not** be reset
    on reconnect, or every reconnect would re-claim and two clients would ping-pong sizes.
- Scope the claim to the focused, visible pane as the spec says: a background pane whose geometry
  changes (another pane's divider drag reflowing the tree) refits its emulator but does not claim.
  Read pane focus from `layout-store`, not from DOM focus, and combine with
  `useIsTabVisible(tab.id)`.

## Out of scope
- Coalescing the burst of `onResize` events during a drag — task-004. (Correctness first: after this
  task the right sizes are claimed, just possibly too many times mid-drag.)
- Font-size-driven refits — sprint-053 (no runtime font change reaches the terminal yet).
- Any server-side change.

## Acceptance criteria
- [ ] Dragging the focused terminal pane's divider changes the PTY size: `stty size` after the drag
      matches the new grid. (A divider drag does not itself move pane focus — the pane must already
      be focused; an unfocused pane is the background-pane criterion below.)
- [ ] Attaching to an existing differently-sized terminal sends **no** `Resize` on mount, and the
      first click/focus on it does send exactly one, after which `stty size` matches.
- [ ] Switching a tab away and back (hidden→visible, same geometry) sends **no** `Resize`.
- [ ] A passively attached, never-focused terminal whose hidden→visible refit yields a **different**
      grid still sends **no** `Resize`; focusing it then claims once.
- [ ] A reconnect sends no `Resize`, and `lastClaimedRef` survives it.
- [ ] A background, non-focused pane whose geometry changes refits but sends no `Resize`; focusing it
      then claims.
- [ ] `claimSize` is the only call site of `sendResize` in the web client — grep confirms.
- [ ] `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` pass.

## Test / verification plan
- Unit: extend `terminal-size.test.ts` if the dedupe rule gains any case (e.g. a claim attempt with a
  `null` proposal must be a no-op, never a thrown error).
- Build/typecheck/lint/tests: `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`.
- Manual, against `npm start`, watching binary WS frames in devtools:
  1. `pi-studio terminal create --cwd <repo>` from a shell, reload the browser so restore reattaches
     it → no `Resize` on attach; `stty size` still `24 80`; click into it → one `Resize`; `stty size`
     now matches the pane.
  2. Divider drag with the terminal pane focused → size tracks; with focus elsewhere → no frame
     until the terminal pane is focused, then one claim.
  3. Tab away/back → zero frames.
  4. Split so the terminal is in a background pane, drag the *other* pane's divider → no frame until
     the terminal pane is focused.
  5. Two browser windows on the same daemon at different widths, same terminal: whichever was
     interacted with last owns the size; the passive one never steals it back on its own.

## Notes
Focus events fire on tab switches inside the app too. That is fine and even desirable — the dedupe
makes a focus with an unchanged grid free. What must not happen is a claim from a pane that is not
visible, which is why pane focus + visibility are both consulted rather than DOM focus alone.
