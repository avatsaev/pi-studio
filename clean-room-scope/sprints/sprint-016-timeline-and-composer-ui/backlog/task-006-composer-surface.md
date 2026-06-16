# Task 006 — Composer surface: regions, submit/queue, autocomplete, controls, attachments, voice

- **Sprint:** sprint-016-timeline-and-composer-ui
- **Status:** backlog
- **Estimated size:** L
- **Depends on:** task-001; task-003 (sprint-012, composer logic + stores)

## Goal
Implement the composer UI surface that screens/panels integrate from `composer/`: its region layout,
submit/queue behavior, autocomplete, the provider/model/mode/feature controls, attachments, and voice.

## Scope references
- `clean-room-scope/features/composer-ui.md` (all sections)
- `clean-room-scope/architecture/client-app-runtime.md` (composer logic from sprint-012/task-003)

## What to build
- Region map (top→bottom per the doc): attachment strip, autocomplete popover, text input, controls row;
  the surface is self-contained and reused by the workspace, new-workspace, and agent screens.
- Sendable content + the submit decision (text and/or attachments → enabled); create-vs-continue (who
  sends: create a draft→agent vs continue an existing agent); queue while the agent is running (enqueue +
  optimistic pending bubble; flush on idle).
- Text input (adaptive uncontrolled input + reset-key; multiline grow; submit keybinding per platform).
- Slash-command + `@file`-mention autocomplete (anchored popover, keyboard nav, debounced file search,
  insertion).
- Provider/model/mode/feature controls (comboboxes + segmented/menus; reflect + persist selection via the
  client stores).
- Attachments: image picker / paste / drop, GitHub attachment, workspace-file attachment; attachment
  pills with remove.
- Dictation (STT controls + volume meter) and the realtime voice-agent overlay (start/stop, status).
- Composer keyboard shortcuts.

## Out of scope
- Timeline rendering (tasks 001–005). New-workspace screen composition (sprint-014/task-003 integrates
  this surface). Composer business logic/stores (sprint-012/task-003 — consumed here).

## Acceptance criteria
- [ ] The composer renders all regions and is reused unchanged by workspace + new-workspace + agent
      screens.
- [ ] Submit is enabled by text and/or attachments; create vs continue routes correctly; sending while
      running enqueues with an optimistic bubble and flushes on idle.
- [ ] Slash + `@file` autocomplete navigates by keyboard and inserts; model/mode/feature selection persists.
- [ ] Image/GitHub/workspace attachments add removable pills; dictation + realtime voice start/stop.

## Test / verification plan
- Tests: submit-decision truth table; create-vs-continue routing; queue enqueue/flush; autocomplete
  selection/insertion (pure helpers + mock client).

## Notes
- Realtime-voice transport details + slash-command catalog are TODO(verify).
