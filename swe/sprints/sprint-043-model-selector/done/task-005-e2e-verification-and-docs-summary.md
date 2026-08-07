# Task 005 — End-to-end verification + docs — Summary

- **Sprint:** sprint-043-model-selector
- **Completed:** 2026-07-24
- **Status:** done

## What was implemented
No new feature code. Ran the full end-to-end verification pass and synced the three affected
`AGENTS.md` files against what tasks 001–004 actually shipped.

### Docs sync
| File | Change |
|------|--------|
| `packages/server/AGENTS.md` | Added a `list_provider_models` paragraph right after the `ProviderRegistry` line: request/response shape, `AgentClient.listModels` backing (no spawned agent), and that it follows `list_providers`/`list_agents_request`'s untyped-ad-hoc-RPC convention (no protocol schema, not in `sessionMessageSchema`'s union). |
| `packages/client/AGENTS.md` | Extended the `PiStudioProviderActions` table with a `Return` column; documented `listModels` now returns `Promise<ListProviderModelsResponse>` (sprint-043) instead of `unknown`; added a note describing the exported `ListProviderModelsResponse`/`ProviderModel` types and that they live only in this package (no protocol schema), matching the RPC's own convention. |
| `packages/web-client/AGENTS.md` | Added `ModelMenu` to the `features/chat/` source-layout line; added a new "Model selector (sprint-043)" invariant bullet (placed with the existing Composer/StatusBar invariant bullets) covering: trigger placement, search filter (`filterOptions`), checkmark + sort (`sortCurrentFirst`, and why it's a separate `.ts` file — the root Vitest config only discovers `.test.ts` under a node environment, no `.tsx` render tests exist anywhere in this package despite `@testing-library/react` being a devDependency), muted `(id)` styling, the optimistic-then-RPC selection flow, and the deliberate non-goal of seeding agent-creation with the picked model. |

## How it satisfies the scope
Matches every file/RPC/type this sprint actually touched; no aspirational or planned-but-undelivered
behavior was documented. `features/workspace-ui.md`/`features/composer-ui.md` were left unedited —
consistent with sprint-042's precedent of documenting UI-primary changes at the AGENTS.md/live-source
level when the corresponding `features/*.md` scope describes a different, not-yet-implemented
architecture (not the case here, but no existing convention required editing those files either).

## Build & test results — end-of-sprint gate
```
$ npm run build       (full monorepo — protocol, highlight, relay, client, server, web-client, cli)
✓ all packages built; web-client: 2671 modules transformed, 5.02s (pre-existing chunk-size/
  circular-chunk warnings only, unrelated to this sprint)

$ npm run typecheck
> tsc -b
(success, no errors)

$ npm run lint
(warning-only, exit 0 — zero new warnings in any file this sprint touched across all 5 tasks)

$ npm test
Test Files  93 passed (93)
     Tests  753 passed (753)
```

### Live end-to-end browser smoke test (already performed during tasks 003/004; not repeated here)
Full walkthrough — connect, open a fresh session, model button placeholder, open menu, search
filter (match + no-match), select with no bound agent (optimistic, no RPC), send a message to bind
an agent, re-open (checkmark on current model), re-select with a bound agent (correct RPC issued,
confirmed via daemon log) — is recorded in `task-004-composer-mount-and-set-model-summary.md`.
Screenshot evidence is in that file's parent conversation; not re-captured here since the UI/wiring
did not change between task-004 and this task.

## Acceptance criteria
- [x] `npm run build && npm run typecheck` pass across the monorepo.
- [x] In the running app: a model button shows left of the composer textarea; fresh session shows
  the `"Model"` placeholder, then the mock model id (`mock-model`) once selected/reported —
  verified live in task-004's smoke test.
- [x] Clicking opens a menu with a top search input and the model list; each row shows label +
  muted `(id)`; the current model is first with a checkmark — verified live.
- [x] Typing in the search box filters the list case-insensitively (matches by label and id) —
  verified live (both a matching and non-matching query).
- [x] Selecting a model updates the button label immediately and the StatusBar model segment after
  the broadcast — verified live for the optimistic/no-agent case (both the button and StatusBar
  updated together); the full RPC-confirmed broadcast path for a provider that supports
  `setProviderModel` is proven by a combination of a live RPC-issuance check (this sandbox's mock
  provider deliberately doesn't implement `setProviderModel`, so it cannot complete the round trip
  itself) plus the pre-existing `slash-command-ops.test.ts` test that proves the server-side
  broadcast fires when a session does implement it. See task-004's summary "Known limitation"
  section for the full account.
- [x] The three AGENTS.md files are updated to match the shipped behavior.

## Follow-ups / TODO(verify)
- Carried from task-004: exercising the full `agent_set_model_request` → `setProviderModel` →
  `agent_update` broadcast round trip against a **live spawned `pi --mode rpc` process** was not
  possible in this sandbox (no Pi CLI credentials configured — `~/.pi/auth.json` absent, no
  provider API key env vars set). If/when this is run in an environment with real Pi credentials
  (`npm start` + a real agent), it would be worth a one-time confirmation, mirroring how sprint-042's
  task-006 caught real Pi-provider gaps that no unit test could have. No code changes are expected
  from that run — every individual link in the chain is already independently verified (RPC
  issuance live, server broadcast-on-success via an existing test, store reconciliation live).
