# Task 006 — Composer surface, logic, stores, submit/queue, autocomplete, controls, attachments, voice

- **Sprint:** sprint-015-timeline-and-composer-ui
- **Status:** done
- **Estimated size:** L
- **Depends on:** task-001

## Goal
Implement the composer runtime logic, client-side stores, and UI surface that screens/panels integrate
from `composer/`: region layout, submit/queue behavior, autocomplete, provider/model/mode/feature
controls, attachments, and voice.

## Scope references
- `clean-room-scope/features/composer-ui.md` (all sections, including § Create-agent preferences)
- `clean-room-scope/architecture/client-app-runtime.md` § App runtime concepts, § Data & Persistence
- `clean-room-scope/features/provider-usage.md` § Composer footer (compact window-bar widget)
- `clean-room-scope/features/keyboard-shortcuts.md` (the dispatcher this composer's bindings register
  against — built in sprint-012/task-005)

## What to build
- Composer state and client stores: drafts, provider/model/mode/feature selections, attachment metadata,
  platform-gated attachment bytes storage, and restore/reset behavior.
- Per-project create-agent preferences store (`provider`, `providerPreferences[provider]` — model/mode/
  thinking-by-model/featureValues, `favoriteModels`, `isolation`); read to prefill new-agent controls and
  written back when the user picks differently while creating an agent; favorite models pinned atop the
  model selector.
- A compact provider-usage window-bar widget in the composer footer (desktop) when the host advertises
  `providerUsageList` — reuses the window-bar rendering from provider-usage.md, showing the single most
  relevant rate-limit window.
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
- Timeline rendering (tasks 001–005). New-workspace screen composition (sprint-013/task-003 integrates
  this surface).

## Acceptance criteria
- [ ] Composer drafts, selections, and attachments persist/restore through the client stores.
- [ ] Creating a new agent prefills provider/model/mode/thinking/features from that project's create-agent
      preferences, and updates them when the user picks differently; favorite models pin to the top.
- [ ] The composer footer shows a compact provider-usage window when the host supports it.
- [ ] The composer renders all regions and is reused unchanged by workspace + new-workspace + agent
      screens.
- [ ] Submit is enabled by text and/or attachments; create vs continue routes correctly; sending while
      running enqueues with an optimistic bubble and flushes on idle.
- [ ] Slash + `@file` autocomplete navigates by keyboard and inserts; model/mode/feature selection persists.
- [ ] Image/GitHub/workspace attachments add removable pills; dictation + realtime voice start/stop.

## Test / verification plan
- Tests: draft/selection/attachment stores; submit-decision truth table; create-vs-continue routing;
  queue enqueue/flush; autocomplete selection/insertion (pure helpers + mock client).

## Notes
- Realtime-voice transport details + slash-command catalog are TODO(verify).
