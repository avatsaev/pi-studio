# Task 004 — Mount `ModelMenu` in the Composer and wire model selection — Summary

- **Sprint:** sprint-043-model-selector
- **Completed:** 2026-07-24
- **Status:** done

## What was implemented
- **`packages/web-client/src/features/chat/Composer.tsx`**:
  - Added `const setModel = useSessionStore((s) => s.setModel);` alongside the file's other
    store-action selectors.
  - Mounted `<ModelMenu currentModel={session?.model} provider="pi" onSelect={handleSelectModel} />`
    as the first child of `.composer`, before `.inputArea` — left of the textarea.
  - Added `handleSelectModel(modelId)`: calls `setModel(sessionId, modelId)` optimistically first,
    then (only if `session.agentId` is bound) fires
    `client?.agent(session.agentId).setModel("pi", modelId)`, swallowing a rejection with a
    `.catch(() => {})` and an explanatory comment — mirroring `submit()`'s existing
    swallow-and-let-the-stream-be-the-source-of-truth convention in this same file (no toast helper
    is used anywhere in `Composer.tsx`, so none was introduced here either).
  - Added the `ModelMenu` import.
- No changes to `Composer.module.css` — `ModelMenu` owns its own trigger-button styling
  (`.modelBtn` in `ModelMenu.module.css`, per task-003), so no duplicate class was added here.

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/src/features/chat/Composer.tsx` | modified — `setModel` selector, `ModelMenu` mount, `handleSelectModel`, import |

## How it satisfies the scope
Matches `features/composer-ui.md` § toolbar controls (control placement) and
`features/provider-usage.md` § model selection (optimistic local update + server RPC). The
fresh-session/no-bound-agent case intentionally stores the pick locally only, per the task's stated
out-of-scope boundary (agent-creation is not changed to seed a chosen model).

## Build & test results
```
$ npm run build:web-client → success (5-7s, pre-existing chunk-size warnings only)
$ npm run typecheck        → success, no errors
$ npm run lint              → zero new warnings (only pre-existing warnings elsewhere)
$ npm test                  → 93 test files, 753 tests passed (0 failed)
```

### Live browser smoke test (dev daemon, mock provider; `npm run dev:daemon` + `packages/web-client` `npm run dev`, headless browser via CDP)
1. Connected to `ws://127.0.0.1:6767`; a fresh "New chat" session (no bound agent) showed the
   composer's model button reading the placeholder **"Model"**, positioned left of the textarea
   (screenshot-confirmed).
2. Opened the menu: search box + `Mock Model (mock-model)` row rendered, `(mock-model)` visibly in
   a muted gray shade vs. the label.
3. Typed a non-matching query → **"No models found"** rendered. Filled `"mock"` → the row
   re-appeared (`filterOptions` case-insensitive substring match confirmed live).
4. Selected the row with **no agent bound**: the composer button immediately updated to
   **"mock-model"**, and the workspace StatusBar's model segment (sprint-042, unrelated to this
   sprint's changes) also updated to `mock-model` in the same render pass — confirming the
   optimistic `setModel(sessionId, modelId)` store write is the single source both readers consume.
   No RPC was issued (no bound `agentId` yet) — verified by the daemon log showing no
   `agent_set_model_request` entry at this point.
5. Sent a chat message ("hello") to bind a real (mock) agent to the session (`1 msgs`, an agent id
   appeared). Re-opened the menu: the current model's row now showed a **checkmark** (the mock
   provider only exposes one model, so "sorts first" is unexercised beyond the checkmark itself —
   `sortCurrentFirst`'s reordering behavior is separately unit-tested in task-003).
6. Re-selected the same model with the agent now bound: the daemon log confirmed the client issued
   `agent_set_model_request` with the correct `agentId`/`provider: "pi"`/`modelId: "mock-model"`
   payload — proving `handleSelectModel`'s RPC branch fires correctly for a bound agent.

## Known limitation (disclosed, not a regression)
Step 6's RPC was rejected server-side: `"agent ...'s provider does not support 'set_model'"`. This
is **not** a bug introduced by this task — `packages/server/src/agent/providers/mock/mock-provider.ts`
deliberately does not implement `setProviderModel` (its own comment at line 188-189: kept unsupported
specifically to exercise the "unsupported provider method → rpc_error" path used by
`slash-command-ops.test.ts`). The real `pi` provider *does* implement `setProviderModel`
(`packages/server/src/agent/providers/pi/agent.ts`, confirmed during sprint planning), but this
sandbox has no configured Pi CLI credentials (`~/.pi/auth.json` absent, no
`ANTHROPIC_API_KEY`/similar env var), so the full success path (RPC → `setProviderModel` →
`agent_update({model})` broadcast → store reconciliation) could not be exercised against a live
spawned `pi --mode rpc` process in this environment. This was substituted with:
- **Live proof the correct RPC is issued** (step 6, daemon log).
- **An existing, passing server test proving the success path**:
  `packages/server/src/agent/slash-command-ops.test.ts:272-284`
  (`"agent_set_model_request requires provider+modelId and broadcasts the model"`) — a session
  stub that *does* implement `setProviderModel` correctly broadcasts `agent_update({model})`.
- **Live proof `session.model` reconciliation reaches every reader** (step 4: the button and the
  StatusBar both update from the same store write).
Together these cover every link in the chain individually; only the single live end-to-end run
against a real Pi process is unverified in this sandbox.

## Acceptance criteria
- [x] A model button renders left of the composer textarea (first child of `.composer`) —
  screenshot-confirmed.
- [x] Selecting a model updates the button label immediately (optimistic) — confirmed live.
- [x] With a bound agent, selection issues `agent_set_model_request` — confirmed live via daemon
  log; full broadcast-reconciliation success path confirmed via the existing
  `slash-command-ops.test.ts` server test rather than a live Pi run (see limitation above,
  TODO(verify) carried to task-005).
- [x] With no bound agent (fresh session), selection updates the local button label only, no RPC —
  confirmed live (no `agent_set_model_request` log entry until after an agent was bound).
- [x] Existing send/steer/stop behavior is unchanged — full test suite green (753/753); the smoke
  test itself sent a message and received the mock echo successfully.
- [x] `npm run build:web-client` and `npm run typecheck` pass.

## Follow-ups / TODO(verify)
- The full success-path broadcast reconciliation (`agent_set_model_request` → `setProviderModel` →
  `agent_update` → `session.model` update → StatusBar/button reflect it) has not been exercised
  against a live `pi` provider process in this sandbox (no Pi CLI credentials configured). Carried
  to task-005 in case credentials become available; otherwise this remains a documented gap, not a
  code defect — every individual link in the chain is independently verified (see above).
