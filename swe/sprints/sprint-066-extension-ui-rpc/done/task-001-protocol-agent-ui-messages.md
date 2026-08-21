# Task 001 — Protocol: `agent_ui_*` schemas + `extensionUi` / `supportsExtensionUi` flags

- **Sprint:** sprint-066-extension-ui-rpc
- **Status:** done
- **Type:** feature
- **Area:** packages/protocol (wire contract)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal

Add the generic extension-UI wire family — two broadcast pushes, two request/response pairs, and the
two shapes they carry — plus the `extensionUi` server feature flag and the optional
`supportsExtensionUi` provider capability, so the daemon (tasks 003-004) and any future client can
speak it.

## Context / why

Pi's extension UI is a request/response sub-protocol on stdio (`extension_ui_request` /
`extension_ui_response`). The daemon currently auto-cancels every dialog and drops every
fire-and-forget method, so this family is what makes the traffic reachable by a client at all.

**Two shapes, two registration styles — get this right or the family is mis-modelled.** The pushes
(`agent_ui_request`, `agent_ui_resolved`) are **agent-scoped broadcasts to every client**, exactly
like `agent_permission_request` / `agent_permission_resolved` (`messages.ts:355-370`), so they are
flat (no `payload` wrapper) and they are **union members**. They are *not* the
`sessionMessageBaseSchema` passthrough family (`messages.ts:1209-1215`) — that convention governs
*per-session subscription* pushes (`checkout_status_update`, `file_changed`,
`provider_auth_flow_event`), which these are not. The two RPC pairs follow the ordinary
request/response convention: response bodies go under `payload` (per `agentRewindResponseSchema`),
because `ws/router.ts` stamps `requestId` at the top level and handlers must not set it.

**Opacity lives inside the schema.** `payload: z.record(z.unknown())` keeps the envelope typed while
the extension payload stays future-proof — the daemon never interprets it, and an unknown future Pi
UI method must survive a round-trip untouched.

**`reason` and `error` are open strings, deliberately.** Following s057/t001's lesson (`reason`
typed open so the daemon can extend its taxonomy without narrowing the wire): `reason` documents
`answered` | `cancelled` | `timeout` | `aborted` and `error` documents `not_found` | `unsupported`,
but neither is a `z.enum`. A strict enum here would make a newer daemon emit a value an older client
fails to parse — the same trap that keeps `agentStatusEnum` (`messages.ts:117`) closed to a new
`awaiting_input` member.

## Scope references

- `swe/features/extension-ui-rpc.md` § Public contract (wire messages table, the three interfaces),
  § Registration style, § Capability flags, § Error convention
- `swe/architecture/websocket-protocol.md` § RPC naming, § Capability flags
- `packages/protocol/src/messages.ts` — `agentPermissionRequestSchema` (line 355) as the push model,
  `sessionMessageSchema` union (line 1143), `sessionMessageBaseSchema` (line 1214),
  `agentStatusEnum` (line 117)
- `packages/protocol/src/client-capabilities.ts` — `SERVER_FEATURES` (line 41),
  `SERVER_FEATURE_COMPAT` (line 60)
- `packages/protocol/src/provider-manifest.ts` — `agentCapabilityFlagsSchema` (lines 18-34)
- `packages/protocol/src/client-capabilities.test.ts` — asserts the **exact** `SERVER_FEATURES` key
  set (lines 20-33); it will fail until updated
- `packages/protocol/src/session-messages.test.ts` — per-schema round-trip test conventions

## What to build

Modify `packages/protocol/src/messages.ts`. All new objects `.passthrough()`, all inferred types
exported.

Two carried shapes:

- `agentUiPendingRequestSchema` — `{ requestId, agentId, method, expectsResponse: boolean,
  payload: z.record(z.unknown()), surfaceKey?, timeoutMs?, createdAt: wireTimestampSchema }`
- `agentUiSurfaceSchema` — `{ agentId, method, surfaceKey, payload: z.record(z.unknown()),
  updatedAt: wireTimestampSchema }`

`createdAt`/`updatedAt` use the **existing** `wireTimestampSchema` (`messages.ts:22-25`,
`z.union([z.number(), isoTimestampSchema])`, the type `agent_stream.timestamp` already uses) — do
not pin them to `z.number()`. The daemon emits epoch ms today; the union is the append-only
guarantee that a future daemon may emit ISO strings without narrowing the wire. Inventing a
numeric-only convention beside the existing one is exactly the second-convention trap.

Two broadcast pushes (flat, union members, modelled on `agentPermissionRequestSchema`):

- `agentUiRequestSchema` — `{ type: "agent_ui_request", requestId, agentId, method,
  expectsResponse: boolean, payload, surfaceKey?, removed?: boolean, timeoutMs?, createdAt }`
- `agentUiResolvedSchema` — `{ type: "agent_ui_resolved", requestId, agentId, reason: z.string() }`

Two request/response pairs (responses wrap their body in `payload`, `ok` **required**):

- `agent_ui_respond_request` — `{ requestId, uiRequestId, response: <AgentUiResponse> }` /
  `_response` — `payload: { ok, error? }`
- `agent_ui_list_request` — `{ requestId, agentId? }` / `_response` —
  `payload: { ok, pending: agentUiPendingRequestSchema[], surfaces: agentUiSurfaceSchema[], error? }`

`agentUiResponseSchema` (the answer body) — `{ value?: string, confirmed?: boolean,
cancelled?: boolean }`, `.passthrough()`, **every field optional**. This permissiveness is
deliberate and load-bearing: method→response-shape validation is Pi's business, and a strict union
keyed on `method` would reject a shape a future Pi method introduces, blocking an extension forever
on a response the daemon refused to forward. Add a comment saying so.

Register all six message schemas in the `sessionMessageSchema` discriminated union.

Modify `packages/protocol/src/client-capabilities.ts`:

- Add `extensionUi: "extensionUi"` to `SERVER_FEATURES` (camelCase, matching `providerAuth`).
- Add its `SERVER_FEATURE_COMPAT` entry with the same `COMPAT({...})` shape as its siblings.

No emission code is needed — `ws-server.ts`'s `defaultFeatures()` and `bootstrap.ts`'s relay path
both fold every `SERVER_FEATURES` value into `server_info.features` automatically.

Modify `packages/protocol/src/provider-manifest.ts`:

- Add optional `supportsExtensionUi: z.boolean().optional()` to `agentCapabilityFlagsSchema`.
  Optional + already `.passthrough()` ⇒ no compat risk.

## Out of scope

- Any server handler, service, provider, or bootstrap wiring (tasks 002-005).
- Setting `supportsExtensionUi: true` on `PI_CAPABILITIES` / `MOCK_CAPABILITIES` — task-002 owns the
  provider side.
- Client SDK types and any UI (a sibling scope entirely).
- A new `agentStatusEnum` value — explicitly rejected in the scope as a compat hazard.

## Acceptance criteria

- [x] All six message schemas plus `agentUiPendingRequestSchema`, `agentUiSurfaceSchema` and
      `agentUiResponseSchema` exist, are exported with their inferred types, and the six message
      schemas are members of `sessionMessageSchema`.
- [x] Both response schemas **require** `ok` under `payload`; a payload missing `ok` fails validation.
- [x] `agent_ui_request` validates with `surfaceKey`/`removed`/`timeoutMs` all absent, and with all
      three present.
- [x] `createdAt`/`updatedAt` accept **both** an epoch-ms number and an ISO string
      (`wireTimestampSchema`), asserted explicitly so a later "cleanup" cannot narrow them.
- [x] `payload` accepts an arbitrary nested record and survives a parse round-trip byte-for-byte
      (proving daemon-side opacity).
- [x] `agentUiResponseSchema` accepts `{}`, `{value}`, `{confirmed}`, `{cancelled}`, and an unknown
      extra field (`.passthrough()`), rejecting none of them.
- [x] `reason` and `error` accept an undocumented string value (open-string rule), asserted
      explicitly so a later reader does not "tighten" them into enums.
- [x] `SERVER_FEATURES.extensionUi` and its `SERVER_FEATURE_COMPAT` entry exist; the exact-key-set
      assertion in `client-capabilities.test.ts` is updated from 8 to 9 keys.
- [x] `agentCapabilityFlagsSchema` accepts `supportsExtensionUi: true`, `false`, and absent.

## Test / verification plan

- Build: `npm run build:protocol` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npx oxlint <changed files>` and `npx oxfmt --check <changed files>` clean.
- Tests: extend `packages/protocol/src/session-messages.test.ts` (round-trip + rejection cases for
  each new schema, the opaque-payload round-trip, the open-string `reason`/`error` cases) and update
  `packages/protocol/src/client-capabilities.test.ts`. Run `npx vitest run packages/protocol/src`;
  all pass.

## Notes

- Append-only rule: everything here is new or a new optional field; nothing existing is narrowed.
- Naming is flat snake_case. Do **not** copy the permission family's dotted canonical
  (`agent.permission.respond.request`) — that is the older minority style, and a brand-new family
  needs no alias.
- The permission schemas at `messages.ts:355-392` predate the `.passthrough()` rule and lack it. Use
  them as the model for **union placement and push shape only**, not for style.
- `requestId` on `agent_ui_respond_request` is the RPC correlation id; `uiRequestId` names the
  dialog. Two ids in one message is intentional — do not collapse them.
