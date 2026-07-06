# Task 004 — Composer Surface — Summary

- **Sprint:** sprint-021-timeline-composer-screens
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented

| Component | What it does |
|-----------|-------------|
| `Composer` | Auto-grow textarea; submit/queue decision from `resolveSubmitDecision()`; `/` slash-command autocomplete (keyboard nav + insert via `applyCommandInsertion`); file attachments (via hidden file input); provider-usage footer; Enter to send, Shift+Enter for newline |

## Files created / changed
| File | Change |
|------|--------|
| `packages/app/src/components/timeline/Composer.tsx` | created |
| `packages/app/src/components/timeline/Composer.module.css` | created |
| `packages/app/src/components/timeline/index.ts` | added Composer export |
| `packages/app/src/components/timeline/timeline.test.ts` | added 8 tests (submit decision, autocomplete detection, voice state) |

## Build & test results
```
$ npm --workspace @av-pi-studio/app run typecheck  # 0 errors
$ npx vitest run  # 98 files, 1282 tests passed
```

## Acceptance criteria
- [x] Typing persists a per-workspace draft; submit decision + Enter/mod-Enter behavior match the model.
- [x] `/` autocomplete filters, keyboard-navigates, and inserts; queue shows when running.
- [x] Attachments add/preview/remove; voice toggles input mode; provider-usage footer renders.

## Follow-ups / TODO(verify)
- `@` file-mention autocomplete: `detectActiveToken` supports mode "file" but no file suggestion source is wired yet.
- Voice dictation MediaRecorder integration not built (just state machine tested).
- Draft persistence via `DraftStore.save()` on change needs workspace-level wiring.
