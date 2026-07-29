# Task 006 — `inline_image_markdown` capability + daemon-composed agent instruction — Summary

- **Sprint:** sprint-045-inline-image-rendering
- **Completed:** 2026-07-29
- **Status:** done

## What was implemented

- **`packages/protocol/src/client-capabilities.ts`** — appended `inline_image_markdown` to
  `CLIENT_CAPS` (client → daemon, advertised in `hello.capabilities`). No `COMPAT` tag, matching
  every other `CLIENT_CAPS` entry (only `SERVER_FEATURES` carries those).
- **`packages/web-client/src/lib/connection/connection-store.ts`** — `connect()`'s
  `new DaemonClient({...})` call now sends `capabilities: { [CLIENT_CAPS.inline_image_markdown]: true }`
  instead of `{}`, importing the constant from `@av-pi-studio/protocol` rather than hard-coding the
  string.
- **`packages/server/src/agent/inline-image-instructions.ts`** (new) — exports
  `INLINE_IMAGE_INSTRUCTIONS`, a short constant instructing the agent to use `![alt](path)` for
  images it creates/references, that `path` may be workspace-relative, absolute, or `~`-relative,
  and that it must point at a file that actually exists. Header comment records the accepted
  spawn-time-binding limitation (a CLI-created session opened later in a capable browser never
  gets the instruction; benign in both directions).
- **`packages/server/src/agent/agent-service.ts`**:
  - `registerHandlers` now passes `ctx.session` as `handleCreate`'s third argument
    (`this.handleCreate(ctx.message, getActiveSessions, ctx.session)`). `handleSendPrompt` is
    unchanged — the instruction is a create-time-only concern.
  - `handleCreate(msg, getSessions, wsSession?: Session)` — named `wsSession` (not `session`) to
    avoid colliding with the existing local `session: AgentSession` variable used later in the same
    function for the spawned provider session. Before building the persisted `record`, if
    `wsSession?.supports(CLIENT_CAPS.inline_image_markdown)`, builds a new `effectiveConfig` object
    (`{ ...config, systemPrompt: [config.systemPrompt, INLINE_IMAGE_INSTRUCTIONS].filter(Boolean).join("\n\n") }`)
    — never mutates the incoming `msg.config`. `record.config` uses `effectiveConfig`.
  - **Fixed a gap the task's own guidance surfaced**: the eager-spawn path (`client.createSession`,
    used whenever the create request carries an `initialPrompt`) was still spreading the raw
    `config`, not `effectiveConfig`, into the provider call — meaning the persisted record would
    carry the composed instruction but the actually-spawned `pi` process's
    `--append-system-prompt` would not. Fixed to spread `effectiveConfig` there too, so both the
    deferred-draft path (record only, spawned later by `spawnOrResumeSession` off `record.config`)
    and the eager path get the same composed prompt.

## Files created / changed

| File | Change |
|------|--------|
| `packages/protocol/src/client-capabilities.ts` | added `inline_image_markdown` to `CLIENT_CAPS` |
| `packages/web-client/src/lib/connection/connection-store.ts` | advertises the capability in `hello` |
| `packages/server/src/agent/inline-image-instructions.ts` | created — `INLINE_IMAGE_INSTRUCTIONS` |
| `packages/server/src/agent/agent-service.ts` | `registerHandlers` threads `ctx.session`; `handleCreate` composes `effectiveConfig` and uses it for both the persisted record and the eager-spawn path |
| `packages/server/src/agent/create-run.test.ts` | added 4 unit tests (capability advertised / not advertised / no session at all / caller-supplied-prompt append order) |
| `packages/server/src/daemon/bootstrap.test.ts` | `connect()` gained an optional `capabilities` param (backward compatible — existing calls omit it); added 2 integration tests proving the real `hello` → `Session` → `handleCreate` chain |

## How it satisfies the scope

- `clean-room-scope/features/inline-image-rendering.md` § Public Contract → Capability flag, Agent
  instruction: capability is additive to `CLIENT_CAPS`, gated on a rendering-surface property (not
  `clientType`), instruction is composed only at create time and only for the creating connection.
- § Known Limitations (spawn-time binding): documented in `inline-image-instructions.ts`'s header
  comment exactly as instructed — not treated as a defect to fix.
- Every `handleCreate(msg, () => [])` 2-arg call site across the test suite
  (`create-run.test.ts`, `session-ops.test.ts`, `slash-command-ops.test.ts`, `fetch-timeline.test.ts`)
  and `daemon/bootstrap.ts`'s `createAndPrompt`/`runWorker`/verify-worker call sites continue to
  compile unchanged — `wsSession` is optional and positional, `undefined` is the correct value for
  every CLI/MCP/scheduled-agent caller (none of them has a `Session` at hand, so none of them ever
  gets the instruction, matching "A CLI-created session's record has no instruction").
- Task-005 (already done) is what makes this durable across a daemon restart: `resumeSession` now
  honors `overrides.systemPrompt`, so a resumed session's composed prompt survives — verified by
  the integration test asserting the persisted `AgentRecord.config.systemPrompt`, which is exactly
  what a restart-then-resume would read back.

## Build & test results

```
$ npx vitest run packages/server/src/agent packages/server/src/daemon/bootstrap.test.ts
 Test Files  19 passed (19)
      Tests  201 passed (201)

$ npx tsc -b packages/protocol packages/server
(clean exit, no errors)

$ npm run build
✓ built in 8.46s   (web-client — pre-existing circular-chunk/chunk-size warnings, unrelated)
> tsc -b packages/server && chmod +x packages/server/dist/daemon/main.js
> tsc -b packages/cli && chmod +x packages/cli/dist/cli.js
(all packages build clean)
```

## Acceptance criteria

- [x] A `create_agent_request` on a connection that advertised `inline_image_markdown` produces a
      persisted record whose `config.systemPrompt` ends with the instruction block — integration
      test in `bootstrap.test.ts` (real hello → session → handler chain) + unit test in
      `create-run.test.ts`.
- [x] The same request on a connection that did not advertise it produces a record with
      `config.systemPrompt` untouched (absent stays absent) — both files, both directions covered.
- [x] A caller-supplied `config.systemPrompt` is preserved verbatim and the instruction is appended
      after it, never replaced/prepended — `create-run.test.ts`'s
      `"appends after a caller-supplied prompt..."` test.
- [x] The spawned `pi` process receives the composed value via `--append-system-prompt` — the
      eager-spawn-path fix above (`effectiveConfig` instead of raw `config` at the
      `client.createSession` call) is what makes this true; `MockAgentClient.createSession` in the
      unit tests doesn't assert the argv directly, but `pi-adapter.test.ts` (task-005) already
      proves `createSession`/`resumeSession` correctly turn `config.systemPrompt` into
      `--append-system-prompt`, and this task's fix is exactly "pass the composed value as that
      `config`."
- [x] After a daemon restart, resuming that agent still spawns with the composed prompt — this is
      what task-005 unblocks; the composed value is what's on disk (asserted by the integration
      test), and task-005's `resumeSession` fix reads it back via `overrides.systemPrompt`.
- [x] Existing `handleCreate` call sites in the server test suite compile and pass unchanged — full
      `packages/server/src/agent` + `bootstrap.test.ts` suite green (201/201).
- [x] A CLI-created session's record has no instruction — no `Session` object exists on that path,
      so `wsSession` is always `undefined`, so `effectiveConfig === config` unchanged.
- [x] `npm run build` and `npm run typecheck` pass.

## Follow-ups / notes

- The subagent originally assigned this task got stuck in a long unproductive loop of trivial
  `web_search` calls while trying to write the config-composition logic (asking the web for basic
  TypeScript syntax it already knew, instead of just calling `edit`); it was cancelled mid-task.
  Everything it had already landed cleanly (capability flag, `connection-store.ts` one-liner,
  `inline-image-instructions.ts`, the `registerHandlers`/`handleCreate` signature threading) was
  intact and correct, and is reused verbatim here — only the actual instruction-composition logic,
  its tests, and the eager-spawn-path fix were completed in this pass.
