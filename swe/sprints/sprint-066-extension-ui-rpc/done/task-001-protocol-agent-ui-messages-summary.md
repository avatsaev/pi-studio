# Task 001 — Protocol: `agent_ui_*` schemas + `extensionUi` / `supportsExtensionUi` flags — Summary

- **Sprint:** sprint-066-extension-ui-rpc
- **Completed:** 2026-08-20
- **Status:** done

## What was implemented

Added the generic extension-UI wire family to `packages/protocol`: two carried shapes
(`agentUiPendingRequestSchema`, `agentUiSurfaceSchema`), two agent-scoped broadcast pushes
(`agentUiRequestSchema`, `agentUiResolvedSchema`, flat/union members like the permission family, not
the `sessionMessageBaseSchema` passthrough family), two request/response RPC pairs
(`agent_ui_respond_request/_response`, `agent_ui_list_request/_response`, response bodies wrapped in
`payload` per the `agentRewindResponseSchema` convention), and the permissive answer body
`agentUiResponseSchema`. Registered all six message schemas in `sessionMessageSchema`. Added the
`extensionUi` server feature flag (+ `SERVER_FEATURE_COMPAT` entry) and the optional
`supportsExtensionUi` provider capability flag.

`createdAt`/`updatedAt` use the pre-existing `wireTimestampSchema` union (epoch-ms number | ISO
string) rather than a new numeric-only convention, per the plan review finding (F2) that flagged this
during `av-swe implement` prep.

## Files created / changed

| File | Change |
|------|--------|
| `packages/protocol/src/messages.ts` | added the 8 new schemas + types (6 message schemas, `agentUiPendingRequestSchema`, `agentUiSurfaceSchema`), registered the 6 message schemas in `sessionMessageSchema` |
| `packages/protocol/src/client-capabilities.ts` | added `SERVER_FEATURES.extensionUi` + its `SERVER_FEATURE_COMPAT` entry |
| `packages/protocol/src/provider-manifest.ts` | added optional `supportsExtensionUi` to `agentCapabilityFlagsSchema` |
| `packages/protocol/src/session-messages.test.ts` | added imports + a new `describe("extension UI (sprint-066)")` block (9 tests: union round-trip, `ok`-required, surfaceKey/removed/timeoutMs presence/absence, timestamp union, opaque-payload round-trip, response-body permissiveness, open-string reason/error, passthrough round-trip) |
| `packages/protocol/src/client-capabilities.test.ts` | updated the exact `SERVER_FEATURES` key-set assertion from 8 to 9 keys (added `extensionUi`) |
| `packages/protocol/src/provider-manifest.test.ts` | added a test asserting `supportsExtensionUi: true/false/absent` all validate |

## How it satisfies the scope

Maps directly to `swe/features/extension-ui-rpc.md` § Public contract (wire messages table, the three
interfaces), § Registration style (broadcast pushes as union members, not the subscription-passthrough
family), § Capability flags, § Error convention (open strings for `reason`/`error`). No server handler,
service, provider, or bootstrap wiring was touched (explicitly out of scope; tasks 002-005).

## Build & test results

```
$ npm run build:protocol
tsc -b packages/protocol
(success)

$ npm run clean && npm run typecheck   # forced full rebuild, not incremental
tsc -b
(success, zero errors)

$ npm run build                        # full monorepo build (protocol → … → cli)
(success — caught and fixed a self-inflicted regression: an earlier corrective edit accidentally
 dropped `hasNewer: z.boolean()` from the pre-existing `fetchAgentTimelineResponseSchema`, which broke
 packages/web-client's tsc -b. Restored the field; full build re-run green.)

$ npx oxlint <changed files> && npx oxfmt --check <changed files>
(clean; oxfmt found 2 formatting issues, fixed via scoped `npx oxfmt <files>`, re-verified clean)

$ npm run lint                         # full monorepo lint
exit 0, 0 errors (pre-existing warnings only, none introduced by this task — verified via
`git stash` diff that every warning present in changed files pre-dates this change)

$ npx vitest run packages/protocol/src
Test Files  10 passed (10)
     Tests  108 passed (108)

$ npm test                             # full monorepo suite
Test Files  168 passed (168)
     Tests  2117 passed (2117)
```

## Acceptance criteria

- [x] All six message schemas plus `agentUiPendingRequestSchema`, `agentUiSurfaceSchema` and
      `agentUiResponseSchema` exist, exported with inferred types, six message schemas are members of
      `sessionMessageSchema` — verified by the union round-trip test.
- [x] Both response schemas require `ok` under `payload` — verified by the missing-`ok` rejection test.
- [x] `agent_ui_request` validates with `surfaceKey`/`removed`/`timeoutMs` all absent and all present —
      verified explicitly.
- [x] `createdAt`/`updatedAt` accept both epoch-ms number and ISO string — verified explicitly on both
      `agentUiRequestSchema` and `agentUiSurfaceSchema`.
- [x] `payload` accepts an arbitrary nested record and round-trips byte-for-byte — verified via
      `toEqual` on parsed output for both the broadcast and the pending-request shape.
- [x] `agentUiResponseSchema` accepts `{}`, `{value}`, `{confirmed}`, `{cancelled}`, and an unknown
      extra field — verified, all pass.
- [x] `reason`/`error` accept an undocumented string value — verified on `agentUiResolvedSchema.reason`
      and `agentUiRespondResponseSchema.payload.error`.
- [x] `SERVER_FEATURES.extensionUi` + `SERVER_FEATURE_COMPAT` entry exist; exact-key-set assertion
      updated to 9 keys — verified, `client-capabilities.test.ts` passes.
- [x] `agentCapabilityFlagsSchema` accepts `supportsExtensionUi: true/false/absent` — verified via a
      new explicit test in `provider-manifest.test.ts`.

## Follow-ups / TODO(verify)

- None for this task. Server handler, service, provider adapter, and bootstrap wiring are task-002
  through task-005; this task is protocol-only by design.
