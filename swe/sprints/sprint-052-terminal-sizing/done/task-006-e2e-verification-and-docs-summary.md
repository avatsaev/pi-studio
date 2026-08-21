# Task 006 Summary — Live E2E proof of the size contract + docs sync

- **Sprint:** sprint-052-terminal-sizing
- **Status:** done — docs + automated gates complete; the live browser pass was **waived by the user
  on 2026-08-21** (§ Closure). Sprint-052 is closed.

## Closure (2026-08-21)

The live acceptance sequence recorded in § Verification below was never run and will not be: the user
waived it. Sprint-052's product code, tests and docs shipped in `d18187c` and are unchanged since —
`packages/web-client/src/features/terminal/` and `packages/server/src/terminal/` have had no commits
after that merge, so nothing has drifted away from what the automated gates proved.

What that means for anyone reading this later:

- The size contract is **automatically** verified only at the pure-logic and daemon layers
  (`terminal-size.test.ts`, `terminal-manager.test.ts`, `terminal-rpcs.test.ts`). The composed
  browser behaviour — ghost characters, wrap column, frame counts at rest, two-client hand-off — rests
  on the field-report confirmations recorded in Part 1, not on a systematic pass.
- `swe/features/terminals.md` § Acceptance Criteria keeps its size-ownership boxes unticked
  deliberately. They are unproven, not pending.
- The follow-ups in § Follow-ups recorded are unaffected and still live (sprint-053/task-007, the two
  CLI defects).

## Outcome

The three documentation defects are fixed, the docs are in sync with the code, and the automated gates
are green. The **live** acceptance sequence has not been run by the agent and is the one remaining
deliverable; it is being run by the user directly.

This task also absorbed a mid-sprint field-report cycle and a full review of the sprint's own work,
both of which changed product code. Those are recorded here because they are the substance of what
this task actually delivered.

## Part 1 — Field reports and the model rewrite

Live use during this task surfaced four symptoms the earlier tasks had not caught:

1. Splitting a pane with a **non-terminal** tab left the terminal at its old PTY size.
2. Reconnecting to an existing workspace initialised terminals at the wrong size.
3. Switching between two workspaces each holding a live terminal broke both.
4. Restored terminals never resized at all — and clicking only sometimes fixed it.

All four had one root cause, and it was in this sprint's own task-003 design: `lastClaimedRef`
conflated two different questions.

- `shouldClaimOnChange` hard-returned `false` when `lastClaimedRef === null`, and a **restored**
  terminal's PTY predates the client, so it is *always* `null`. Every divider drag and window resize
  on a restored terminal was therefore ignored for the panel's entire life.
- The eligibility gate additionally required the pane to be the workspace's **focused** pane. Splitting
  with another tab, switching workspaces, and session restore each move focus off a terminal that is
  still visibly rendering, so its real size went unreported. xterm refit locally either way, so the
  rendered grid and the PTY diverged — which is exactly the garbled text and patchy background colour
  reported.

Two intermediate patches (an "implicit focus claim" at attach, then a second at visibility) treated
symptoms and made the behaviour non-deterministic — hence "clicking doesn't always fix it". They were
both reverted in favour of the rewrite below.

### The rewrite

Permission and knowledge are now separate concerns:

- **`isSizeAuthority(tabId)`** — *permission*. Is this panel visibly rendering: active workspace, its
  pane's active tab? **Not** gated on pane focus or DOM focus. Focus is who receives keystrokes; it
  says nothing about whether a rendered grid is real.
- **`shouldClaimSize(next, believed)`** (`terminal-size.ts`) — *knowledge*. Validity plus dedupe
  against `believedSizeRef`. An unknown belief (`null`) counts as **differing**, because that is the
  normal state of a restored terminal whose PTY is still at its 80×24 spawn default.

Every `Resize` funnels through one seam (`claimSize`). `performRefit` reconciles after fitting, because
`fit()` emits no `onResize` when the grid is unchanged — a panel that measured 0×0 while hidden would
otherwise become visible and stay silent.

### Attach-time sizing (server change)

Reattaching to a full-screen app (htop, vim) still rendered scrambled, and no client-side fix could
work: `subscribe` emits the `Snapshot` **synchronously**, so the mangled bytes are already on the wire
before any client `Resize` could arrive. `SubscribeTerminalRequest` now carries the attaching client's
`cols`/`rows` and the daemon applies them before emitting the snapshot; the response echoes the PTY's
resulting size so a subscriber that sent nothing still learns what it attached to.

## Part 2 — Review findings, all fixed

A full review of the sprint's own output found 12 issues. All are fixed in this task.

| # | Issue | Fix |
|---|---|---|
| R1 | Binary `Resize` frame path was **completely unvalidated** — `NaN`/`0`/negative/`1e9` went straight into `node-pty` and the headless grid | `isValidGrid` at the manager choke point (integers, 2–1000 × 1–1000); every path funnels through it |
| R2 | Subscribe-time resize was unconditional despite a comment promising a dedupe | `manager.resize` no-ops a same-size request; handler now delegates instead of duplicating rules |
| R3 | Create echo trusted blindly, unlike the carefully-guarded subscribe echo | `isMeasurable` guard on both; an un-echoing daemon leaves belief `null`, not `{cols: undefined}` |
| R4 | Multi-client belief drift | Documented as a known limitation; **deferred to sprint-053/task-007** with a full task file |
| R5 | Pending-input queue bounded in *chunks* — one chunk is a whole paste | Bounded in **bytes** (`MAX_PENDING_INPUT_BYTES`, 64 KiB) with a running counter |
| R6 | Cleanup read `containerRef.current` at teardown | Container captured once at effect start; used for `open`, `observe`, and detach |
| P1 | Ring was O(64 KiB) **per output chunk, twice** — full `concat` copy *and* full escape-safe rescan, on the daemon's hottest path | Replaced with `SnapshotRing`: append memcpys only the new chunk behind a write cursor; compaction runs only on cap-crossing and reclaims to a 75% low-water mark |
| P2 | Unterminated escape sequence drops the whole snapshot | Documented; **deferred to sprint-053/task-007** |
| P3 | `manager.list().find()` per subscribe | Uses the existing `manager.get(slot)` |
| C1 | `isPaneFocusedTab` left behind as dead code, its doc comment still describing the withdrawn model | Deleted |
| C2 | `feature-panels-ui.md`'s binding contract still specified the **focus-claim model** — directly contradicting `terminals.md`, which now calls that a defect | Rewritten to the authority model; two other stale statements in the same section fixed |
| C5 | `proposeDimensions` + `isMeasurable` + claim inlined at three call sites | One `measureAndClaim()` helper |

`resize` also now applies to the PTY and screen model *before* mutating `entry`, so a throw cannot
leave `entry` reporting a size the terminal never got (it feeds `list()` and the subscribe echo).

## Part 3 — The three documented defects (the task's original scope)

1. **`packages/server/AGENTS.md` § Terminal subsystem** listed `resize_terminal` and "close terminal"
   RPCs. Neither exists. Rewritten: the full real handler list, resize is binary-only (`0x03`), close
   is `kill_terminal_request`. The same wrong claims in the source-layout tree (`:112-113`) are fixed.
2. **`ScreenBuffer` vs the 64 KiB ring** — docs claimed `ScreenBuffer` "retains the last ≤64 KiB of
   output as a snapshot for new subscribers". It does not: the ring is `ManagedTerminal.screen`
   (now `SnapshotRing`); `ScreenBuffer` is the `@xterm/headless` grid backing `capture()` only. Both
   are now documented separately, with the distinction stated explicitly.
3. **`TerminalPanel.tsx` "xterm renders to canvas"** — xterm 5.x defaults to the **DOM** renderer;
   canvas/WebGL are addons this app does not load. Comment corrected, and it now explains the actual
   reason an absolute px value is required (xterm measures a cell from its element's computed style).

## Docs synced

- `swe/features/terminals.md` — § PTY size ownership rewritten to the authority model,
  with the permission/knowledge conflation documented **as a defect** so it is not reintroduced; the
  trigger table gained an **Attach** row (subscribe payload, not a Resize frame); daemon-side size
  validation is now a stated MUST; ring-trim cost (hysteresis) is a stated requirement; multi-client
  belief drift recorded as a known limitation. Five new acceptance criteria cover the restored,
  background, split, workspace-switch and attach-reconcile cases.
- `swe/features/feature-panels-ui.md` — the contradicting contract block rewritten (C2);
  appearance requirements now cross-reference sprint-053 as their delivering sprint instead of reading
  as already-shipped.
- `packages/server/AGENTS.md` — Terminal subsystem rewritten (ring vs `ScreenBuffer`, amortization
  invariant, centralized size validation, real RPC list) + source-layout tree.
- `packages/web-client/AGENTS.md` — `terminal-size.ts` in the source layout; a "PTY sizing" invariant
  spelling out both NEVERs, the `measureAndClaim` seam, the echo guard, and the byte-bounded queue.

## Verification

**Automated — all green:**

| Gate | Result |
|---|---|
| `npm run build` | exit 0 (includes web-client's Vite + tsc step) |
| `npm run typecheck` | exit 0 (root) + `tsc -b` in `packages/web-client` (not covered by root) |
| `npm run lint` | exit 0, no new warnings in changed files |
| `oxfmt --check` on changed `.ts`/`.tsx` | clean |
| `npm test` | **1565 passed / 138 files** |
| `npx vitest run packages/server/src/terminal` | 54 passed |

New tests (+17 over the sprint's previous 1548):

- `resize validation` (12): rejects zero/negative/`NaN`/`Infinity`/fractional/absurd/below-floor
  without touching the PTY and without corrupting `entry`; applies a valid resize; same-size is a
  no-op; unknown slot rejected; invalid create-time grid falls back to 80×24.
- `snapshot ring` (2 new): stays within cap across many small appends while retaining the *newest*
  bytes; a single chunk larger than the cap replaces the ring wholesale.
- Binary-path regression (1): a malformed grid arriving as a binary `Resize` frame is rejected, does
  not throw out of the frame handler, and a well-formed frame on the same path still applies.
- `terminal-size.test.ts` rewritten for the unified `shouldClaimSize`, including an explicit
  restored-terminal case (the exact assertion the old `shouldClaimOnChange` got backwards).

**Live — partially done, remainder with the user.** During the field-report cycle the user confirmed
the reattach and split-with-another-tab fixes behave correctly. The full numbered acceptance sequence
in the task file has **not** been run since the model rewrite and the review fixes landed, so it is not
claimed here. The scope's size-ownership acceptance boxes are left unticked for that reason; only the
five items with automated coverage are ticked.

Remaining live checks (handed to the user):

1. Fresh `Ctrl+T` → `stty size` matches the rendered grid; `pi-studio terminal ls` agrees.
2. Long-command edit/recall → no ghost characters, no misplaced cursor.
3. Divider drag → exactly one `0x03` frame at rest, no ResizeObserver console warning.
4. Restored terminal + divider drag / window resize (the case that was permanently broken).
5. Split with a non-terminal tab; workspace switch both directions.
6. Background tab sends nothing while the layout around it changes.
7. Reattach to `less`/`htop` at a different width → correct from the first paint.
8. ≫64 KiB escape-heavy output then reload → coherent snapshot.
9. Two browsers at different widths → last-interacting wins.
10. Regression sweep: CLI create/kill/rename, `terminal capture`, chat/file/git panels.

## Follow-ups recorded

- **sprint-053/task-007** (new task file written): broadcast PTY size on resize to end multi-client
  belief drift (R4), and degrade the snapshot ring to the naive cut instead of dropping everything on
  an unterminated escape sequence (P2). Notes the collision with task-003's `terminals_update`
  listener so the two do not add parallel subscriptions.
- **CLI defects, unrelated to sizing** (from the original task notes, still unfixed and deliberately
  out of scope): `pi-studio terminal capture` renders `payload.text` while the daemon returns `screen`
  (prints an empty string), and `terminal ls` renders a `title` column while entries carry `name`.
  Both in `packages/cli/src/feature-commands.ts`.
- **Appearance/theme integration** — `TerminalPanel` still hardcodes its palette, mono stack and font
  size against `feature-panels-ui.md`'s requirement. That is sprint-053/task-001+002; the spec now
  says so explicitly rather than reading as shipped.

## Notes

The `manager.subscribe()` no-resize test was renamed and commented: the contract is **manager-level**
(`subscribe` never resizes as a side effect), while `subscribe_terminal_request` deliberately does
resize before calling it. The old name read as a blanket "attach never resizes", which is no longer
true at the RPC layer.

One process note worth recording: running `oxfmt` on `packages/**/AGENTS.md` mass-reformatted them
(reflowed tables, `*x*`→`_x_`, and **de-indented wrapped code spans**, which changes rendered content).
Markdown under `packages/**` is hand-maintained and was never oxfmt-clean at HEAD — the formatter is
for `.ts`/`.tsx` here. The churn was reverted and the intentional edits re-applied by hand.
