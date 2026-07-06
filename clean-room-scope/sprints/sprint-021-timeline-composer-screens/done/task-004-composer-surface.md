# Task 004 — Composer surface

- **Sprint:** sprint-021-timeline-composer-screens
- **Status:** backlog
- **Estimated size:** L
- **Depends on:** task-001; sprint-015/task-006 (composer stores/logic), sprint-013/task-004 (provider usage)

## Goal
Build the composer input surface: text entry, submit/queue controls, `/`-command + `@`-file
autocomplete, attachments, voice dictation, and the provider-usage footer.

## Scope references
- `clean-room-scope/features/composer-ui.md`
- `clean-room-scope/features/provider-usage.md`

## What to build
- A DOM `<textarea>`/auto-grow input backed by the sprint-015 draft store (persisted per workspace);
  submit bar with the `resolveSubmitDecision` states (submit/queue/noop/force) + Enter/mod-Enter policy.
- Autocomplete popover: `detectActiveToken` → `/` client-slash-commands and `@` file mentions, keyboard
  navigation + insert; queue indicator when the agent is running.
- Attachments: file picker (`<input type=file>`), paste/drop images, attachment pills + lightbox; store
  bytes via the KeyValueStore/IndexedDB path.
- Voice dictation via Web Audio + `MediaRecorder` → the sprint-015 voice model (`activeInputMode`,
  dictation state); provider-usage footer widget (live when advertised, else stub).

## Out of scope
- Rewind (task-005). Timeline rows (tasks 001–003).

## Acceptance criteria
- [ ] Typing persists a per-workspace draft; submit decision + Enter/mod-Enter behavior match the model.
- [ ] `/` and `@` autocomplete filter, keyboard-navigate, and insert; queue shows when running.
- [ ] Attachments add/preview/remove; voice toggles input mode; provider-usage footer renders.

## Test / verification plan
- Tests: submit decision + token detection (reuse sprint-015 models); draft persistence; attachment
  add/remove; voice input-mode transitions.

## Notes
- The `/new` initial-context field (sprint-019/task-003) can reuse this input where practical.
