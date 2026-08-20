# Task 004 — Login dialog: prompt inputs, status region, terminal states

- **Sprint:** sprint-065-provider-auth-ui
- **Status:** done
- **Type:** feature
- **Area:** web-client / features/provider-auth
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, task-002, task-003

## Goal
Make login actually work: a dialog driven by the reducer that renders every prompt kind, answers it
through the SDK, and lands on a success or error state. After this task an **API-key login completes
end-to-end in the browser**.

## Context / why
This is the interactive core of the feature and the most common path — an API-key provider asks one
`secret` prompt and finishes. The OAuth presentation surface (`auth_url` + QR, device codes) is
deliberately the next task, so this one stays about inputs and lifecycle.

The component is thin by contract: all step/ordering logic is task-002's reducer, and all wire
plumbing is task-001's SDK. What lives here is rendering, focus, and wiring the user's answer to the
pending prompt's resolver.

## Scope references
- `swe/features/provider-auth-ui.md` § Web UI surface (login-dialog step rendering table),
  § Behavior & Algorithms, § Error Handling & Edge Cases
- `packages/web-client/src/features/provider-auth/login-flow.ts` (task-002)
- `packages/web-client/src/features/provider-auth/ModelProvidersPanel.tsx` (task-003; the `Log in`
  handoff and the post-success list invalidation — the panel renders inside task-003's
  `SettingsDialog`)
- `packages/web-client/src/components/primitives/Dialog.tsx` (overlay + Esc conventions)
- `packages/web-client/src/ui/combobox.ts`, `packages/web-client/src/components/primitives/Select.tsx`
  (for a `select` prompt's option list)
- `packages/client/src/index.ts` (`loginProvider`, `ProviderAuthCallbacks` from task-001)

## What to build
- `packages/web-client/src/features/provider-auth/LoginDialog.tsx` (+ CSS module): a `Dialog`-primitive
  overlay whose state is `useReducer(loginFlowReducer, initialLoginFlowState(...))`, fed by
  `callbacks.onEvent`, with `callbacks.prompt` returning a promise the component resolves from the
  submitted input.
- Prompt rendering:
  - `secret` → masked input + submit; the value is never persisted, never written to a store, and is
    cleared from component state on submit.
  - `text` / `manual_code` → plain input with the prompt's `placeholder`.
  - `select` → option list rendering `label` + `description`, click to answer.
- Status region: `info` lines accumulate, `progress` replaces — driven straight off reducer state.
- Terminal states: `done ok` → invalidate the provider list, show success, auto-close after a short
  delay; `done !ok` → error message + `Try again` (restarts a fresh flow, never reuses the dead one).
- Cancel path: the dialog's Cancel button and Esc both abort the `AbortSignal` handed to
  `loginProvider`, which cancels server-side; the reducer then observes `done ok:false`. Closing the
  dialog mid-prompt must leave no dangling resolver.
- Disconnect: the SDK settles `{ ok:false, error:"connection_lost" }` — render it as the error state,
  not as a hang.

## Out of scope
- `auth_url`, QR, and `device_code` rendering (task-005) — those events are already stored by the
  reducer; this task simply does not render them yet.
- The onboarding nudge (task-006).

## Acceptance criteria
- [ ] API-key login completes in a real browser against a production-bootstrap daemon: open dialog →
      masked input → submit → success → row badge flips to `api key` without a page reload.
- [ ] The credential is visible to `pi-studio auth status` run on the daemon host afterward (path
      parity with the spawn path, end to end).
- [ ] A `select` prompt renders labels + descriptions and answering it advances the flow.
- [ ] `Try again` after a failed flow starts a **new** flow (new flowId) and can succeed.
- [ ] Cancel button and Esc both terminate the flow server-side (verified via daemon log or the
      flow-registry hook from sprint-055), and the dialog closes with no unhandled rejection in the
      console.
- [ ] Closing the dialog while a prompt is pending leaves no dangling handler (no console warning, no
      leaked subscription).
- [ ] A secret value appears nowhere outside the submitting request: not in `localStorage`, not in any
      store, not in the DOM after submit, not in a console/log line.
- [ ] All CSS values come from design tokens; no raw px/hex literals.

## Test / verification plan
- Manual (real browser, production-bootstrap daemon): the API-key path above, then a forced failure
  (bad key) to exercise the error state and `Try again`; then Esc mid-prompt and confirm the daemon
  logs a cancelled flow.
- Secret hygiene: after a successful login, inspect `localStorage`, the React tree, and the daemon log
  for the key's value — expect zero hits.
- Build/typecheck/lint: `npm run build:web-client`, `npm run typecheck`, `npm run lint`,
  `npx oxfmt <changed files>`.

## Notes
The pending prompt's resolver lives here, not in reducer state — that split is what keeps task-002
pure and testable. Keep it in a ref, and reject it on unmount/cancel so the SDK sees the rejection and
cancels the flow.
