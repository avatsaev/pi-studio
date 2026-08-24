# Task 005 — Web-client: `ThinkingMenu` in the composer + store field + restore/broadcast seeding

- **Sprint:** sprint-070-thinking-level-selector
- **Status:** done
- **Type:** feature
- **Area:** packages/web-client
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-003, task-004

## Goal

The visible feature: a brain-icon level selector in the composer's bottom toolbar next to the
model button, showing the session's persisted level on load and staying correct across picks,
model changes, reloads, and other clients' actions.

## Context / why

`composer-ui.md`'s controls table has specified "Thinking | brain-icon badge → levels combobox"
since sprint-015; this ships it. Every pattern it needs already exists in this package: `ModelMenu`
(trigger + `MenuContent` popup, optimistic pick), `session-store.model/modelProvider`
(store field + `setModel`), `use-session-restore` (list_agents seeding + `agent_update` guard),
`use-provider-models` (shared TanStack query the draft-time lookup reads).

## Scope references

- `swe/features/thinking-level-selector.md` § Web-client, § Level discovery, § Edge cases
- `swe/features/composer-ui.md` § toolbar controls (Thinking row)
- `packages/web-client/src/stores/session-store.ts` (`model`/`modelProvider:33-36`, `setModel:129`)
- `packages/web-client/src/hooks/use-session-restore.ts` (`:45-51` seeding, `:85-88` broadcast
  guard, `:155-156` hydrate)
- `packages/web-client/src/hooks/use-provider-models.ts`, `lib/connection/rpc-keys.ts`
- `packages/web-client/src/features/chat/ModelMenu.tsx`, `Composer.tsx` (`handleSelectModel:379`,
  toolbar mount ~:456), `Composer.module.css` (`.modelBtn` recipe)

## What to build

- **Store:** `SessionEntry.thinkingLevel?: string`; `setThinkingLevel(sessionId, level)` +
  `setThinkingLevelByAgentId`; hydrate from `list_agents`' new field; `use-session-restore` gains a
  `hasStringThinkingLevel`-style guard beside `hasStringModel` for `agent_update` broadcasts.
- **Levels source (pure helper + hook):**
  - live session (`agentId` bound): TanStack query keyed `[agentId, model]` (new `rpcKeys` entry) →
    `client.agent(agentId).listThinkingLevels()`, `enabled` only while the menu is open and a live
    session exists — the key includes `model` so a model change refetches automatically;
  - draft: pure lookup of `session.model` in the already-cached `useProviderModels("pi")` data →
    `thinkingLevels`; model missing from the list → full 7-level ladder (Pi clamps at apply; the
    effective level comes back in the response/broadcast).
  Pure decision logic in a `.ts` module with unit tests (node-env `.test.ts` only — repo
  convention; no jsdom).
- **`ThinkingMenu.tsx`:** trigger = lucide `Brain` + current level text (placeholder `"Thinking"`
  when unknown), `.modelBtn`-style styling; popup = `MenuContent`/`MenuItem`, ≤7 rows, checkmark on
  current (`Check`, `checkSlot` idiom), **no search input**. Hidden or disabled when the server
  lacks the `thinkingLevels` capability or the provider reports no levels.
- **Composer mount + pick:** in `.toolbarRight`, **immediately after the `ModelMenu` trigger in
  DOM order** (model button first, thinking button directly to its right, before the Stop/Send
  cluster) — explicit user decision, 2026-08-24;
  `handleSelectThinking(level)`: optimistic `setThinkingLevel(sessionId, level)` →
  `ensureMaterialized` → `client.agent(agentId).setThinking(level)`; on response, write the
  **effective** level back into the store (it may differ from the pick); swallow errors per the
  `handleSelectModel` convention (stream/broadcast is the source of truth).
- **Draft default:** when materialize's `resolveDefaultModel` carries `thinkingLevel`, seed the
  store alongside model (`stores/materialize.ts` + its cache type).

## Out of scope

- Grouping (levels are one flat ordered list), search, and any CLI/TUI surface.
- E2E sign-off + docs (task-006).

## Acceptance criteria

- [ ] Selector shows the persisted level immediately after a reload (no menu open needed).
- [ ] Pick on a live session → optimistic UI → effective level lands (clamped pick visibly corrects).
- [ ] Pick on a never-spawned draft → persists; first send runs with it.
- [ ] Model change to a non-reasoning model flips the selector to `off` via broadcast in a second
      browser window without reload.
- [ ] Draft level list comes from the cached model catalogue (network tab: no extra RPC).
- [ ] Pure helpers unit-tested (level-source selection incl. fallback ladder; store transitions).

## Test / verification plan

- Unit: new `.test.ts` files for the pure level-source helper and store additions;
  `npx vitest run packages/web-client` — pass.
- Typecheck `npx tsc -b --force`, scoped lint/fmt.
- Manual (vite dev + production daemon): the acceptance list above, two windows for convergence.
