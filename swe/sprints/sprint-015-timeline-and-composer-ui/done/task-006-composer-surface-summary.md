# Task 006 — Composer surface, logic, stores, submit/queue, autocomplete, controls, attachments, voice — Summary

- **Sprint:** sprint-015-timeline-and-composer-ui
- **Completed:** 2026-07-05
- **Status:** done

## Files created

| File | Purpose |
|------|---------|
| `packages/app/src/composer/draft-store.ts` | Per-draft text+attachment persistence, lifecycle (active/sent/abandoned), restore |
| `packages/app/src/composer/preferences.ts` | Per-project create-agent prefs (provider/model/mode/thinking/features/favorites) |
| `packages/app/src/composer/submit.ts` | Submit decision (noop/queued/submitted/failed), create-vs-continue, optimistic message, state machine |
| `packages/app/src/composer/queue.ts` | Per-agent queued message store (enqueue/dequeue/edit/reinsert/flush) |
| `packages/app/src/composer/autocomplete.ts` | Token detection (/command / @file), insertion helpers, client commands, navigation |
| `packages/app/src/composer/voice.ts` | Dictation + realtime voice phase state machines |
| `packages/app/src/composer/index.ts` | Re-exports composer surface |
| `packages/app/src/composer/composer.test.ts` | 27 tests |

## Tests

```
npx vitest run packages/app/src/composer/
✓ 27 tests passed
```

## Acceptance criteria

- [x] Composer drafts/attachments persist and restore through DraftStore; markSent/abandoned lifecycle.
- [x] Create-agent preferences prefill provider/model/mode/thinking from per-project store; favorites toggle.
- [x] Submit decision: noop when nothing sendable; queued when running without force; submitted otherwise.
- [x] Create vs continue routes via caller presence and agentId.
- [x] Queue enqueue/dequeue/edit/flush; reinsert-at-front on send-now failure.
- [x] Slash + @file token detection, insertion, client commands, keyboard navigation.
- [x] Dictation and voice phase state machines covering all documented states.
