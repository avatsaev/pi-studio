# Task 006 — Effect routing seam + `notify` toasts

- **Sprint:** sprint-069-extension-ui-attention
- **Status:** backlog
- **Type:** feature
- **Area:** web-client / features/agent-ui
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-005

## Goal
Consume the `AgentUiEffect`s sprint-068 deliberately ignored, and render `notify` as a toast at the
right level, with the right locator, in both the active and background-session cases.

## Context / why
The controller has emitted effects since sprint-067 and nothing has consumed them: sprint-068's store
ignores them with a comment, because there was no toast surface to render `notify` into and
`set_editor_text` had no design. Both are now resolved, so this task builds the single routing seam and
uses it for `notify`; task-007 uses the same seam for the composer.

One seam, not two consumers: effects arrive as an array per committed transition, so ordering and
"apply exactly once" belong in one place. Transients appear in no snapshot — the SDK applies queued
ones exactly once during rehydration — so a second consumer subscribing independently would risk
double-applying them.

On the wire the field is `notifyType` (`info | warning | error`, defaults to `info` when absent);
the SDK's effect is `{ type: "notify", agentId, message, level }` and `agent-ui-state.ts` **already
normalizes an absent wire value to `"info"`** before the effect is built — so the renderer only ever
sees a `level` string, and its one remaining decision is the *unrecognised* string. § 11 settles it
the same way sprint-067/task-002's open judgment call anticipated: **unrecognised ⇒ info** — never
dropped, never escalated.

## Scope references
- `swe/UI design/redesign 0.1.0/Extension Dialogs Visual Spec.html` § 11 (`notify` level treatments,
  the attribution rule, background-session locator, error persistence), § 00 (`notify` fields;
  `warning` is new), § 01 (warning rail, error is the only `statusDanger` use)
- `swe/features/extension-ui-client-sdk.md` § Effects
- `packages/client/src/agent-ui-controller.ts` (`subscribe(listener(state, effects))`)
- `packages/client/src/agent-ui-state.ts` (`AgentUiEffect`)
- `packages/web-client/src/features/agent-ui/agent-ui-store.ts` (sprint-068's deliberate
  non-consumption — the comment to replace)
- `packages/web-client/src/ui/toast.ts` + task-005's host

## What to build
- An effect-routing seam in the agent-ui store: for each committed transition, dispatch that
  transition's effects exactly once, in order, from one place. Unknown effect kinds are ignored
  without throwing (the SDK's routing is predicate-based and may grow).
- `notify` → toast: the effect's `level` maps `info`/`warning`/`error` onto the task-005 variants;
  an unrecognised `level` renders as `info` (absence never reaches the renderer — the SDK already
  defaulted it).
- Copy per § 11: **no extension name is available** (§ 00), so in the **active** session the toast is
  the message alone with no attribution line, and for a **background** session it carries the
  session-name locator. Never a typed value.
- Dwell per § 11, passed as explicit `durationMs`: `info` **4s**, `warning` **6s** ("longer than
  info, still self-dismissing"), `error` **sticky** (`durationMs: null`, stays until dismissed).
  Do not lean on `DEFAULT_TOAST_DURATION_MS` (2200ms) — § 11's "4s dwell" quietly contradicts it,
  and the shared default stays untouched for the `copied`/`error` factories.
- Capability-absent ⇒ no controller ⇒ no effects, so no toasts. No separate gate needed; assert it.

## Out of scope
- `set_editor_text` (task-007), though it consumes this same seam.
- Announcement copy and live regions (task-008).
- Any queue/rate-limit policy beyond what task-005's host provides. If an extension spams `notify`,
  the host's stacking is the answer for now; note it rather than inventing throttling.

## Acceptance criteria
- [ ] `notify` at each level renders a toast with the matching § 01 treatment.
- [ ] An unrecognised `level` string renders as info — not as an error and not dropped; a wire
      `notify` with no `notifyType` arrives from the SDK as `level: "info"` and renders as info.
- [ ] From the **active** session the toast shows the message with no attribution line; from a
      **background** session it carries the session-name locator.
- [ ] An `error` notify stays until dismissed; `info` auto-dismisses at 4s, `warning` at 6s.
- [ ] Effects apply exactly once — a reconnect/rehydration does not replay an already-applied notify.
- [ ] No `agent_ui` effect handling occurs when the daemon lacks the capability.
- [ ] Sprint-068's "effects deliberately ignored" comment is gone, not orphaned.

## Test / verification plan
- Tests: extend `agent-ui-store.test.ts` — effect dispatch ordering, exactly-once under a
  snapshot/rehydration sequence, level mapping including absent/unknown, and the active vs background
  copy decision (keep that decision in a pure helper so it is testable). Run
  `npx vitest run packages/web-client/src/features/agent-ui/`.
- Build/typecheck/lint: `npm run build:web-client`, `npm run typecheck`, `npm run lint`,
  `npx oxfmt <changed files>`.

## Hand-off for visual sign-off (user)
Requires task-001's `#ui` grammar to be extended with `notify` recipes (`#ui notify`,
`notify:warning`, `notify:error`) — a small addition to sprint-068/task-001's parser, which this task
should make. Then: fire each level from the session you are viewing (message only), and fire one from
a background session (locator present). Confirm the error toast stays until you dismiss it, and that
hovering pauses dismissal on the others.

## Notes
The mock provider's script currently covers dialogs only. Extending it here rather than in task-005
keeps the grammar change next to the consumer that needs it — and it is the only way you can raise a
`notify` at all, since no real extension in the tested set emits one.
