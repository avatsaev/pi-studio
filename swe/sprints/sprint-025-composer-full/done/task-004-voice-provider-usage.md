# Task 004 — Voice dictation & provider usage footer

- **Sprint:** sprint-025-composer-full
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-001; sprint-023/task-001 (session store)

## Goal
Wire voice dictation (Web Audio + MediaRecorder) and the live provider usage meter in the
composer footer.

## Scope references
- `clean-room-scope/features/composer-ui.md` § voice input, § provider usage
- `clean-room-scope/features/provider-usage.md`

## What to build
- **Voice dictation**: mic button toggles recording state (from sprint-015 voice model). On
  start: request mic permission, create MediaRecorder, visualize volume (Web Audio analyser →
  volume meter component). On stop: encode audio → send to speech-to-text API (or daemon STT
  endpoint if available) → insert transcribed text into composer.
- **Volume meter**: animated bar/circle showing live mic volume while recording.
- **Provider usage footer**: when the daemon advertises usage data (tokens, cost), show a live
  updating label: "Claude Sonnet · 1.2k tokens · $0.03". Subscribe to `agent.usage.update`
  events from session store. Show nothing when usage not advertised.
- **Usage breakdown popover**: click the usage label → popover with breakdown (input tokens,
  output tokens, cached tokens, cost per provider, session total).
- **Keyboard shortcut**: Cmd+Shift+V toggles voice mode.

## Acceptance criteria
- [ ] Mic button requests permission, records audio, shows volume meter, transcribes to text.
- [ ] Provider usage shows live token/cost count during agent execution.
- [ ] Usage popover shows breakdown; hides when usage not advertised.
- [ ] Voice keyboard shortcut works.

## Test / verification plan
- Voice: mock MediaRecorder → verify state transitions (idle → recording → processing → idle).
- Usage: emit usage events → verify footer updates.
- Popover: click usage → verify breakdown shown.
