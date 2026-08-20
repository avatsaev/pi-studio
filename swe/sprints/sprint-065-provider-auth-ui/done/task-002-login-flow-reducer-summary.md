# Task 002 — Pure `login-flow.ts` dialog reducer — Summary

- **Sprint:** sprint-065-provider-auth-ui
- **Status:** done
- **Completed:** 2026-08-20

## What was built

`packages/web-client/src/features/provider-auth/login-flow.ts`: a pure
`(LoginFlowState, ProviderAuthFlowUiEvent) → LoginFlowState` reducer, matching this codebase's
established pure-reducer-beside-thin-component split (`timeline/reducer.ts` / `Timeline.tsx`,
`ui/combobox.ts` / `Select.tsx`).

- `LoginFlowState`: `{ provider, authType, phase: "starting"|"waiting"|"prompt"|"done", statusLines,
  authUrl?, deviceCode?, prompt?, result? }` plus `initialLoginFlowState(provider, authType)`.
- `applyLoginFlowEvent(state, event)`, exhaustive over every `ProviderAuthFlowUiEvent` kind via a
  `switch` with **no `default` case** — the closed union means an unhandled future kind fails
  typecheck ("not all code paths return a value") rather than falling through silently, the same
  convention `ui/combobox.ts`'s `comboboxReducer` already uses in this codebase.
- Behavior, matching the task's pseudocode exactly:
  - `info` appends a permanent status line; `progress` replaces its own last occurrence (removes any
    existing `progress`-kind entry, then appends the new one) — so at most one rolling progress line
    exists, always trailing the accumulated `info` log.
  - `auth_url` records url/instructions; phase is **never** touched by this event (a `manual_code`
    prompt can be concurrently live — this is the OAuth click-through/paste-a-code coexistence the
    spec calls out). `device_code` follows the same phase-untouched rule for consistency (same
    OAuth-adjacent, presentation-only shape).
  - `info`/`progress` advance phase `"starting" → "waiting"` on the first one seen, otherwise leave
    phase alone (never demotes an active `"prompt"`).
  - `prompt` sets `phase = "prompt"` and stores the descriptor (can fire directly from `"starting"`
    with no preceding info/progress).
  - `prompt_cancelled` clears the prompt and returns to `"waiting"` only when `promptId` matches the
    stored prompt; a stale id is a no-op (returns the exact same state).
  - `done` sets `phase = "done"` and stores `{ ok, error? }`. **Terminal**: the reducer's entry point
    checks `phase === "done"` first and returns the input state unchanged for every event kind
    thereafter, including a second `done`.
- Pure: no timers, no DOM, no `Date.now()`, no mutation of the input (`{ ...state, ... }` spreads
  throughout); a device-code countdown's live tick is left as a view concern — only the daemon-sent
  `expiresInSeconds` is stored.
- Types (`ProviderAuthFlowUiEvent`, `ProviderAuthPromptUi`) come from `@av-pi-studio/client`
  (task-001); `ProviderAuthType` from `@av-pi-studio/protocol`. Both are already web-client
  dependencies — no new dependency added.

## Files changed

| File | Change |
|---|---|
| `packages/web-client/src/features/provider-auth/login-flow.ts` | new — the reducer (152 lines) |
| `packages/web-client/src/features/provider-auth/login-flow.test.ts` | new — 18 tests |

## Commands run + results

- `npm run build:web-client` → clean (before and after formatting).
- `npx vitest run packages/web-client/src/features/provider-auth/login-flow.test.ts` →
  **18/18 pass**, node environment, no jsdom.
- `npm run clean && npm run typecheck` → clean (full rebuild, per the repo's stale-`.tsbuildinfo`
  caution).
- `npx oxlint packages/web-client/src/features/provider-auth/login-flow.ts
  packages/web-client/src/features/provider-auth/login-flow.test.ts` → clean, no warnings.
- `npx oxfmt packages/web-client/src/features/provider-auth/login-flow.ts
  packages/web-client/src/features/provider-auth/login-flow.test.ts` → formatted, both files.
- `npm test` (full monorepo) → **2097/2097 pass** across 167 files (was 2079/166 before this task —
  net +18 tests, +1 file, matching the new test file added).

## Acceptance criteria

- [x] Every event kind (`info`, `progress`, `auth_url`, `device_code`, `prompt`, `prompt_cancelled`,
      `done`) has at least one test; the reducer is exhaustive — a new kind fails typecheck (no
      `default` case over the closed union) rather than falling through silently.
- [x] `auth_url` arriving **after** `prompt` leaves `phase === "prompt"` and both the url and the
      prompt are present in state (dedicated concurrency-lock test).
- [x] `info` appends, `progress` replaces — asserted on `statusLines` contents (exact array
      equality, not just length), including the info-then-progress-then-progress interleaving case.
- [x] `prompt_cancelled` with the matching id clears the prompt and returns to `"waiting"`; with a
      stale id it is a no-op (asserted via exact-state equality to the pre-event state).
- [x] `done` is terminal: a subsequent `prompt`/`info`/`done` event does not change the state
      (three dedicated tests, each asserting exact equality to the already-done state).
- [x] The module imports nothing from React, the DOM, or the SDK transport — pure data in, data out
      (asserted both structurally, via a dedicated test that greps the file's own import lines for
      `type`-only imports and forbidden substrings, and by construction — the file only imports
      `type`s from `@av-pi-studio/protocol`/`@av-pi-studio/client`).

## Notes / follow-ups

- No `TODO(verify)` introduced by this task.
- Next: task-003 (`SettingsDialog`/`ModelProvidersPanel`) is independent of this task (both depend
  only on task-001) but per this session's explicit "no parallel sprints" instruction, tasks are run
  strictly sequentially — task-003 is next.
