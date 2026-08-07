# Task 004 — Mount `ModelMenu` in the Composer and wire model selection

- **Sprint:** sprint-043-model-selector
- **Status:** done
- **Estimated size:** S
- **Depends on:** task-003

## Goal
Place the `ModelMenu` at the left of the composer input and wire selection to change the agent's
model server-side with an optimistic local update.

## Background / why
The composer already reads its session from the store and issues RPCs; this task adds the model
control as the first child of the composer row (visually left of the textarea) and connects it to
the fully-wired `setModel` path. `session.model` already flows into the StatusBar and updates live
via the `agent_update({model})` broadcast, so the optimistic set is confirmed by the server without
extra plumbing.

## Scope references
- `clean-room-scope/features/composer-ui.md` § toolbar controls, § layout
- `clean-room-scope/features/provider-usage.md` § model selection
- `packages/web-client/AGENTS.md` § features/chat, § stores/session-store

## What to build
- **`packages/web-client/src/features/chat/Composer.tsx`**:
  - The component already reads `session = useSessionStore((s) => s.sessions[sessionId])`
    (`~line 80`), giving `session.model` and `session.agentId`.
  - Insert `<ModelMenu currentModel={session.model} provider="pi" onSelect={handleSelectModel} />`
    as the **first child** of `<div className={styles.composer}>` — before
    `<div className={styles.inputArea}>` (currently `~line 263-264`) so it sits left of the textarea.
  - Add `handleSelectModel`:
    ```ts
    const handleSelectModel = useCallback(async (modelId: string) => {
      useSessionStore.getState().setModel(sessionId, modelId); // optimistic
      if (!session.agentId) return;                            // no bound agent yet: local only
      try {
        await client.agent(session.agentId).setModel("pi", modelId);
      } catch {
        // optional: surface via the existing toast helper if present
      }
    }, [session.agentId, sessionId, client]);
    ```
  - Reuse the composer's existing `client` accessor (the one it already uses for send/steer) — do
    not introduce a new connection.
- **`packages/web-client/src/features/chat/Composer.module.css`**:
  - Add `.modelBtn { flex-shrink: 0; max-width: 180px; overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; }` (mirrors the existing `.attachBtn { flex-shrink: 0; }` convention).
    (If `.modelBtn` is defined in `ModelMenu.module.css` per task-003, keep it there and skip this;
    do not duplicate.)

`client.agent(agentId).setModel("pi", modelId)` is fully wired: `pistudio-client.ts:375-381` →
`agent_set_model_request` → server `handleSetModel` (`slash-command-operations.ts:205-220`) which
calls `session.setProviderModel` and broadcasts `agent_update({model})`. The existing
`use-session-restore.ts` listener reconciles `session.model` across clients.

## Out of scope
- Threading the chosen model into agent creation. A brand-new session (`agentId === null`) stores the
  pick locally only; when its agent is later created it uses Pi's own default model (Pi-Studio does
  not pass `config.model` to the Pi provider). This is display-only until the user re-selects after
  the agent binds — do NOT modify the create path.
- Any change to send/steer/stop logic or the StatusBar.

## Acceptance criteria
- [ ] A model button renders left of the composer textarea (first child of `.composer`).
- [ ] Selecting a model updates the button label immediately (optimistic).
- [ ] With a bound agent, selection issues `agent_set_model_request` and the StatusBar model segment
      reflects the change after the `agent_update` broadcast.
- [ ] With no bound agent (fresh session), selection updates the local button label only, no RPC.
- [ ] Existing send/steer/stop behavior is unchanged.
- [ ] `npm run build:web-client` and `npm run typecheck` pass.

## Test / verification plan
- Build + typecheck: `npm run build:web-client` and `npm run typecheck` pass.
- Full manual smoke is task-005; here confirm the button appears in the composer layout and that a
  unit/interaction test (if the composer has one) still passes:
  `npx vitest run packages/web-client/src/features/chat`.

## Notes
- The button re-renders on `session.model` changes because it reads the store selector — no manual
  refresh needed.
