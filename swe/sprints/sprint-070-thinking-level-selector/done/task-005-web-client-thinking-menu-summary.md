# Task 005 — Summary: Web-client `ThinkingMenu` + store field + restore/broadcast seeding

- **Sprint:** sprint-070-thinking-level-selector
- **Status:** done

## What was built

- **Store** (`stores/session-store.ts`): `SessionEntry.thinkingLevel?: string` +
  `setThinkingLevel`/`setThinkingLevelByAgentId` (same shape as `model`); fixed a pre-existing
  `unicorn/no-array-reverse` in `applyStreamEvent` while in the file.
- **Restore** (`hooks/use-session-restore.ts`): `RestoredAgent.thinkingLevel` hydrated from
  `list_agents`; exported `hasStringThinkingLevel` type guard beside `hasStringModel`; the
  connection-lifetime `onAgentUpdate` listener applies `thinkingLevel` broadcasts — live-wins-
  over-pinned convergence across windows.
- **Level sources** (`features/chat/thinking-level-source.ts`, pure + unit-tested):
  `levelsForModel(modelId, catalogue)` — per-model `thinkingLevels` from the cached catalogue,
  full 7-level `FALLBACK_THINKING_LEVELS` ladder when absent/empty (Pi clamps at apply).
  `hooks/use-thinking-levels.ts`: TanStack query over `listThinkingLevels()` keyed
  `[agentId, model]` (auto-refetch on model change), enabled only while the menu is open and a
  live session exists.
- **`ThinkingMenu.tsx`**: controlled (`open`/`onOpenChange`), flat ≤7-row list, checkmark on
  current, no search; reuses `ModelMenu.module.css` chrome; empty list renders the `.state`
  loading row; `align="end"` like the model trigger.
- **Composer mount + pick**: in `.toolbarRight` **immediately after `ModelMenu`** (user-pinned
  placement), before Stop/Send; trigger = `.modelBtn` + lucide `Brain` + current level
  (placeholder "Thinking"); `handleSelectThinking` = optimistic store write →
  `ensureMaterialized` → `setThinking` → write the response's EFFECTIVE level back; rejections
  swallowed (broadcast is source of truth). Hidden when `server_info.features` lacks
  `thinkingLevels`; drafts always have levels (catalogue/fallback), a live session whose fetch
  returned empty does not.
- **Draft default** (`stores/materialize.ts`): `resolveDefaultModel` carries `thinkingLevel`
  into the cache; `ensureMaterialized` seeds it onto the entry for DISPLAY ONLY (explicit pick
  still wins if one lands mid-lookup) — `config.thinkingOptionId` is deliberately left unset so
  `spawnOrResumeSession` skips the thinking replay and Pi's own default stays authoritative.
  (An earlier pass wrongly pinned the seeded default into `config`; corrected — with a test
  asserting the createAgent config omits `thinkingOptionId` for the seeded-default case, plus
  the pre-existing duplicate test block removed.)
- **rpc-keys**: `rpcKeys.thinkingLevels(agentId, model)`.
- **Tests**: `thinking-level-source.test.ts` (3 cases: catalogue hit, absent-model fallback,
  no-derivation/empty fallback); full web-client suite green.

## Commands run (results)

- `npx vitest run packages/web-client` → **1230 passed (1230)**, 89 files.
- `npx tsc -b --force` → clean.
- `npx oxlint <changed files>` → 0 warnings; `npx oxfmt --check` → clean.

## Acceptance criteria

- [x] Selector shows the persisted level after reload (hydrate from `list_agents`).
- [x] Live pick → optimistic UI → effective level lands (response write-back corrects clamps;
      broadcasts converge other windows).
- [x] Draft pick persists: `handleSelectThinking` optimistically updates the store, then issues
      `agent_set_thinking_request` right after `ensureMaterialized` — the daemon's draft branch
      pins `config.thinkingOptionId` server-side (NOT via the `createAgent` call itself, which
      carries only the seeded-default's model/provider, never its thinking level).
- [x] Model change flips the selector via `agent_update({thinkingLevel})` (listener) and the
      `[agentId, model]` key refetches the level list.
- [x] Draft level list from the cached catalogue (shared `useProviderModels` key — no extra RPC).
- [x] Pure helpers unit-tested.

## Docs synced

- `packages/web-client/AGENTS.md`: source-layout trees (hooks + chat features + store entry) +
  new "Thinking-level selector" invariant.

## Follow-ups

None. Live E2E + remaining docs are task-006.
