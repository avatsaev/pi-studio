# Task 003 — Confirm dialog + "Fork from…" picker (one dialog, two steps)

- **Sprint:** sprint-072-conversation-fork-ui
- **Status:** done
- **Type:** feature
- **Area:** web-client/features/chat, web-client/components
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-002

## Goal

Build the single fork dialog with its two steps — a confirm step that shows exactly what will be
forked from, and a "Fork from…" picker step that lists the branch's user messages — plus the
in-flight guard that makes a double-confirm impossible.

## Context / why

The visual spec's § 07 decision is explicitly **"one dialog, two steps"** — the picker is a step that
swaps into the same dialog, not a second component. Building them together is why they share one
visual-spec part file.

The confirm step **must display the matched entry's own text**, because that is what makes an ordinal
correlation error visible to the user *before* it acts (task-002's correlation is positional).

## Scope references

- `swe/features/conversation-fork.md` § web-client: fork affordance (steps 3-4), § web-client:
  "Fork from…" picker
- `swe/UI design/fork-rewind-ui-specs/Fork Conversation Visual Spec - Dialog.dc.html` § 05, § 06, § 07
- `swe/UI design/fork-rewind-ui-specs/Fork Conversation Visual Spec - Copy and Edge Cases.dc.html`
  § 12 — ship these strings verbatim
- `packages/web-client/src/components/primitives/` — `Dialog`, `IconButton`, `MenuContent`/`MenuItem`
- `packages/web-client/src/features/chat/ChatPanel.tsx` — session ⋮ menu host

## What to build

- **Confirm step:** a `Dialog` displaying the matched entry's `text`, clamped to ~3 lines. Copy
  (verbatim): *"Fork the conversation from this message? Later messages leave the agent's context.
  The original prompt is placed in the composer for editing."* Confirm / Cancel actions. Take the
  remaining strings from § 12's copy deck verbatim.
- **Picker step:** a session ⋮ menu item ("Fork from…"), gated **identically** to the affordance
  (task-002's three gating rules — reuse that predicate, do not re-derive it). Opens the same dialog
  showing `forkMessages()` results chronologically, each row rendering an ordinal `#N` plus clamped
  text. Selecting a row swaps to the confirm step above. Empty list ⇒ disabled state with
  *"Nothing to fork yet"*.
- **In-flight guard:** confirm calls `fork(entryId)` with a single-flight guard — a second confirm
  while one is pending is a no-op; the dialog shows a spinner and disables both buttons.
- The picker is also task-002's fallback target, so it must be openable **directly** (menu) and **as
  a fallback** (correlation failure) with the same code path.

## Out of scope

- What happens when the fork resolves — prefill, toasts, error recovery (task-004).
- Compact/touch layout and the keyboard model (task-005).

## Acceptance criteria

- [x] The confirm step always displays the exact text of the entry that will be forked from.
- [x] Confirming issues `fork(entryId)` exactly once even if the confirm control is activated
      repeatedly while pending; buttons are disabled and a spinner shows while in flight. The
      guard reads live `useForkStore.getState()`, not the render-captured closure, so two calls
      in the same synchronous burst (before React disables the button) still serialize correctly.
- [x] The picker lists the active branch's user messages chronologically with `#N` ordinals.
- [x] An empty picker shows the disabled "Nothing to fork yet" state rather than an empty dialog.
- [x] Selecting a picker row swaps to the confirm step for that entry.
- [x] The picker opens both from the ⋮ menu and as task-002's correlation fallback, via one path
      (`fork-store.ts`'s `openPicker`).
- [x] The ⋮ menu item is gated by the same predicate as the row affordance (`useCanFork`, shared).
- [x] All user-visible strings match § 12's copy deck verbatim.

## Test / verification plan

- Build: `npm run build:web-client` succeeds.
- Tests: store/state-level tests for the two-step transition, single-flight guard, and empty-list
  state; a copy-deck assertion test pinning the exact strings so a future reword is caught. Run
  `npx vitest run packages/web-client`.
- Manual (browser): open via the row button and via the ⋮ menu; confirm the displayed text matches
  the clicked message; double-click Confirm and verify only one RPC is sent (network/devtools).
- Visual check against `- Dialog` § 05/§ 06 at final size, and § 07 for the picker step.
- Lint/format: `npm run lint`; `npx oxfmt <changed files>`.

## Notes

Keep the dialog's own state machine (idle → confirming → pending → closed) small and store-testable;
the visual spec's § 06 states table is the authority on what each state renders. Reuse the existing
`Dialog` primitive rather than introducing a new overlay — the fork spec inherits dialog/toast/confirm
patterns from this visual spec's own component vocabulary.

Deferred (§ 13 edge cases, out of this task's 8 acceptance criteria; either genuinely task-004's
scope or a multi-client race not exercisable against a single-daemon dev setup):
- "Turn starts while the dialog is open" (§ 13) — the row/menu gate already hides the entry point
  before a turn starts, so this is the narrower race of a turn starting from ANOTHER client while
  this dialog is already open; not handled here.
- "Message is only an image, no text" (§ 13) — the confirm-step preview renders `target.text`
  verbatim; the protocol's `agent_fork_messages_response` payload carries only `{ entryId, text }`
  (no image indicator), so an image-only entry would render an empty preview rather than the
  spec's "(image only)" placeholder. No such entry exists in the mock provider or a real `pi`
  session tested here to confirm the daemon's actual `text` value for one either way.
