# Task 003 — Confirm dialog + "Fork from…" picker (one dialog, two steps) — Summary

- **Sprint:** sprint-072-conversation-fork-ui
- **Completed:** 2026-08-26
- **Status:** done

## What was implemented

The single fork dialog with its two steps, plus the second entry point:

- **`ForkDialog.tsx`** — one component rendering off `fork-store.ts`'s `dialog.status`:
  - `"confirm"`: shows the target's exact text (3-line clamp), the § 12 copy-deck body sentence,
    and a footer of `‹ Back` (only when `backTo !== null`) / `Cancel` / `Fork from here`↔`Forking…`.
    Outside-click and Escape are inert while `pending`.
  - `"picker"`: lists `forkMessages()` results chronologically with `#N` ordinals (2-line clamp
    each), or the "Nothing to fork yet" `EmptyState` when the list is empty. Selecting a row calls
    `selectFromPicker`, swapping to the confirm step with `backTo` set to the same list so `‹ Back`
    never re-fetches.
  - Mounted once in `TabPanelHost.tsx`, alongside `TabContextMenu` (same "one global overlay"
    precedent as `SessionContextMenu`).
- **`use-fork-action.ts`** extended with `useForkMenu(session)` — the "⋮" menu's entry point,
  always calling `openPicker` directly (never tries correlation), gated by the exact same
  `useCanFork` predicate the row affordance uses (both now delegate to one shared hook).
  `useCanFork`/`useForkMenu` were widened to accept `SessionEntry | undefined` so
  `SessionContextMenu` can call them unconditionally (rules-of-hooks) before its own
  `session`-may-be-undefined early return.
- **`SessionContextMenu.tsx`** — added a "Fork from…" `MenuItem` (GitFork icon) between "Stop
  agent" and the Archive/Delete separator, rendered only when `fork.canFork` (absent, not
  disabled, per the row affordance's same convention).
- **Single-flight guard hardened**: `handleConfirm` reads `useForkStore.getState()` at call time
  instead of the render-captured `dialog` value, so two `fork()` calls fired in the same
  synchronous burst (a fast double-click, before React re-renders the disabled button) still
  observe each other's `pending` flag and the second is a true no-op — not just "the DOM button
  happens to be disabled by the time React catches up."
- **`ForkDialog.module.css`** — confirm-step preview (accent-bordered, 3-line clamp), picker list/
  row/ordinal/empty styles, all built from the existing token ladder (no fictional tokens: e.g.
  the visual mock's literal `13px`/`40px`/`0.7` pixel/opacity values were mapped to the nearest
  real `--pi-spacing-*`/`--pi-font-size-*` rung, or left as a raw one-off value where the ladder
  has no discrete rung — mirroring `rows.module.css`'s own `userPendingRow { opacity: 0.6 }`
  precedent).
- **`fork-store.test.ts`** (new) — 10 store-level tests covering the two-step transition
  (`openPicker` → `selectFromPicker` → `backToPicker`), `openConfirm`'s direct path (`backTo:
  null`), `setPending`'s scoping to the confirm step, and every documented no-op case.

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/features/chat/ForkDialog.tsx` | created |
| `packages/web-client/src/features/chat/ForkDialog.module.css` | created |
| `packages/web-client/src/stores/fork-store.test.ts` | created (10 tests) |
| `packages/web-client/src/features/chat/use-fork-action.ts` | modified — added `useForkMenu`, widened `useCanFork`'s param to `SessionEntry \| undefined` |
| `packages/web-client/src/features/sessions/SessionContextMenu.tsx` | modified — wired the "Fork from…" menu item |
| `packages/web-client/src/features/workspace/TabPanelHost.tsx` | modified — mounted `<ForkDialog />` |
| `packages/web-client/AGENTS.md` | modified — conversation-fork invariant section extended for task-003 |
| `swe/features/conversation-fork.md` | modified — ticked 2 top-level acceptance criteria |

## How it satisfies the scope

Maps directly to `swe/features/conversation-fork.md` § web-client "Fork from…" picker and the
visual spec's § 05/§ 06/§ 07 ("one dialog, two steps" — implemented as one component switching on
`dialog.status`, never two overlays). § 12's copy deck strings (title, body, button labels, menu
item, picker title/empty) are reproduced verbatim in `ForkDialog.tsx`/`SessionContextMenu.tsx`; no
paraphrase was introduced (the task file's own prose paraphrase — "Fork the conversation from this
message?" — is NOT in § 12's actual copy-deck cell and was correctly omitted). The gating reuse
requirement ("reuse that predicate, do not re-derive it") is satisfied structurally: `useForkMenu`
calls `useCanFork`, the identical hook `useForkAction` already used in task-002.

Deviations: two § 13 edge cases (mid-dialog concurrent turn start from another client; image-only
message preview placeholder) are explicitly out of this task's 8 acceptance criteria and were left
unhandled — documented in the task file's Notes rather than silently dropped.

## Build & test results

```
$ npm run build
✓ all packages built (protocol, highlight, relay, client, server, cli, web-client, desktop)

$ npx tsc -b --force
(no output — clean)

$ npm run lint
(warnings only, all pre-existing/unrelated to this task's files — exit 0)

$ npm run fmt:check
30 pre-existing failing files (all unrelated to this task's files, confirmed via `git diff --stat`
showing zero changes to any of them) — matches the project's documented pre-existing fmt debt.

$ npx vitest run packages/web-client
Test Files  93 passed (93)
     Tests  1269 passed (1269)   # was 1259 before this task; +10 new (fork-store.test.ts)

$ npm test   (full monorepo)
Test Files  201 passed (201)
     Tests  2656 passed (2656)
```

## Acceptance criteria

- [x] The confirm step always displays the exact text of the entry that will be forked from —
      `<div>{target.text}</div>`; live-verified against a real dev daemon + mock provider (the
      preview showed "mock first prompt" verbatim).
- [x] Confirming issues `fork(entryId)` exactly once even if the confirm control is activated
      repeatedly while pending — guarded via `useForkStore.getState()` read at call time (not the
      render closure), verified by store-level reasoning; buttons disable (`disabled={pending}`)
      and `Button`'s `loading` spinner shows.
- [x] The picker lists the active branch's user messages chronologically with `#N` ordinals —
      verified live (`#1 mock first prompt`) and by `fork-store.test.ts`.
- [x] An empty picker shows the disabled "Nothing to fork yet" `EmptyState` rather than an empty
      dialog.
- [x] Selecting a picker row swaps to the confirm step for that entry, carrying `backTo` — verified
      live and by `fork-store.test.ts`'s `selectFromPicker`/`backToPicker` tests.
- [x] The picker opens both from the ⋮ menu and as task-002's correlation fallback, via the same
      `openPicker` store action — verified live for both entry points.
- [x] The ⋮ menu item is gated by the same predicate as the row affordance — both call `useCanFork`.
- [x] All user-visible strings match § 12's copy deck verbatim — cross-checked every row of the
      copy table against the shipped strings.

## Follow-ups / TODO(verify)

- § 13 edge case "Turn starts while the dialog is open" (another client's turn, not this session's
  own gate) is unhandled — a later task's scope if the multi-client convergence work surfaces it.
- § 13 edge case "Message is only an image, no text" — preview would render blank rather than the
  spec's "(image only)" placeholder; the protocol payload has no image indicator to detect this
  case from today. Needs a real `pi` session with an image-only forked entry to confirm the actual
  `text` value the daemon returns before deciding whether this needs a client-side fallback or a
  payload change.
- Result handling after `fork()` resolves (composer prefill, success/error toasts, sidebar entry
  for the new branch) is explicitly task-004's scope, per this task's "Out of scope" section.
