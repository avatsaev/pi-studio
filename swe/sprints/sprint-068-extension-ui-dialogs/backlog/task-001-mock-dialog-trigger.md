# Task 001 — Browser-reachable scripted dialog trigger (mock provider)

- **Sprint:** sprint-068-extension-ui-dialogs
- **Status:** backlog
- **Type:** test
- **Area:** server / agent/providers/mock
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal
Make every extension-UI dialog state raisable **from a browser** by typing a prompt, so the whole
sprint can be visually signed off against a running daemon instead of only against unit tests.

## Context / why
`MockAgentSession.emitUiRequest` (`mock-provider.ts:212`) is explicitly test-only: its own comment
says it is reachable by "cast a created session", i.e. in-process only. Nothing in a running daemon
can trigger it, so today there is **no way to make a dialog appear in the browser** except by
running a real `pi` with a real interactive extension.

That fallback exists and works — sprint-067/task-004 answered a real `select`/`input` pair from
`@juicesharp/rpiv-ask-user-question` end to end — but it only produces those two methods, with
whatever payloads that extension happens to send. It cannot produce `confirm`, `editor`, an
unrecognised method, nine options, an empty option list, a deadline, or several concurrent dialogs.
Those are most of the states § 03–§ 07 and § 12 of the visual spec specify.

Visual sign-off for this sprint is performed by the **user**, not the implementer (user direction,
2026-08-21). That makes a reliable, self-describing trigger a prerequisite for every later task
rather than a convenience: each task's hand-off section is written in terms of the recipes this task
introduces.

## Scope references
- `swe/UI design/redesign 0.1.0/Extension Dialogs Visual Spec.html` § 00 (the wire payload table —
  the scripted payloads must match these field names exactly), § 03, § 12
- `packages/server/src/agent/providers/mock/mock-provider.ts` (`MockAgentSession`, `emitUiRequest`
  at :212, `uiResponses` recorder, the scripted-turn implementation)
- `packages/server/src/agent/provider-contract.ts` (`ProviderUiRequest` / `ProviderUiResponse`)
- `swe/features/extension-ui-rpc.md` § Provider channel

## What to build
- Create `packages/server/src/agent/providers/mock/ui-script.ts` — a **pure** parser:
  `parseUiScript(prompt: string): UiScriptStep[] | null`, returning `null` when the prompt is not a
  UI script (the overwhelmingly common case, which must stay a cheap prefix check).
  A step describes one dialog to raise: method, payload, and whether to await its answer.
- Sentinel and grammar (documented in the module's doc comment, and echoed by `#ui help`):
  - `#ui select` / `confirm` / `input` / `editor` — one dialog of that method with a representative
    payload.
  - `#ui unknown` — a method name Pi has never defined, with `expectsResponse` true, to exercise the
    unrecognised-dialog card.
  - `#ui select:9` / `select:empty` / `select:long` — nine options; an empty `options` array; option
    labels that are self-numbered and past the § 12 stacking threshold (reuse the payload shapes
    § 03 quotes from the live capture, verbatim).
  - `#ui input:multiline` — a `title` containing `\n\n` and a bracketed prefix, per § 03.
  - `#ui <method> timeout=<seconds>` — sets `timeout`, so the deadline bar renders. Note `editor`
    takes no `timeout` on Pi's wire (§ 00's table is wrong on that cell — see Notes); the parser
    must reject `timeout=` on `editor` rather than emit a field Pi could never send.
  - `#ui multi <n>` — raises `n` dialogs concurrently without awaiting, for § 06.
  - `#ui help` — emits no dialog; the mock replies with the recipe list as assistant text.
- Wire it into `MockAgentSession`'s turn handling: when a prompt parses as a script, raise the
  scripted request(s) through the existing `emitUiRequest` path instead of the normal scripted turn.
- After a dialog resolves, the mock **echoes what it received** as assistant text (e.g. the selected
  option string, `confirmed: false`, `cancelled: true`). This is what makes a visual check prove the
  round trip rather than only proving the card disappeared.
- Payload field names must match § 00's table exactly (`title`, `message`, `options`, `placeholder`,
  `prefill`) — a scripted payload that drifts from Pi's real shape would make every later visual
  check meaningless.

## Out of scope
- Any change to the `pi` provider, the daemon, the protocol, or the client.
- Fire-and-forget methods (`notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text`) — they
  render nothing in this sprint; sprint-069/070 extend this script's grammar when they need them.
- Making this reachable under the `pi` provider or in production: the mock provider is already
  dev/test-only and never user-selectable in production paths. Keep it that way; add no new gate and
  no new config surface.

## Acceptance criteria
- [ ] `parseUiScript` returns `null` for ordinary prompts, including ones that merely contain `#ui`
      later in the text.
- [ ] Each documented recipe produces a `ProviderUiRequest` whose `method` and payload keys match
      § 00's table; `select:empty` really emits an empty array rather than omitting `options`.
- [ ] `#ui multi 3` raises three dialogs that are all pending simultaneously.
- [ ] `timeout=` is honoured for `select`/`confirm`/`input` and rejected for `editor`.
- [ ] Answering a scripted dialog produces assistant text naming the answer the provider received;
      cancelling produces text showing the cancellation.
- [ ] `#ui help` lists every recipe and raises no dialog.
- [ ] Existing mock-provider tests still pass unchanged.

## Test / verification plan
- Tests: add `packages/server/src/agent/providers/mock/ui-script.test.ts` covering the parser
  (every recipe, the `null` path, the `editor`+`timeout` rejection) and extend the existing
  mock-provider test to assert a scripted dialog reaches subscribers and its answer is recorded in
  `uiResponses`. Run `npx vitest run packages/server/src/agent/providers/mock/`.
- Build/typecheck/lint: `npm run build:server`, `npm run typecheck`, `npm run lint`,
  `npx oxfmt <changed files>`.

## Hand-off for visual sign-off (user)
Not applicable on its own — this task builds the instrument. Record in the task summary the exact
command to start a dev daemon with the mock provider and the full recipe list, so every later
hand-off section can reference it by name.

## Notes
`editor` genuinely has no `timeout` on Pi's wire: `docs/rpc.md`'s editor payload is `title` +
`prefill`, and in Pi's implementation `editor` is the one dialog that does not route through the
timeout-capable promise helper. § 00's table lists `timeout?` for it in error (introduced by the
planning brief, not by the designer). Do not emit it; task-009 files the spec correction.
