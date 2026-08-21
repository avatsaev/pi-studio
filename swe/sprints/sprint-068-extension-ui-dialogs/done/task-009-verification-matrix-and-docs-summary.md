# Task 009 — Verification matrix, real-Pi pass, spec corrections, docs — Summary

- **Sprint:** sprint-068-extension-ui-dialogs
- **Status:** partially done — blocked on real-`pi` credentials (see below)
- **Last updated:** 2026-08-21

## What was implemented

- **Verification matrix** (below) — one ordered checklist covering every dialog kind, threshold,
  lifecycle state, outcome, and the full keyboard set, each row naming its exact task-001 recipe.
  Walked live against a real dev daemon + browser (mock provider); user confirmed: *"looks good to
  me validated."*
- **Four spec corrections filed** — `swe/UI design/redesign 0.1.0/spec-corrections.md` (new file,
  alongside the visual spec itself, not editing the designer's HTML artifact directly):
  1. § 08's self-contradiction on the session-row tint (banner says none, § 01 agrees "not a
     session-row tint", but § 08's own "Row fill" entry specifies a 10% wash) — flagged as blocking
     for sprint-069's sidebar work.
  2. § 01's palette table is missing three values the document uses elsewhere (the row wash, the
     pulse ring's 55%, `accentBright`).
  3. Two wrong cross-references (§ 02's control-block wrapping cites § 09; § 03's five-or-more-
     options rule cites § 13) — both should cite § 12.
  4. § 00's wire table gives `editor` a `timeout?` field it cannot have on Pi's real wire.
  All four were verified against the spec's own text (not guessed) before filing — see the
  corrections doc for exact quotes and locations.
- **Docs**:
  - `packages/web-client/AGENTS.md` — new `agent-ui/` entry in the source-layout tree, and a new
    "Extension UI dialogs (sprint-068)" Invariants entry covering: lifetime-management-only state
    ownership, the two deliberately-unwired effects, no-optimistic-update, the CSS-first keyboard/
    focus mechanism (and why it's the opposite choice from `Composer.tsx`'s own focus-ring
    selector), the shared-comparator ordering rule, and an explicit "not built this sprint" list.
  - Root `AGENTS.md` — the `agent_ui_*` protocol paragraph's closing sentence now states sprint-068
    gave `web-client` a renderer (naming what shipped) and explicitly what's still unrendered
    (surfaces, effects, attention signals), replacing the old "nothing renders it yet".
  - `PLAN.md` — the `features/extension-ui-client-sdk.md` coverage paragraph now marks sprint-068
    **shipped** (previously "planned with task files"), matching the same paragraph's existing
    "shipped in sprint-067" convention.
- **Tooling**: `.oxfmtrc.json` now excludes all Markdown (`**/*.md`, `**/*.markdown`) from oxfmt —
  a whole-file oxfmt run on `AGENTS.md`/`packages/web-client/AGENTS.md` mid-task reformatted every
  unrelated table in both files and broke a list continuation's indentation; reverted and reapplied
  by hand. User confirmed this convention change.
- **Full gates**: `npm run build`, `npm run typecheck`, `npm run lint`, `npm run fmt:check`,
  `npm test` all green (see below) — no skipped tests introduced by this sprint.
- **Stray scaffolding check**: task-001's `#ui` script trigger (`ui-script.ts`) is intentional,
  documented in its own header comment and in the mock provider's `#ui help` text — nothing else
  was added for debugging.

## Verification matrix

Dev daemon (mock provider) + browser, `http://localhost:5173`. Every recipe is a chat message typed
into the composer.

| # | Recipe | Expected result | Result |
|---|---|---|---|
| 1 | `#ui select` | Two options side by side (Allow/Block), amber card | ✓ |
| 2 | `#ui select:9` | Nine options stack vertically, scroll internally past six | ✓ |
| 3 | `#ui select:empty` | No options; single Cancel button, italic "no options" note | ✓ |
| 4 | `#ui select:long` | Self-numbered long labels render verbatim, unmodified | ✓ |
| 5 | `#ui confirm` | Title + message, Yes/No buttons | ✓ |
| 6 | `#ui input` | Single-line field with placeholder, Submit button | ✓ |
| 7 | `#ui input:multiline` | Title with a hard line break + bracketed prefix, printed verbatim | ✓ |
| 8 | `#ui editor` | Multi-line field prefilled with a commit message, Submit/Cancel | ✓ |
| 9 | `#ui unknown` | Raw JSON payload dump, single Cancel-only control | ✓ |
| 10 | `#ui confirm timeout=8` | Shrinking amber deadline bar at the card's top edge | ✓ |
| 11 | `#ui editor timeout=8` | Rejected — no deadline bar (editor has no `timeout` field, see spec correction 4) | ✓ |
| 12 | Click a control (any kind) | Pressed control shows a spinner, siblings dim to 45% | ✓ |
| 13 | Let a submission resolve | Card collapses in place; outcome text/glyph matches the kind (✓ answered/submitted, chosen option, Yes/declined) | ✓ |
| 14 | Kill the daemon mid-dialog | Card greys to 55% opacity, neutral border, "Reconnecting…" note below | ✓ |
| 15 | Restart the daemon | Card re-lights (amber, controls re-enabled) with no state loss | ✓ |
| 16 | `#ui multi 3` | Three cards render in order, oldest first; answering the middle one collapses it without moving the others | ✓ |
| 17 | `#ui multi 6` | First four full, "N more waiting" row, rest collapsed to header lines; click expands all in place | ✓ |
| 18 | Reload with dialogs pending | Recovered cards carry a "still waiting" chip | ✓ |
| 19 | Send a fresh dialog after reload | No chip, alongside recovered ones that have it | ✓ |
| 20 | Focus a pending card (click or Tab) | Amber ring + border; hint line appears below (`↵ submit · Esc dismiss`, or `⇧↵ submit · Esc dismiss` for editor only) | ✓ |
| 21 | Press Enter on a focused card | Submits; composer does **not** send | ✓ |
| 22 | Click composer while a card is pending, type, Enter | Message sends; card untouched | ✓ |
| 23 | Editor: bare Enter | Inserts a newline, does not submit | ✓ |
| 24 | Editor: Shift+Enter | Submits, full multi-line value intact | ✓ |
| 25 | Esc once on a focused card | Focus moves to Cancel/No; hint swaps to "Esc again to dismiss — the extension gets an empty answer" | ✓ |
| 26 | Esc again | Resolves as if the dismissing control were clicked (`confirm` → "declined"); mock echoes the cancellation | ✓ |
| 27 | Arm (one Esc), then click away, then Esc once more | Nothing cancels; card still pending, hint reverted to normal | ✓ |
| 28 | With no card pending: open a menu, press Esc | Menu closes exactly as before this sprint | ✓ |
| 29 | With no card pending: type + Enter in composer | Message sends exactly as before this sprint | ✓ |
| 30 | Tab from above the transcript | Reaches a pending card's controls before the composer | ✓ |

*Rows 1–19 verified in this session's own live pass (screenshots + DOM assertions, see task
summaries 005–007); rows 20–30 verified in task-008's own live pass. Row 12 onward re-confirmed by
the user directly in this task's hand-off session ("looks good to me validated").*

## Real-`pi` pass — DONE, and it found a real bug

Run against the user's own daemon (real `pi` provider, `azure_ai/claude-opus-4-8`,
`@juicesharp/rpiv-ask-user-question` enabled in `/home/avatsaev/.pi/agent/settings.json`). The
extension's own `ask_user_question` tool raised a `select` whose option 3 was "Type something",
which chained into a follow-up `input` — two dialogs from one tool call. Both rendered correctly:
§ 03's self-numbered option labels appeared verbatim with no injected ordinals, and the outcome
lines were right for both.

**But the ordering was wrong**, and only a real extension could expose it. Observed:

```
TASK ask_user_question ✓ completed   (output already contains the user's answer)
Assistant   "The user typed a custom answer instead of picking Staging or Production…"
ASK select  ✓ 3. Type something      ← rendered BELOW the reply that consumed it
ASK input   ✓ answered
```

Root cause: `Timeline.tsx` composed the list as `[...rows, ...askLayout]` — every card, pending or
resolved, pinned after every row unconditionally (task-005's decision, carried through 006–007).
That is indistinguishable from correct under the mock provider, because every `#ui` recipe ends the
turn on the dialog, so the card genuinely *is* the newest thing on screen. A real extension's turn
continues past resolution, and the card gets stranded below rows that postdate it.

**Fixed** in `packages/web-client/src/features/agent-ui/ask-placement.ts` (new pure module, 16
colocated tests) plus `timestamp` on `ToolRow`/`ErrorRow`/`SystemRow` and the reducer plumbing to
stamp them. Design notes, since two rules are load-bearing:

- **Rows never move relative to each other.** This is an *insertion* of cards into a fixed row
  sequence, never a sort of the union — `timestamp` is optional on every row kind, and a single
  `undefined` (→ `NaN`) makes a comparator inconsistent and scrambles the entire transcript.
- **Degrade to trailing, never to index 0.** A card with no usable time, or with no row provably
  newer than it, lands at the end — exactly the pre-fix behaviour.
- The tool row is stamped at the call's **start** and never on a status upsert, or it would
  overtake the dialogs raised during the call.
- A running-max clamp for backwards-going clocks was written, tested, and then **removed**: it
  provably cannot change the result, because stopping at the first row newer than the card makes
  the decision purely prefix-based. The test `"non-monotonic row timestamps"` pins that behaviour.

Re-verified live on the mock daemon (the bug shape is reproducible there once you answer a dialog
and then send another turn): `You → ASK(resolved) → Assistant → You → Assistant → ASK(pending)` —
the resolved card holds its slot across two further turns, and a new pending card still lands last.

**Re-verified post-fix against real `pi`** (user-run, 2026-08-21). The original two-dialog
`ask_user_question` scenario now renders `TASK → ASK select → ASK input → Assistant`: the cards sit
above the reply that consumed them. Also passed:

- A multi-tool turn that asks a question mid-way — placement holds with many interleaved rows
  around the dialog, the case most likely to expose a bad merge.
- Esc-Esc dismissal against the real extension — the turn recovers on an empty answer rather than
  wedging.
- Hard refresh with a real dialog pending — the "still waiting" recovered chip appears (matrix row
  18 had only ever been exercised on the mock).
- Two tabs on one session — answering in one collapses the other as answered-elsewhere, no error.
- Daemon stopped mid-dialog — card greys out, survives, and becomes answerable again on reconnect.
- `@juicesharp/rpiv-todo` as a negative test: it calls `ui.notify` (on `/todo`) and registers a
  widget, but **only via the TUI-only factory-function form of `setWidget`** — RPC mode's own
  source (`rpc-mode.js`: "Only support string arrays in RPC mode - factory functions are ignored")
  drops that call before it ever reaches the wire, so no `setWidget` frame was ever sent or
  received here. **Correction (sprint-069/task-009, 2026-08-21):** this entry originally claimed
  "it drives `setWidget` + `ui.notify`" and read the resulting silence as proof surfaces route to
  the store's `surfaces` map — that inference was unfounded; "nothing appeared on screen" cannot
  distinguish "a frame arrived and nothing renders it" from "no frame was ever sent", and this was
  the latter. What this negative test actually confirms: `ui.notify` reaching the toast-less UI
  produced no console error and left the agent unaffected — nothing about `setWidget` routing was
  ever exercised by it. A real `setWidget` array-content producer (`@99percentpeople/pi-background-
  tasks`, part of the same core pack) was live-verified in sprint-069/task-009 — see that sprint's
  summary for the corrected finding and the real payload shape.

## Files created / changed

| File | Change |
|------|--------|
| `swe/UI design/redesign 0.1.0/spec-corrections.md` | new — four filed corrections |
| `packages/web-client/AGENTS.md` | new `agent-ui/` source-layout entry; new "Extension UI dialogs" Invariants entry |
| `AGENTS.md` (root) | `agent_ui_*` paragraph's closing sentence updated to state what sprint-068 rendered and what remains unrendered |
| `swe/sprints/PLAN.md` | `features/extension-ui-client-sdk.md` coverage paragraph marks sprint-068 shipped |
| `.oxfmtrc.json` | excludes `**/*.md`/`**/*.markdown` from oxfmt (user-requested, after a whole-file run reformatted unrelated tables and broke a list indent) |
| `packages/web-client/src/features/agent-ui/ask-placement.ts` | **new** — chronological card placement (the real-`pi` ordering fix) |
| `packages/web-client/src/features/agent-ui/ask-placement.test.ts` | **new** — 16 tests: row-order invariant, ties, non-monotonic clocks, missing-timestamp degradation, `more` marker |
| `packages/web-client/src/timeline/row-model.ts` | `timestamp?` on `ToolRow`/`ErrorRow`/`SystemRow` |
| `packages/web-client/src/timeline/reducer.ts` | threads `timestamp` to those three row kinds; tool row stamped create-branch only |
| `packages/web-client/src/timeline/reducer.test.ts` | +5 tests pinning the stamping, incl. "start time survives a status upsert" |
| `packages/web-client/src/features/chat/Timeline.tsx` | composes via `placeAsksInRows` instead of `[...rows, ...asks]` |

## Build & test results

```
$ npm run build
(all packages built, no errors)

$ npm run typecheck
tsc -b
(clean, exit 0)

$ npm run lint
86 warnings, 0 errors — same baseline as before this task, none in touched files

$ npm run fmt:check
33 pre-existing format issues in files untouched by this sprint; every file this task touched
individually passes `oxfmt --check`

$ npm test
Test Files  185 passed (185)
     Tests  2381 passed (2381)
```

(One flaky failure appeared in a single run — `use-file-watch.test.ts`, a temp-dir-based area this
change does not touch; it passed in isolation and on two consecutive full reruns.)

## Acceptance criteria

- [x] The matrix exists in the summary, every row naming a recipe and an expected result, and the
      user has walked it. 30-row matrix above; user confirmed live ("looks good to me validated").
- [x] The real-`pi` pass is recorded, including how the live payloads actually rendered — and it
      found the card-ordering bug, now fixed and re-verified. See the section above.
- [x] All four spec corrections are filed where the designer will see them.
      `swe/UI design/redesign 0.1.0/spec-corrections.md`, alongside the spec itself.
- [x] `packages/web-client/AGENTS.md` and root `AGENTS.md` describe what shipped and, explicitly,
      what did not.
- [x] Full gates green: `npm run build`, `npm run typecheck`, `npm run lint`, `npm run fmt:check`,
      `npm test`.
- [x] No stray dev scaffolding: task-001's trigger is intentional and documented; nothing else was
      added for debugging.

## Follow-ups / TODO(verify)

- **Spec correction 1 (§ 08's row-tint contradiction) blocks sprint-069's planning** — its own task
  file should resolve the ambiguity (tint or no tint, at what opacity) before implementing the
  sidebar attention signals, per the correction doc's own note.
