# Task 001 — `PiStudioClient` extension-UI surface: two subscriptions, two RPCs, `AgentUiError` — Summary

- **Sprint:** sprint-067-extension-ui-sdk
- **Completed:** 2026-08-21
- **Status:** done

## What was implemented

Gave `PiStudioClient` the five members that make sprint-066's `agent_ui_*` daemon-side family
reachable at all: `onAgentUiRequest`, `onAgentUiResolved`, `respondToUi`, `listAgentUi`,
`extensionUiAvailable`. Added the supporting types/errors (`AgentUiEventMeta`,
`AgentUiRespondResult`, `AgentUiError`) and four exported type guards: `isAgentUiRequest` /
`isAgentUiResolved` for the two subscriptions, plus `isAgentArchived` / `isAgentDeleted` for the two
agent-lifecycle messages task-003 will prune extension-UI state on.

The error convention splits as specified: `respondToUi` returns `AgentUiRespondResult` (a
`not_found` from another client winning the answer race is a normal outcome, not exceptional) while
`listAgentUi` throws `AgentUiError` (a failed snapshot is genuinely exceptional). `respondToUi`
forwards the daemon's error string verbatim rather than relabelling it, per the scope's explicit
instruction not to invent an `already_resolved` alias for a reason the client cannot actually
distinguish.

`isAgentArchived`/`isAgentDeleted` are deliberately not wired to `onAgentUpdate`: verified against
`agent-manager.ts` that `archiveAgent`/`deleteAgent` call `broadcastArchived`/`broadcastDeleted`
exclusively and never the `agent_update`-emitting `broadcast(record)` path, so a pruner built on
`onAgentUpdate` would silently never fire. No `onAgentArchived`/`onAgentDeleted` facade subscription
was added — these are pre-existing lifecycle events this scope only observes, not part of the
`agent_ui_*` family it owns.

## Files created / changed

| File | Change |
|---|---|
| `packages/client/src/pistudio-client.ts` | Added `AgentUiEventMeta`, `AgentUiRespondResult`, `AgentUiError`, `AgentArchivedMessage`, `AgentDeletedMessage`, four guards, and five `PiStudioClient` methods |
| `packages/client/src/pistudio-client.test.ts` | New `describe("PiStudioClient — extension UI SDK surface (sprint-067/task-001)")` block (13 tests); scripted-daemon `respond()` switch gained bypass arms for `agent_ui_respond_request`/`agent_ui_list_request` so tests drive responses manually, same convention as the `provider_auth_*` family |

No `packages/client/src/index.ts` change was required — it already re-exports
`./pistudio-client.js` wholesale, verified by importing the new guards/class through `./index.js` in
a test.

## How it satisfies the scope

Maps directly to `swe/features/extension-ui-client-sdk.md` § Public contract, § Capability gating,
§ Error convention, and task-001's own § What to build. `AgentUiEventMeta` deliberately does not
reuse `AgentStreamEventMeta`'s daemon `timestamp`/`seq` shape — it carries a local `receivedAt:
number` stamped by the SDK, per the scope's § Timeout display rationale (the daemon may be clock-
skewed relative to the client). No deviations from the task's written contract.

## Build & test results

```
$ npx tsc -b --force
(no output — clean)

$ npx oxlint packages/client/src/pistudio-client.ts packages/client/src/pistudio-client.test.ts
(no output — clean)

$ npx oxfmt --check packages/client/src/pistudio-client.ts packages/client/src/pistudio-client.test.ts
All matched files use the correct format.

$ npx vitest run packages/client/src/pistudio-client.test.ts
 Test Files  1 passed (1)
      Tests  43 passed (43)
```

## Acceptance criteria

- [x] All five members exist on `PiStudioClient`; `AgentUiEventMeta`, `AgentUiRespondResult`,
      `AgentUiError`, `isAgentUiRequest`, `isAgentUiResolved`, `isAgentArchived`, `isAgentDeleted`
      are exported and reachable from `@av-pi-studio/client`'s root export (verified by importing
      through `./index.js` in "all five facade members and the four guards/error class are
      reachable from the package root").
- [x] `respondToUi` resolves `{ ok: false, reason: "not_found" }` without throwing (verified).
- [x] `respondToUi` forwards an undocumented error string verbatim (verified with
      `"surface_gone_mid_flight"`).
- [x] `respondToUi` resolves `{ ok: true }` on `{ ok: true }`, and rejects when the transport raises
      `RpcError` (both verified as separate tests).
- [x] `listAgentUi()` throws `AgentUiError` on `payload.ok === false`, carrying the daemon's
      message (verified via `.rejects.toThrow` + `.rejects.toBeInstanceOf`).
- [x] `listAgentUi("agent-1")` sends `agentId`; `listAgentUi()` omits the key entirely (verified).
- [x] `onAgentUiRequest` fires once per matching push with a finite local `meta.receivedAt`, ignores
      non-matching session messages, and stops firing after its unsubscribe thunk (verified).
- [x] `extensionUiAvailable()` is `true` only when the handshake advertised `features.extensionUi`
      truthy, both directions asserted.
- [x] All four guards reject a same-`type` message missing `requestId`/`agentId`.
- [x] `isAgentArchived` accepts `archivedAt` present and absent; `isAgentDeleted` accepts its shape;
      neither accepts the other's `type`; neither accepts an `agent_update` message.

## Follow-ups / TODO(verify)

- None. task-002 (pure reducer) and task-003 (controller, which consumes `isAgentArchived`/
  `isAgentDeleted` via `client.connection.onSessionMessage`) build directly on this surface.
