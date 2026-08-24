# Task 003 — Summary: Persistence chain (replay, clamp write-back, projections, default)

- **Sprint:** sprint-070-thinking-level-selector
- **Status:** done

## What was built (all four links of the chain)

- **Replay** — `agent-service.ts` `spawnOrResumeSession`: on first spawn only, after the model
  replay, `config.thinkingOptionId` → `session.setThinkingOption?.(...)`, skipped when
  undefined (never clobbers Pi's restored/default level); comment documents resume semantics
  (Pi restores from JSONL; write-back keeps config == JSONL).
- **Clamp write-back** — `slash-command-operations.ts` `handleSetModel`/`handleCycleModel`:
  after the model persist, read `getRuntimeInfo().thinkingLevel` (fresh post-switch via
  task-001's `get_state` re-read), `persistThinking` + include `thinkingLevel` in the existing
  `broadcastAgentUpdate` — record and every client converge to the effective level.
- **Single write path** — `session-operations.ts` `handleUpdate`: the `thinkingOptionId`
  branch applies via `setThinkingOption` when present, then persists/broadcasts the EFFECTIVE
  level (`getRuntimeInfo().thinkingLevel ?? requested`); providers without the method keep the
  old pin-only behavior. CLI `agent update --thinking` now coherent with the dedicated RPC.
- **Projection** — both bootstraps' `list_agents`: `thinkingLevel:
  m.session?.getRuntimeInfo().thinkingLevel ?? m.record.config?.thinkingOptionId`
  (live wins over pinned, same shape as `model`).
- **Draft default** — Pi adapter `resolveDefaultModel` carries `thinkingLevel` from the
  `--no-session get_state`; both bootstraps' `defaultModelCache` typed with the extra field
  and `resolve_default_model` responses include `thinkingLevel`; client SDK's
  `ResolveDefaultModelResponse.thinkingLevel` typed (task-004 surface).

## Tests (all passing)

- `session-ops.test.ts`: replay order (model THEN thinking) + skip-when-absent; `update_agent`
  effective-level persist/broadcast + no-op-without-field.
- `slash-command-ops.test.ts`: set/cycle model write-back tests (stubbed session flips to
  `off` post-switch).
- `bootstrap.test.ts`: `list_agents` reports pinned level for drafts and live clamped level
  once spawned; `resolve_default_model` carries `thinkingLevel: "off"` from the mock and
  caches.

## Commands run (results)

- `npx vitest run packages/protocol packages/server/src/agent packages/server/src/daemon/bootstrap.test.ts`
  → **515 passed (515)**, 37 files.
- `npx tsc -b --force` → clean. `npx oxlint <changed files>` → 0 warnings (two pre-existing
  warnings in changed files fixed: unused `managed` in `handleImport`, hoisted `broadcast` in
  dev-bootstrap). `npx oxfmt --check` → clean.

## Acceptance criteria

- [x] Replay strictly after model; skipped when undefined.
- [x] Live model switch that clamps: record + broadcast carry the clamped level.
- [x] `update_agent_request` thinkingOptionId on a live session: apply + persist effective +
      broadcast (same observable behavior as `agent_set_thinking_request`).
- [x] `list_agents` live-wins-over-pinned.
- [x] `resolve_default_model` includes `thinkingLevel` when reported.

## Docs synced

- `packages/server/AGENTS.md`: thinking-level persistence-chain invariant (four links) +
  write-back probe invariants.

## Follow-ups

None. Client SDK typing completion is task-004; web-client is task-005.
