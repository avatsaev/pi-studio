# Task 001 — Remove the dead rewind surface

- **Sprint:** sprint-071-conversation-fork-daemon
- **Status:** backlog
- **Type:** refactor
- **Area:** server/agent, protocol/capabilities
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal

Delete the half-built rewind RPC surface that `features/conversation-fork.md` supersedes, so the
daemon stops advertising a capability it never implemented and the wrong truncation primitive is
gone before the right one lands in task-002.

## Context / why

`registerRewindHandler` (`rewind-rpc.ts`, sprint-015) is **never called** from either bootstrap, yet
`bootstrap.ts:798` and `ws-server.ts:61` advertise every `SERVER_FEATURES` key as `true` — so
`server_info.features.rewind` is `true` while an actual `agent.rewind.request` returns
`unknown_message_type`. Its `revertFilesSince` dependency was never built, and its conversation mode
truncated only the daemon timeline without telling the `pi` process anything (the agent would still
remember the "rewound" turns). Fork replaces it provider-natively.

Doing the removal **first** keeps the build green: `AgentTimelineStore.truncateBeforeMessage`'s only
caller is `rewind-rpc.ts`, so both must go in the same task.

## Scope references

- `swe/features/conversation-fork.md` § Relationship to the rewind RPC (decision), § Non-goals
- `packages/server/src/agent/rewind-rpc.ts` (delete)
- `packages/server/src/agent/rewind-rpc.test.ts` (delete)
- `packages/server/src/agent/timeline-store.ts:217` — `truncateBeforeMessage` (delete)
- `packages/protocol/src/client-capabilities.ts:46,79-80` — `SERVER_FEATURES.rewind` + its COMPAT entry
- `packages/protocol/src/client-capabilities.test.ts:30,57-59` — expected-keys list + `supports()` samples

## What to build

- Delete `rewind-rpc.ts` and `rewind-rpc.test.ts`.
- Delete `AgentTimelineStore.truncateBeforeMessage` and the `describe("TimelineStore.truncateBeforeMessage")`
  block that lives in `rewind-rpc.test.ts` (it goes with the file).
- Remove `rewind: "rewind"` from `SERVER_FEATURES` and its `SERVER_FEATURE_COMPAT` entry.
- Update `client-capabilities.test.ts`: drop `"rewind"` from the expected sorted key list, and
  rewrite the three `supports()` assertions at :57-59 that use `"rewind"` as an arbitrary sample key
  to use a surviving key instead (e.g. `providersSnapshot`) — they are testing `supports()`, not
  rewind, so keep the assertions and just change the sample.

**Explicitly keep** (both surfaces are append-only, per the spec):

- `agent.rewind.*` schemas in `packages/protocol/src/messages.ts:402-431` (`rewindModeSchema`,
  `agentRewindRequestSchema`, `agentRewindResponseSchema`).
- `supportsRewindConversation/Files/Both` in `packages/protocol/src/provider-manifest.ts:26-30`.

## Out of scope

- `resetTimeline` and the `forkTimelineSync` flag (task-002).
- Any `handleFork` change (task-003).

## Acceptance criteria

- [ ] `server_info.features` no longer contains `rewind` (neither bootstrap advertises it).
- [ ] `rewind-rpc.ts`, `rewind-rpc.test.ts` and `truncateBeforeMessage` no longer exist anywhere in
      the repo.
- [ ] `agent.rewind.*` schemas and `supportsRewind*` manifest flags are still exported and unchanged.
- [ ] No remaining references to the deleted symbols (no dead imports).

## Test / verification plan

- Build: `npm run build:protocol && npm run build:server` succeeds.
- Tests: `npx vitest run packages/protocol packages/server/src/agent` — all pass; the
  `client-capabilities` key-list test reflects the removal.
- Grep check: searching `truncateBeforeMessage|registerRewindHandler|rewind-rpc` returns no hits in
  `packages/`.
- Grep check: `agentRewindRequestSchema` and `supportsRewindConversation` still present in
  `packages/protocol/src`.
- Lint: `npm run lint` clean for touched files; `npx oxfmt <changed files>` (scoped, never
  project-wide).

## Notes

Feature flags are daemon→client advertisements, not wire schema — removing one means "unsupported",
which has been the truth since day one, and no client ever consumed it. This is why the removal is
safe without a protocol version bump.
