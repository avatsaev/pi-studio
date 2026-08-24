# Feature — Thinking-Level Selector

> Part of: [../MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Dependencies: `agent-providers.md` (provider contract), `agent-sessions.md` (session config /
> deferred drafts), `composer-ui.md` § toolbar controls (the "Thinking | brain-icon badge →
> levels combobox" row), `websocket-protocol` architecture (append-only RPC conventions)

## Purpose

Let a user see and change a session's **thinking level** (Pi's reasoning effort:
`off | minimal | low | medium | high | xhigh | max`) from the web-client composer, with the level
**persisted per session** — surviving page reloads, daemon restarts, and session resumes — and
converging across every connected client. Fixes a live bug as a side effect: `update_agent_request`
(and the CLI's `agent update --thinking`) already accepts `thinkingOptionId`, persists it, and
silently applies nothing, because no provider implements `AgentSession.setThinkingOption`.

## Ground truth about Pi (verified against the bundled `pi --mode rpc`, 2026-08-24)

These facts drive the design; do not re-derive them from memory:

- `set_thinking_level {level}` — applies a level; Pi **clamps** to the current model's
  capabilities (`agent-session.js` `_clampThinkingLevel`). Response carries **no data**.
- `get_available_thinking_levels` — authoritative level list for the process's **current model**;
  `["off"]` for non-reasoning models.
- `get_state` — response includes `thinkingLevel` (alongside `model`/`sessionFile`).
- `set_model` response is the bare Model object — it does **NOT** include `thinkingLevel`, even
  though a model switch is exactly when Pi clamps the level (rpc.md § set_model). `cycle_model`'s
  response DOES include it (`{model, thinkingLevel, isScoped}`).
- `get_available_models` returns **raw, full Model objects** (`modelRuntime.getAvailableSnapshot()`,
  rpc-mode.js) — including `reasoning: boolean` and optional `thinkingLevelMap`. The daemon's
  current `listModels` mapping throws these fields away.
- Level derivation from a Model object (pi-ai `models.js` `getSupportedThinkingLevels`, an
  11-line pure function): `!reasoning → ["off"]`; otherwise filter the 7-level ladder by
  `thinkingLevelMap` tristate — an entry of `null` removes the level; `xhigh`/`max` are **opt-in**
  (absent from the map ⇒ excluded); other levels are included unless mapped `null`. NOT importable
  by the daemon — it lives in `@earendil-works/pi-ai/compat`, a nested transitive dependency —
  so the Pi adapter mirrors it in a documented, unit-tested pure function. Any drift self-corrects
  at set time because Pi clamps authoritatively and the daemon writes the effective level back.
- Pi persists thinking-level changes in the session JSONL (`thinking_level_change` entries) and
  restores them on resume. Pi-Studio's replay of `config.thinkingOptionId` deliberately overrides
  that restored value — identical to how model replay already behaves (`spawnOrResumeSession`
  replays unconditionally). With clamp write-back the two sources cannot diverge.

## Public contract

### New RPCs (flat snake_case, real `messages.ts` schemas, mirroring the `agent_set_model` family)

| RPC | Inputs | Outputs | Errors |
|-----|--------|---------|--------|
| `agent_set_thinking_request` | `agentId`, `level` | `agent_set_thinking_response { agentId, level }` — `level` is the **effective** (possibly clamped) level | unknown agent; unsupported provider capability |
| `agent_thinking_levels_request` | `agentId` | `agent_thinking_levels_response { agentId, levels: string[] }` | unknown agent; **no live session** (drafts answer from the model catalogue client-side, see below) |

`agent_set_thinking_request` on a **materialized draft with no live process** pins
`config.thinkingOptionId` and broadcasts, without touching a session — the exact
`handleSetModel` draft branch (`slash-command-operations.ts:273-277`); skipping this branch was a
real, silently-swallowed bug for model picks (sprint-043 corrections).

### Extended existing surfaces (all append-only)

| Surface | Addition |
|---------|----------|
| `list_provider_models` → `ProviderModel` | `reasoning?: boolean`, `thinkingLevels?: string[]` per model (derived by the Pi adapter from the raw Model object) |
| `list_agents` projection | `thinkingLevel: session?.getRuntimeInfo().thinkingLevel ?? record.config?.thinkingOptionId` (live wins over pinned — same shape as `model`) |
| `agent_update` broadcast | `thinkingLevel?: string` — emitted on every explicit set AND on every model change that clamps (set/cycle) |
| `resolve_default_model` response | `thinkingLevel?: string` (the `--no-session get_state` already receives it; daemon-cached alongside model) |
| Server feature flags | `thinkingLevels` capability (precedent: `extensionUi`) |
| Provider contract | `AgentSession.listThinkingLevels?(): Promise<string[]>`; `setThinkingOption` gains real implementations; `ProviderRuntimeInfo.thinkingLevel` gets populated |
| Client SDK | `agent(id).setThinking(level)`, `agent(id).listThinkingLevels()`, `ProviderModel.reasoning/thinkingLevels` typing, `ResolveDefaultModelResponse.thinkingLevel` |

## Behavior & algorithms

### The persistence chain (the core requirement)

```
write   : every explicit pick → persistThinking(agentId, effectiveLevel)
          (draft OR live; same helper serves agent_set_thinking AND update_agent_request's
           thinkingOptionId branch — two write paths, one implementation)
replay  : spawnOrResumeSession → setProviderModel(...) THEN setThinkingOption(config.thinkingOptionId)
          — order is mandatory: Pi clamps thinking against the model, so thinking-first is overwritten
reload  : list_agents carries thinkingLevel → web-client session-store seeds from it
converge: agent_update broadcast carries thinkingLevel → every client's store updates live
```

### Clamp write-back (the correctness rule)

After ANY operation that can change the effective level, the daemon persists and broadcasts the
**effective** value, never the requested one:

```
set_thinking_level(level):
    pi.set_thinking_level(level)          # Pi clamps silently
    effective = pi.get_state().thinkingLevel
    persistThinking(agentId, effective); broadcast(thinkingLevel: effective)

setProviderModel(provider, id):           # Pi adapter
    pi.set_model(...)                     # response has NO thinkingLevel
    state = pi.get_state()                # one in-process RPC; adapter already uses this pattern
    this.thinkingLevel = state.thinkingLevel
    # daemon handleSetModel/handleCycleModel then persist + broadcast the (possibly clamped) level
```

Without write-back: pin `max`, switch to a non-reasoning model → record says `max`, truth is
`off`; dead-session `list_agents` lies and every client displays a level the agent will not use.

### Level discovery (zero new processes)

- **Live session** → `agent_thinking_levels_request` → `get_available_thinking_levels`
  (authoritative, answered by the already-running process).
- **Draft (no process)** → the web client looks the current model up in the **already-fetched**
  `list_provider_models` payload and reads `thinkingLevels` (shared TanStack query — the same
  cache the model picker and composer trigger use). No transient spawn, no daemon cache, no extra
  RPC. A model not in the list (stale/unknown) ⇒ selector shows the 7-level ladder unfiltered;
  Pi clamps at apply time and write-back corrects the display.

### Web-client

- `ThinkingMenu` in the composer's bottom toolbar, **immediately after `ModelMenu`** (model button
  first, thinking button directly to its right in `.toolbarRight`, before the Stop/Send cluster —
  explicit user decision, 2026-08-24). Brain icon (lucide `Brain`) trigger showing the current
  level; popup reuses `MenuContent`/`MenuItem` (7 rows max, checkmark on current, **no search
  input**). Disabled while disconnected, exactly like the model trigger.
- `session-store` gains `thinkingLevel?: string`; seeded from `list_agents` on restore, updated by
  `agent_update` broadcasts (guard beside `hasStringModel` in `use-session-restore.ts`), written
  optimistically on pick (same swallow-errors, stream-is-source-of-truth convention as
  `handleSelectModel`).
- Live-session level lists are queried keyed by `[agentId, model]` so a model change refetches
  automatically; drafts never issue the query (catalogue lookup instead).
- A brand-new draft shows the real default level from `resolve_default_model` (not a placeholder).

## Data & persistence touchpoints

- `AgentRecord.config.thinkingOptionId` — already exists (`entity-schemas.ts`), becomes live.
- No schema migrations: every addition is an optional field on `.passthrough()` schemas.

## Error handling & edge cases

| Condition | Expected behavior |
|-----------|-------------------|
| Set on non-reasoning model | Pi clamps to `off`; response/persist/broadcast all say `off`; UI shows `off` |
| Model change clamps level | Daemon re-reads `get_state`, persists + broadcasts effective level; all clients converge |
| Draft with no process | Pick pins `config.thinkingOptionId` + broadcasts; replayed on first spawn after model |
| Resume of session whose JSONL has a different level | Config replay overrides (documented; consistent with model replay); write-back keeps config == effective |
| Provider without thinking (mock ships a static list; a future provider may omit the methods) | `agent_set_thinking_request` → unsupported-capability rpc_error; selector hidden/disabled when `thinkingLevels` capability or per-model data is absent |
| `config.thinkingOptionId` undefined | Replay skipped entirely — never clobber Pi's own restored/default level with a synthetic value |
| Stream update leaves level unknown client-side | Store field stays `undefined`; trigger shows placeholder; next `list_agents`/broadcast heals |

## Acceptance criteria

- [ ] `pi-studio agent update --thinking high` changes a live session's actual thinking level (bug fix).
- [ ] Picking a level in the composer applies it to the live agent; the response reflects clamping.
- [ ] Picking a level on a never-spawned draft persists it and the first real turn runs with it.
- [ ] Reload the web client → the selector shows the session's persisted level without opening anything.
- [ ] Daemon restart + session resume → the level survives (replayed after model).
- [ ] Switching to a non-reasoning model updates the selector to `off` in **every** connected client without a reload.
- [ ] The level list offered for a live session matches `get_available_thinking_levels`; for a draft it matches the model's `reasoning`/`thinkingLevelMap` derivation.
- [ ] No new process spawns are introduced by discovery (verified: no `--no-session` spawn beyond the pre-existing `resolve_default_model` path).

## TODO(verify)

- Whether `thinkingLevelMap` actually appears on `get_available_models` entries for at least one
  built-in model in the bundled Pi version (the derivation handles absence — base 5 levels for
  `reasoning: true` — but live confirmation belongs in the sprint-close verification).
