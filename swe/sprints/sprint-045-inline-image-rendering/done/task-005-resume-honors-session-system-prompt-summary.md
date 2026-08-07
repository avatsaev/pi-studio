# Task 005 — Session resume must honor the persisted per-session system prompt — Summary

- **Sprint:** sprint-045-inline-image-rendering
- **Completed:** 2026-07-29
- **Status:** done

## What was implemented

- **`packages/server/src/agent/providers/pi/agent.ts`** — `resumeSession` (line ~532) now builds its Pi spawn args with `appendSystemPrompt: overrides?.systemPrompt ?? this.deps.appendSystemPrompt` instead of always using `this.deps.appendSystemPrompt`. This mirrors `createSession` (line ~494), ensuring that a persisted session's per-session system prompt is honored on resume after a daemon restart or when resuming a deferred draft.
- Added a docstring note in both `createSession` and `resumeSession` stating they must stay in agreement on systemPrompt handling (prevent future regressions).

## Files created / changed

| File | Change |
|------|--------|
| `packages/server/src/agent/providers/pi/agent.ts` | Modified — `resumeSession` line ~532 now uses `overrides?.systemPrompt ?? this.deps.appendSystemPrompt` |

## How it satisfies the scope

- **`clean-room-scope/features/inline-image-rendering.md` § Known Limitations** — "Pre-existing defect this feature exposes": Session resume rebuilds the provider process using only the daemon-wide default appended system prompt, dropping the per-session system prompt the record carries. Fixed: `resumeSession` now honors `overrides.systemPrompt` (the persisted config passed from the caller).
- **`clean-room-scope/features/agent-providers.md`** — Pi provider create/resume parity on system-prompt handling.

## Build & test results

```
$ npx vitest run packages/server/src/agent/providers/pi/pi-adapter.test.ts
 ✓ packages/server/src/agent/providers/pi/pi-adapter.test.ts (40 tests) 9ms

 Test Files  1 passed (1)
      Tests  40 passed (40)

$ npm run build:server
> tsc -b packages/server && chmod +x packages/server/dist/daemon/main.js

$ npm run typecheck
> tsc -b
(clean exit, no errors)
```

## Acceptance criteria

- [x] Resuming a session whose persisted `config.systemPrompt` is set spawns `pi` with `--append-system-prompt <that value>`, not the daemon default — verified by `"resumeSession honors per-session systemPrompt from overrides (task-005)"` test.
- [x] Resuming a session with no per-session prompt still uses `deps.appendSystemPrompt` (no regression) — verified by `"resumeSession falls back to deps.appendSystemPrompt when overrides has no systemPrompt (task-005)"` test.
- [x] Resuming a session with neither set passes no `--append-system-prompt` flag at all — verified by `"resumeSession passes no --append-system-prompt when neither overrides nor deps has systemPrompt (task-005)"` test.
- [x] `topLevel`'s argv is unchanged — topLevel (line ~606) continues to use `this.deps.appendSystemPrompt` only (correct, no session config).
- [x] `npm run build:server` and `npm run typecheck` pass.

## Follow-ups / notes

- **`importSession` inherits the fix for free:** The docstring at line ~520 notes that `importSession` shares the exact resume path (line 662), so it now also honors per-session system prompts on import.
- **Caller (`spawnOrResumeSession`) does not yet forward `record.config`:** `packages/server/src/agent/agent-service.ts:81` calls `resumeSession(handle, { cwd }, { cwd })` without passing the full `record.config` — it only passes `{ cwd }`. Per task-005's out-of-scope note, this is not expanded here; the resumeSession fix is in place for when the caller is updated. The `record.config` object itself includes `systemPrompt`, and once the caller forwards it via `overrides`, the persisted value will flow through. This is documented here so the change is not missed later.
