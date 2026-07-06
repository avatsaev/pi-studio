# Task 001 — Provider-usage daemon RPC + protocol schema

- **Sprint:** sprint-031-provider-usage-setup-backend
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** sprint 005 (providers), sprint 006 (structured generation), sprint 002 (protocol)

## Goal
Add the `provider_usage_list` daemon RPC + append-only protocol schema flagged as **new
protocol/server scope** in `clean-room-scope/sprints/PLAN.md` (Open questions). Until this exists,
the Provider Usage settings section and the composer-footer usage widget can only show mocked data.

## Scope references
- `clean-room-scope/features/provider-usage.md`
- `clean-room-scope/architecture/websocket-protocol.md` (append-only conventions)
- `clean-room-scope/architecture/structured-generation.md`
- Reference (Paseo): `packages/app/src/provider-usage/*` (balance-bar, window-bar, list, card)

## What to build
- **Protocol**: append-only `provider_usage_list_request` / `provider_usage_list_response` session
  message schemas in `packages/protocol` (optional fields only; `.passthrough()`). Include per-
  provider balance, usage windows (limits + used + reset time), and provider id/label.
- **Server**: a handler that queries each configured provider for usage/balance and returns the
  aggregated snapshot; register via `HandlerRegistry.register()` in the bootstrap module.
- **Provider contract**: an optional `getUsage()` on the provider contract (additive) so `pi`/mock
  can supply data; mock returns synthetic values.
- Capability flag (additive) so old clients gracefully hide the feature.

## Acceptance criteria
- [ ] `provider_usage_list` returns aggregated per-provider usage/balance via the mock provider in tests.
- [ ] Schemas are additive/optional and pass the append-only conventions.
- [ ] Old-client compatibility preserved (feature gated behind a capability flag).

## Test / verification plan
- Unit: schema round-trip; handler aggregation with mock provider (in-process daemon harness).
- `npx vitest run` on protocol + server test files; `npm run build` succeeds.
