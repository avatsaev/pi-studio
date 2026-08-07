# Task 001 — Register the `list_provider_models` daemon RPC handler

- **Sprint:** sprint-043-model-selector
- **Status:** done
- **Estimated size:** S
- **Depends on:** none

## Goal
Serve the already-called-but-unregistered `list_provider_models` RPC in both daemon bootstraps so
clients can discover a provider's available models over the WebSocket API.

## Background / why
`client.providers.listModels(provider)` sends `daemon.request("list_provider_models", { provider })`
(`packages/client/src/pistudio-client.ts:412-414`), but **no daemon handler is registered anywhere**
— the request currently times out. The server already has real per-provider discovery via
`AgentClient.listModels(opts?: { cwd?: string }): Promise<AgentModelDefinition[]>`
(`packages/server/src/agent/provider-contract.ts:232`), which needs **no spawned agent** (the Pi
adapter uses a top-level `get_available_models` RPC — `providers/pi/agent.ts:483-486`; the mock
provider returns a static list — `mock-provider.ts:281-283`). This task wires that discovery to the
RPC, mirroring the existing inline `list_providers` registration.

## Scope references
- `clean-room-scope/features/provider-usage.md` § model discovery
- `clean-room-scope/features/agent-providers.md` § Registration surface, § AgentClient
- `packages/server/AGENTS.md` § daemon bootstrap / RPC registration

## What to build
- **`packages/server/src/daemon/bootstrap.ts`** — immediately after the inline `list_providers`
  registration (ends line 287), register:
  - Request: `list_provider_models` with `{ provider?: string, cwd?: string }` (default provider `"pi"`).
  - Resolve the client via the in-scope `resolveClient(provider)` (`bootstrap.ts:187-188`), call
    `client.listModels(cwd ? { cwd } : undefined)`, and return:
    ```
    { type: "list_provider_models_response", requestId, provider, models }
    ```
    where `models: AgentModelDefinition[]` = `{ id: string; label?: string; description?: string }[]`.
- **`packages/server/src/daemon/dev-bootstrap.ts`** — add the identical handler after its
  `list_providers` registration (ends line 199). Its `resolveClient` yields the mock client, so the
  dev daemon serves `[{ id: "mock-model", label: "Mock Model" }]`.

Do **not** add this message to the `sessionMessageSchema` discriminated union in
`packages/protocol/src/messages.ts` — the sibling discovery RPCs `list_providers` and
`list_agents_request` are deliberately absent from that union and validate through the
`sessionMessageBaseSchema` passthrough fallback. Match that established convention.

## Out of scope
- Client SDK typing of the response (task-002).
- Any UI (tasks 003–004).
- `list_provider_modes` / `providers.snapshot.refresh` — leave unregistered.

## Acceptance criteria
- [ ] `list_provider_models` is registered in both `bootstrap.ts` and `dev-bootstrap.ts`.
- [ ] The response envelope is `{ type: "list_provider_models_response", requestId, provider, models }`.
- [ ] A missing/blank `provider` in the request defaults to `"pi"`.
- [ ] A provider whose `listModels()` rejects (or an unknown provider) surfaces as an `rpc_error`
      to the client (no swallowed error, no special-casing added).
- [ ] `npm run build:server` and `npm run typecheck` pass.

## Test / verification plan
- Build: `npm run build:server` succeeds.
- Manual RPC check against the dev daemon (mock provider):
  - `npm run dev:daemon` (binds `0.0.0.0:6767`).
  - From a short node script using `@av-pi-studio/client`, connect and call
    `client.providers.listModels("pi")`; expect
    `{ type: "list_provider_models_response", provider: "pi", models: [{ id: "mock-model", label: "Mock Model" }] }`
    within the RPC timeout (previously it timed out — resolving is the pass signal).

## Notes
- `resolveProviderClient(provider, config, { logger })` throws on an unknown provider; that reaches
  the client as `rpc_error` via the router — no extra handling required.
- Keep the two bootstraps' handlers byte-identical for maintainability.
