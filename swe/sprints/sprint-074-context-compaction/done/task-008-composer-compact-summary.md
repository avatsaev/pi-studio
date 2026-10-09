# Task 008 — Web-client composer: compacting gate, Stop-cancels, `/compact` built-in — Summary

- **Sprint:** sprints/sprint-074-context-compaction
- **Completed:** 2026-10-09
- **Status:** done

## What was implemented
`slash-commands.ts` gained `CLIENT_BUILTIN_COMMANDS` (listed first, shadows a same-named Pi command) and `parseBuiltinInvocation` (Pi's case-sensitive grammar). New pure `composer-gate.ts` (`canSubmitDraft`, `canCompact`). `Composer.tsx` intercepts a `/compact` draft into `compactSession`, gates Send/Enter while compacting, shows Stop while compacting (calls `cancelCompaction`), and shows the store's error inline. `CommandMenu` renders disabled rows (dimmed, not selectable).

## Files created / changed
| File | Change |
|------|--------|
| `features/chat/slash-commands.ts` (+ test), `composer-gate.ts` (+ test) | built-ins, grammar, gate |
| `features/chat/Composer.tsx`, `Composer.module.css`, `CommandMenu.tsx`, `ModelMenu.module.css` | wiring, disabled rows, error line |
| `packages/web-client/AGENTS.md`, `swe/features/composer-ui.md` | documented |

## Build & test results
```
$ npx vitest run packages/web-client -> 104 files, 1361 passed
$ tsc -b packages/web-client; npm run build:web-client -> success; oxfmt clean on changed files
```

## Acceptance criteria
- [x] `/compact` and `/compact focus on X` on an idle agent issue one `agent_compact_request` (`focus on X` observed on the wire) with no `send_agent_prompt` and no user row
- [x] `/Compact x` is not intercepted: user row + normal send observed. (Bare `/Compact` with the picker open is completed to `/compact ` by the picker's existing Enter-accepts-highlight behavior, not submitted.)
- [x] While compacting: Send disabled, Stop visible, an ordinary draft + Enter sends nothing (browser). Stop → `cancelCompaction` is the store's tested `interrupt`; the mock provider cannot abort a compaction so no `canceled` divider was produced here (task-009 covers real Pi).
- [x] While running (status forced in the page): `/compact now` leaves Steer disabled and Enter a no-op; an ordinary draft keeps Steer enabled
- [x] Picker lists `compact` first with its description, dimmed/`aria-disabled` while running; a Pi command named `compact` is dropped (unit test)
- [x] A failing `/compact` (compact rejected in the page): draft kept, `Nothing to compact (session too small)` shown, error clears on the next edit

## Found while verifying
- Clearing the draft unconditionally on success wiped text typed during the compaction; fixed to clear only if the draft still equals what was submitted (verified: `typed meanwhile` survives).

## Follow-ups / TODO(verify)
- None.
