# Post-sprint corrections (live user testing)

Sprint-043 was marked done after build/test/lint verification and a live smoke test against the
mock provider (task-005). Live testing against the **real** daemon + `pi` provider (started at the
user's request after sprint completion) surfaced two further issues, both fixed in place:

## Correction 1 — model list not cached, reloaded on every menu open

**Symptom:** opening `ModelMenu` always re-fetched and showed a loading spinner, even on repeat
opens within the same session.

**Fix:** replaced the ad hoc `useState`/`useEffect` fetch in `ModelMenu.tsx` with a new
`useProviderModels` hook (`packages/web-client/src/hooks/use-provider-models.ts`), following the
app's existing `@tanstack/react-query` RPC-caching convention (`use-file-diff.ts`, `use-explorer.ts`,
`OpenWorkspaceDialog.tsx`'s `useExplorer(path, open && ...)`). Cached by
`rpcKeys.providerModels(provider)`; reopening within the cache window shows data instantly
(`isLoading: false`) while TanStack Query refetches in the background.

**Bonus bug found during this fix's live verification:** the real provider's model list contains
genuine duplicate `id`s across different display groupings (two distinct entries both reporting id
`claude-sonnet-5`), which collided as React list `key`s and left a stale/misplaced row visible after
filtering. Fixed with a new `dedupeById` helper (`model-menu-sort.ts`, unit-tested, composes with
the existing `sortCurrentFirst`).

Files changed: `packages/web-client/src/hooks/use-provider-models.ts` (new),
`packages/web-client/src/lib/connection/rpc-keys.ts` (added `providerModels` key),
`packages/web-client/src/features/chat/ModelMenu.tsx`, `model-menu-sort.ts` (+`.test.ts`).

## Correction 2 — selected model silently reverted to the default on the next message

**Symptom:** picking a model in the selector updated the button, but sending a message to the
existing session reset it back to the default — the newly selected model was never actually
applied.

**Root cause:** `AgentModelDefinition` (`provider-contract.ts`) had no `provider` field, so the Pi
adapter's `listModels()` mapping (`providers/pi/agent.ts`) silently dropped each model's own
underlying LLM provider (e.g. `"anthropic"`) when converting Pi's raw `Model` object
(`docs/rpc.md` § Model: `{id, name, api, provider, ...}`) into our generic shape. The web-client then
hardcoded `provider: "pi"` (the **pi-studio `AgentClient` id**, used only to pick which client
answers `list_provider_models`) when calling `client.agent(id).setModel("pi", modelId)`. Pi's own
`set_model` RPC interprets its `provider` argument as the model's LLM provider, not the pi-studio
provider id — so every real `agent_set_model_request` failed server-side with
`"Model not found: pi/<modelId>"` (confirmed live via the daemon log). The client's UI showed the
optimistic pick regardless, since the RPC rejection is swallowed with no dedicated UI surface — so
the change silently never took effect, and the next turn correctly used the real (never-changed)
default model, which looked like "the model reset."

**Fix**, threaded through all four layers:
- `packages/server/src/agent/provider-contract.ts` — `AgentModelDefinition` gained an optional
  `provider` field (the model's own LLM provider).
- `packages/server/src/agent/providers/pi/agent.ts` — `listModels()` now carries `rec.provider`
  through into `AgentModelDefinition.provider` instead of dropping it.
- `packages/client/src/pistudio-client.ts` — `ProviderModel` gained the matching `provider?: string`
  field.
- `packages/web-client/src/features/chat/ModelMenu.tsx` — `onSelect` signature changed to
  `(modelId, modelProvider?) => void`; each row now looks up and passes its own model's `provider`
  (via a `providerById` map built from the already-fetched model list) instead of nothing.
- `packages/web-client/src/features/chat/Composer.tsx` — `handleSelectModel` now calls
  `client.agent(agentId).setModel(modelProvider, modelId)` using the model's own provider, and
  explicitly bails (no RPC, no optimistic update) if `modelProvider` is somehow missing rather than
  ever falling back to the pi-studio id `"pi"`.

**Live verification** (real daemon, real `pi` provider, real Anthropic-backed agent, throwaway
session created and deleted afterward so the user's real conversations were untouched):
1. Selected a different model (`claude-haiku-4-5`) on a session with a live bound agent —
   `agent_set_model_request` succeeded with **no error** in the daemon log (previously: `"Model not
   found: pi/claude-haiku-4-5"` on every attempt).
2. Sent a follow-up message ("what model are you") — the composer button **and** the workspace
   StatusBar's model segment both continued showing `claude-haiku-4-5` afterward; neither reverted.
3. Confirmed the real model list has 41 unique ids (dedupe from Correction 1 holds against the real
   provider's actual data) and each carries its own real `provider` (`"anthropic"`, etc.).

## Verification (both corrections)
```
$ npm run build         → all 8 packages, success
$ npm run typecheck      → success, no errors
$ npm run lint           → warning-only; zero new warnings in any touched file
$ npm test               → 93 test files, 757 tests passed (4 new: dedupeById cases)
```
Daemon restarted once (`hub restart pi-studio-daemon`) to pick up the server-side fix; web-client
picked up its changes live via Vite HMR, no restart needed.

## Docs updated
`packages/server/AGENTS.md`, `packages/client/AGENTS.md`, `packages/web-client/AGENTS.md` — the
sprint-043 sections written at initial completion described the (buggy) hardcoded-`"pi"` flow;
corrected to describe the real `provider` threading and explicitly call out the fixed bug so a
future reader doesn't reintroduce it.
