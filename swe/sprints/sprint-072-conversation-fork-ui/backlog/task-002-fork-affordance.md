# Task 002 — Fork affordance on user rows + ordinal correlation

- **Sprint:** sprint-072-conversation-fork-ui
- **Status:** backlog
- **Type:** feature
- **Area:** web-client/features/chat, web-client/timeline
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal

Put a hover-revealed fork button on confirmed user-message rows, and correlate the clicked row to a
Pi `entryId` safely enough that a mismatch can never fork the wrong message.

## Context / why

**Timeline user rows and Pi entry ids live in disjoint id spaces.** Live `user_message` events carry
`messageId` = the client-minted `clientMessageId` echo (`row-model.ts`); Pi's `entryId` is its own
JSONL entry id. Nothing correlates them today. So correlation is **positional**: the clicked row's
index among the transcript's confirmed user rows equals the index into `get_fork_messages`' result —
both enumerate the active branch's user messages chronologically. Ids are never used.

Because positional correlation can in principle drift, it is **verified by text** before acting, and
any mismatch degrades to the picker rather than forking something unverified.

## Scope references

- `swe/features/conversation-fork.md` § web-client: fork affordance (user-message rows), § Ground
  truth (disjoint id spaces)
- `swe/UI design/fork-rewind-ui-specs/Fork Conversation Visual Spec - Affordance.dc.html` § 02, § 03
- `swe/UI design/fork-rewind-ui-specs/Fork Conversation Visual Spec - Tokens.dc.html` § 01
- `packages/web-client/src/features/chat/Timeline.tsx` — row rendering
- `packages/web-client/src/timeline/row-model.ts` — user row shape, `pending`/`failed` states
- `packages/web-client/src/features/provider-auth/ModelProvidersPanel.module.css` `.rowActions` — the
  reserved-box row-action pattern (sprint-062) to reuse

## What to build

- A hover-revealed `IconButton` (xs, lucide `GitFork`) on user rows, using the established
  reserved-box + opacity-on-row-hover pattern so row height never shifts on hover.
- **Render only on confirmed user rows** — never on `pending`/`failed` optimistic rows.
- **Hide entirely** when any of: `server_info.features.forkTimelineSync` is absent; a turn is running
  (the same `running` signal the composer consumes — Pi tears down the runtime on fork, so it must
  never be offered mid-stream); or the session is a draft with no live process.
- On click:
  1. call `forkMessages()` **fresh every time** — never cached; the list is only valid against the
     current branch;
  2. correlate by ordinal (index among confirmed user rows → index into `messages`);
  3. verify the matched entry's `text` equals the clicked row's text, whitespace-normalized;
  4. on success hand the matched `{entryId, text}` to the confirm dialog (task-003); on
     out-of-range **or** text mismatch, open the **picker** instead (task-003) — never fork an
     unverified entry.
- Extract the correlation as a **pure, store-free helper** (e.g. `fork-correlation.ts`) taking
  `(confirmedUserRowTexts, clickedIndex, messages)` and returning a matched entry or a
  `"fallback-to-picker"` outcome. Unit-test that helper directly.

## Out of scope

- The dialog and picker components themselves (task-003) — this task calls into them.
- Compact/touch and keyboard behavior (task-005).
- Toasts, prefill, error handling on completion (task-004).

## Acceptance criteria

- [ ] The button appears on hover over a confirmed user row and never on a `pending`/`failed` row.
- [ ] No fork UI renders at all when `forkTimelineSync` is not advertised.
- [ ] The button is absent (not merely disabled-looking) while a turn is running, and on a
      process-less draft session.
- [ ] Row height does not shift when the button appears/disappears.
- [ ] `forkMessages()` is called on every click, never served from a cache.
- [ ] Ordinal out of range **or** normalized-text mismatch opens the picker instead of forking.
- [ ] The correlation helper is pure and covered by unit tests including both fallback triggers.

## Test / verification plan

- Build: `npm run build:web-client` succeeds.
- Tests: unit tests for the correlation helper (exact match, ordinal out of range, text mismatch,
  whitespace-only difference ⇒ still a match); store-level tests for the gating rules. Run
  `npx vitest run packages/web-client`.
- Manual (browser, real daemon + real `pi`): hover a user row mid-conversation → button appears;
  start a turn → button disappears; connect to a daemon without the flag → no button anywhere.
- Lint/format: `npm run lint`; `npx oxfmt <changed files>`.

## Notes

TODO(verify) inherited from the spec: whether steered/queued user messages appear in
`get_fork_messages` identically to how the timeline renders them as user rows. The text-equality
fallback covers a mismatch either way, but confirm live and record the finding — if they diverge,
the picker becomes the primary path for those sessions rather than a fallback.
