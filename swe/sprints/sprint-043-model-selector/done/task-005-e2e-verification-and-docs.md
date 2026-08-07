# Task 005 — End-to-end verification + docs

- **Sprint:** sprint-043-model-selector
- **Status:** done
- **Estimated size:** S
- **Depends on:** task-001, task-002, task-003, task-004

## Goal
Prove the model selector works end-to-end against a running daemon and update the affected package
docs to describe the new RPC and composer control.

## Background / why
Tasks 001–004 land the server RPC, client typing, component, and wiring. This task exercises the
whole path (list → filter → select → server change → UI reflection) and records the new behavior in
the AGENTS docs per the repo docs-sync rule.

## Scope references
- `clean-room-scope/features/composer-ui.md` § toolbar controls
- `clean-room-scope/features/provider-usage.md` § model selection
- `packages/server/AGENTS.md`, `packages/client/AGENTS.md`, `packages/web-client/AGENTS.md`

## What to build / do
- **End-to-end smoke** against the dev daemon (mock provider, in-memory):
  - `npm run build && npm run typecheck` (full monorepo) pass.
  - `npm run dev:daemon` (binds `0.0.0.0:6767`).
  - Run the web-client dev server (from `packages/web-client`, its `dev` script) pointed at
    `ws://127.0.0.1:6767` (confirm the web-client's daemon-URL mechanism and use it).
  - Open a chat session and verify each behavior below.
- **Docs sync** (same change, before yielding):
  - `packages/server/AGENTS.md` — document the `list_provider_models` RPC (request
    `{ provider?, cwd? }`, response `{ provider, models: {id,label?,description?}[] }`) in the RPC/
    provider section.
  - `packages/client/AGENTS.md` — note `providers.listModels` now returns
    `ListProviderModelsResponse` and the exported `ProviderModel`/`ListProviderModelsResponse` types.
  - `packages/web-client/AGENTS.md` — add `features/chat/ModelMenu.tsx` to the source layout and note
    the composer's model-selector control.

## Out of scope
- Any new feature behavior — verification and docs only.

## Acceptance criteria
- [ ] `npm run build && npm run typecheck` pass across the monorepo.
- [ ] In the running app: a model button shows left of the composer textarea; fresh session shows the
      `"Model"` placeholder, then the mock model id (`mock-model`) once the agent reports it.
- [ ] Clicking opens a menu with a top search input and the model list; each row shows label +
      muted `(id)`; the current model is first with a checkmark.
- [ ] Typing in the search box filters the list case-insensitively (matches by label and id).
- [ ] Selecting a model updates the button label immediately and the StatusBar model segment after
      the broadcast.
- [ ] The three AGENTS.md files are updated to match the shipped behavior.

## Test / verification plan
- Full build/typecheck: `npm run build && npm run typecheck`.
- Unit tests from earlier tasks: `npx vitest run packages/web-client/src/features/chat` (and any
  `ModelMenu`/helper tests) pass.
- Manual E2E: the acceptance-criteria walkthrough above against `npm run dev:daemon` + the web-client
  dev server.

## Notes
- If any AGENTS.md section is genuinely unaffected, state so rather than editing for churn.
- The mock provider serves a single model, so the "sorts-first + checkmark" and multi-item filtering
  are best exercised with the real `pi` provider (`npm start`) if available; otherwise rely on the
  `ModelMenu` unit tests from task-003 for multi-model behavior.
