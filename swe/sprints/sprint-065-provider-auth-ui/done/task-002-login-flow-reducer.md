# Task 002 — Pure `login-flow.ts` dialog reducer

- **Sprint:** sprint-065-provider-auth-ui
- **Status:** done
- **Type:** feature
- **Area:** web-client / features/provider-auth
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
Put every step/ordering decision of the login dialog in one pure reducer, so the dialog component
stays a renderer and the logic is unit-tested under the node-env runner.

## Context / why
The flow's event stream is genuinely order-sensitive: `auth_url` can arrive before or after a
`manual_code` prompt (they are designed to coexist — the user either clicks through or pastes a
code), `info` accumulates while `progress` replaces, and `prompt_cancelled` can race the user's
answer. That is reducer work, not JSX work.

This is the established split in this codebase: `timeline/reducer.ts` (375 lines, pure) beside a thin
`Timeline.tsx`, and `ui/combobox.ts` beside `Select.tsx`. The root vitest runner discovers only
`.test.ts` under a node environment — no jsdom — so logic that needs testing must live in a pure
`.ts` module.

## Scope references
- `swe/features/provider-auth-ui.md` § Behavior & Algorithms (the reducer pseudocode), § Web UI
  surface (the step-rendering table this state must satisfy)
- `packages/web-client/src/timeline/reducer.ts` (pure-reducer precedent)
- `packages/web-client/src/ui/combobox.ts` (pure-reducer precedent, `useReducer` consumption)
- `packages/client/src/index.ts` (the `ProviderAuthFlowUiEvent` / `ProviderAuthPromptUi` types from task-001)

## What to build
- Create `packages/web-client/src/features/provider-auth/login-flow.ts`:
  - State: `{ phase: "starting" | "waiting" | "prompt" | "done", statusLines: StatusLine[],
    authUrl?, deviceCode?, prompt?, result? }` plus an `initialLoginFlowState(provider, authType)`.
  - `loginFlowReducer(state, event): LoginFlowState`, exhaustive over every
    `ProviderAuthFlowUiEvent` kind:
    - `auth_url` → record url/instructions; **phase unchanged** (a prompt may be live alongside it).
    - `device_code` → record code, verification uri, optional expiry.
    - `info` → append a status line; `progress` → replace the current progress line.
    - `prompt` → `phase = "prompt"`, store the descriptor.
    - `prompt_cancelled` → only when `promptId` matches the stored prompt: clear it,
      `phase = "waiting"`. A non-matching id is ignored.
    - `done` → `phase = "done"`, store `{ ok, error? }`; terminal — a later event never mutates a
      done state.
  - Reducer only: no timers, no DOM, no `Date.now()` in the state transition (a device-code countdown
    is view concern; store the expiry the daemon sent).

## Out of scope
- Any component, CSS, or SDK call (tasks 003–005).
- Rendering/formatting of status lines beyond storing them.

## Acceptance criteria
- [ ] Every event kind has at least one test; the reducer is exhaustive (a new kind fails typecheck
      rather than falling through silently).
- [ ] `auth_url` arriving **after** `prompt` leaves `phase === "prompt"` and both the url and the
      prompt are present in state (concurrency lock for the OAuth manual-code race).
- [ ] `info` appends, `progress` replaces — asserted on `statusLines` contents, not just length.
- [ ] `prompt_cancelled` with the matching id clears the prompt and returns to `waiting`; with a
      stale id it is a no-op.
- [ ] `done` is terminal: a subsequent `prompt`/`info` event does not change the state.
- [ ] The module imports nothing from React, the DOM, or the SDK transport — pure data in, data out.

## Test / verification plan
- Tests: create `packages/web-client/src/features/provider-auth/login-flow.test.ts`; run
  `npx vitest run packages/web-client/src/features/provider-auth/login-flow.test.ts` — all pass in
  the node environment, no jsdom added.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npm run lint`, `npx oxfmt <changed files>`.

## Notes
Keep the state serialisable and free of callbacks — the pending prompt's *resolver* belongs to the
component/SDK boundary (task-004), not to reducer state. Storing a function here is what would make
the reducer untestable and is the specific mistake to avoid.
