# Task 005 — Session resume must honor the persisted per-session system prompt

- **Sprint:** sprint-045-inline-image-rendering
- **Status:** backlog
- **Estimated size:** XS
- **Depends on:** none

## Goal
Fix a pre-existing defect: resuming a Pi session drops the per-session system prompt and falls back to
the daemon-wide default, so any `config.systemPrompt` silently vanishes after a daemon restart or on
the first spawn of a deferred draft.

## Background / why
`PiAgentClient.createSession` builds its spawn args with
`appendSystemPrompt: config.systemPrompt ?? this.deps.appendSystemPrompt`
(`packages/server/src/agent/providers/pi/agent.ts:493-495`).

`resumeSession` — same file, `:530-531` — builds them with `appendSystemPrompt:
this.deps.appendSystemPrompt` only, even though it *receives* the persisted config as `overrides`
(`:524`) and uses it for `cwd` at `:529` and for the session's own config at `:539`.

Consequences today:
- A restarted daemon resumes every agent without its per-session system prompt.
- A deferred draft (created with no `initialPrompt`, the web-client's default "New chat" path) reaches
  the provider through `spawnOrResumeSession`, so its very first real spawn can take the resume path.
- `topLevel` (`:606`) has the same shape, but it is a stateless model/mode discovery call with no
  session config, so it is correct as-is — do not change it.

Task-006 composes an image-rendering instruction into `config.systemPrompt`, and that instruction must
survive a restart. Fixing this first makes task-006's persistence criterion actually verifiable.

## Scope references
- `clean-room-scope/features/inline-image-rendering.md` § Known Limitations → "Pre-existing defect this
  feature exposes"
- `clean-room-scope/features/agent-providers.md` § Pi provider (session create/resume)
- `clean-room-scope/architecture/agent-lifecycle.md` § resume

## What to build
- **`packages/server/src/agent/providers/pi/agent.ts`** — `resumeSession` builds its args with
  `appendSystemPrompt: overrides?.systemPrompt ?? this.deps.appendSystemPrompt`, matching
  `createSession`.
- Add a short comment stating that create and resume must stay in agreement, so the next edit to either
  does not reintroduce the divergence.

## Out of scope
- `topLevel` (no session config by design).
- Any change to how `overrides` is assembled by the caller (`spawnOrResumeSession`,
  `agent-service.ts:54-102`) — verify it already forwards the record's `config`, and if it does not,
  report that in the summary rather than expanding this task.
- The `mcpConfigPath` arg (`buildPiArgs`'s other option) — untouched.

## Acceptance criteria
- [ ] Resuming a session whose persisted `config.systemPrompt` is set spawns `pi` with
      `--append-system-prompt <that value>`, not the daemon default.
- [ ] Resuming a session with no per-session prompt still uses `deps.appendSystemPrompt` (no
      regression), and with neither set passes no `--append-system-prompt` flag at all.
- [ ] `topLevel`'s argv is unchanged.
- [ ] `npm run build:server` and `npm run typecheck` pass.

## Test / verification plan
- Unit: extend `packages/server/src/agent/providers/pi/pi-adapter.test.ts` next to the existing
  create-path assertion (`"passes system prompts via --append-system-prompt (not replacing Pi's
  prompt)"`, ~line 355), which already inspects `spawns[0].spawnArgs.args`. Add resume cases using the
  same `clientWithFake()` harness: overrides with a `systemPrompt`, overrides without one plus a
  configured `deps.appendSystemPrompt`, and neither.
- Run: `npx vitest run packages/server/src/agent/providers/pi/pi-adapter.test.ts`.

## Notes
- One-line behavioral change; the value is in the test, which is what stops it regressing.
- Worth confirming while here whether `importSession` shares the resume path (the `resumeSession` doc
  comment at `:519-520` says it does) — if so, it inherits the fix for free; note it in the summary.
