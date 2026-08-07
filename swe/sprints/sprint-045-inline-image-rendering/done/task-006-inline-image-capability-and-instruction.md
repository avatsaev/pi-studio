# Task 006 — `inline_image_markdown` capability + daemon-composed agent instruction

- **Sprint:** sprint-045-inline-image-rendering
- **Status:** backlog
- **Estimated size:** S
- **Depends on:** task-005

## Goal
Teach the agent to emit markdown images — but only for clients that can actually render them. The
web-client advertises a new capability in its handshake; the daemon appends a short image-rendering
instruction to the agent session's system prompt when the creating client advertised it.

## Background / why
Every piece of plumbing already exists; the only missing link is that the agent-creation handler throws
away the connection it was called on.

- `CLIENT_CAPS` (`packages/protocol/src/client-capabilities.ts:19-26`) is the client→daemon flag
  registry, read only through `supports(caps, flag)` (`:86-91`). Adding a key is purely additive.
- The web-client currently advertises **none**: `capabilities: {}` at
  `packages/web-client/src/lib/connection/connection-store.ts:84`, sent in the `hello` frame by
  `packages/client/src/daemon-client.ts:154-162`.
- The daemon stores them per connection and already exposes the gate:
  `Session.capabilities` + `Session.supports(flag)` (`packages/server/src/ws/session.ts:13,31-33`).
- `RpcHandlerContext` carries that session on **every** dispatch
  (`packages/server/src/ws/router.ts:17-20`) — but `AgentService.registerHandlers` passes only
  `ctx.message` (`packages/server/src/agent/agent-service.ts:112-117`), so nothing in the creation path
  can see it today.
- `handleCreate` persists `config` verbatim into the record (`agent-service.ts:152`), and
  `AgentSessionConfig.systemPrompt` (`packages/protocol/src/messages.ts:155`,
  `packages/server/src/persistence/entity-schemas.ts:57`) already flows to
  `--append-system-prompt` at spawn (`providers/pi/agent.ts:494`).

Gating on the capability rather than on `clientType === "browser"` is deliberate: "renders inline
markdown images" is a property of the rendering surface, not a client identity, and a future mobile
client opts in by flipping one flag. (It also sidesteps the fact that the Electron desktop shell sends
`clientType: "browser"` too — correct here, but for the wrong reason.)

## Scope references
- `clean-room-scope/features/inline-image-rendering.md` § Public Contract → Capability flag, Agent
  instruction
- `clean-room-scope/features/inline-image-rendering.md` § Known Limitations (spawn-time binding —
  accepted, document it in code)
- `clean-room-scope/architecture/websocket-protocol.md` § Capability flags / Compatibility rules
- `clean-room-scope/features/agent-sessions.md` § Create

## What to build
- **`packages/protocol/src/client-capabilities.ts`** — append to `CLIENT_CAPS`:
  ```ts
  /** Client renders markdown images (`![alt](path)`) whose target is a local filesystem path. */
  inline_image_markdown: "inline_image_markdown",
  ```
  Append-only; touch nothing else in the registry.
- **`packages/web-client/src/lib/connection/connection-store.ts:84`** —
  `capabilities: { [CLIENT_CAPS.inline_image_markdown]: true }`. Import the constant rather than
  hard-coding the string.
- **`packages/server/src/agent/agent-service.ts`**:
  - `registerHandlers` passes `ctx.session` into `handleCreate` (third parameter, or an options object —
    match the file's existing style). `handleSendPrompt` is **not** changed; the instruction is a
    create-time concern only.
  - `handleCreate` gains a new signature parameter typed `Session | undefined` so the many existing
    test call sites (`create-run.test.ts`, `session-ops.test.ts`, `slash-command-ops.test.ts`,
    `fetch-timeline.test.ts` all call `handleCreate(msg, () => [])` positionally) keep compiling
    without edits.
  - Before building the record, when `session?.supports(CLIENT_CAPS.inline_image_markdown)`:
    append `INLINE_IMAGE_INSTRUCTIONS` to `config.systemPrompt`, separated by a blank line. If the
    caller supplied its own prompt, the instruction goes **after** it; the caller's text is never
    replaced or reordered. Build a new config object rather than mutating the incoming message's.
- **`packages/server/src/agent/inline-image-instructions.ts`** (new) — the instruction text as one
  exported constant, so it is greppable, testable by identity, and versionable in one place. Required
  properties (exact wording is not contractual): states that the session's output is rendered in a
  surface that displays markdown images; instructs `![alt](path)` for images the agent creates or
  references; states `path` may be workspace-relative or absolute; constrains it to files that actually
  exist. A handful of lines — it rides in the context for the session's entire life.
  Include a header comment recording the accepted limitation: the instruction is bound at **spawn
  time**, so a CLI-created session opened later in the browser will not have it, and the degradation is
  benign in both directions (see the scope's § Known Limitations for the full reasoning and why
  per-turn injection is not available).

## Out of scope
- Any per-turn / per-message context injection. The turn's `prompt` string is dual-purpose (provider
  message text *and* the timeline's visible `user_message.text`), so there is no hidden-context channel
  — changing that is a much larger contract change and is explicitly not in this sprint.
- Recomposing the prompt when a *different* client later attaches to an existing session.
- `handleSendPrompt`, `steer`, `follow_up`, or resume paths composing anything.
- Advertising the flag from the CLI or MCP client.
- A `SERVER_FEATURES` flag — this is a client→daemon capability, not a daemon feature announcement.

## Acceptance criteria
- [ ] A `create_agent_request` arriving on a connection that advertised `inline_image_markdown` produces
      a persisted record whose `config.systemPrompt` ends with the instruction block.
- [ ] The same request on a connection that did **not** advertise it produces a record with
      `config.systemPrompt` untouched (absent stays absent).
- [ ] A caller-supplied `config.systemPrompt` is preserved verbatim and the instruction is appended
      after it — never replaced, never prepended.
- [ ] The spawned `pi` process receives the composed value via `--append-system-prompt`.
- [ ] After a daemon restart, resuming that agent still spawns with the composed prompt (this is what
      task-005 unblocks).
- [ ] Existing `handleCreate` call sites in the server test suite compile and pass unchanged.
- [ ] A CLI-created session's record has no instruction.
- [ ] `npm run build` and `npm run typecheck` pass.

## Test / verification plan
- Unit: `packages/server/src/agent/create-run.test.ts` — add cases passing a fake `Session`-shaped
  object with and without the capability (only `supports(flag)` is needed), asserting the persisted
  record's `config.systemPrompt` in both directions plus the caller-supplied-prompt append case.
- Unit: `packages/protocol/src/` — if a test enumerates `CLIENT_CAPS`, extend it; otherwise no protocol
  test is needed for a constant addition.
- Integration: `packages/server/src/daemon/bootstrap.test.ts` — connect with
  `capabilities: { inline_image_markdown: true }` in `hello`, create an agent, and assert the persisted
  record on disk carries the instruction. This is the one that proves the whole hello→session→handler
  chain, which is the part that does not exist today.
- Run: `npx vitest run packages/server/src/agent packages/server/src/daemon/bootstrap.test.ts`.

## Notes
- Keep the instruction short. It is prepended to every turn's context for the life of the session; a
  long block is a permanent token tax on every message.
- `CLIENT_CAPS` entries carry no `COMPAT(...)` tag today (only `SERVER_FEATURES` does, via
  `SERVER_FEATURE_COMPAT`). Follow the existing convention — do not invent a client-side compat table.
- The web-client change is one line but it is the load-bearing one: without it the daemon never sees the
  flag and every acceptance criterion above reads as "not advertised".
