# Task 002 — Type the client SDK `providers.listModels` response

- **Sprint:** sprint-043-model-selector
- **Status:** done
- **Estimated size:** XS
- **Depends on:** task-001

## Goal
Give `client.providers.listModels(provider)` a concrete return type so the web-client can consume
the model list without `unknown` casts.

## Background / why
`ProviderHandle.listModels` returns `Promise<unknown>` today
(`packages/client/src/pistudio-client.ts:412-414`). Now that the daemon serves a typed response
(task-001), expose the shape from the client package. Following the untyped-discovery-RPC
convention (no protocol schema for `list_providers`/`list_provider_models`), the type lives in the
client package, not `packages/protocol`.

## Scope references
- `clean-room-scope/features/provider-usage.md` § model discovery
- `clean-room-scope/architecture/websocket-protocol.md` § discovery RPCs
- `packages/client/AGENTS.md` § PiStudioClient facade / provider actions

## What to build
- **`packages/client/src/pistudio-client.ts`**:
  - Add exported interfaces:
    ```ts
    export interface ProviderModel { id: string; label?: string; description?: string; }
    export interface ListProviderModelsResponse {
      type: "list_provider_models_response";
      requestId: string;
      provider: string;
      models: ProviderModel[];
    }
    ```
  - Change `ProviderHandle.listModels` to
    `listModels(provider: string): Promise<ListProviderModelsResponse>` returning
    `this.daemon.request("list_provider_models", { provider })`. If `DaemonClient.request`'s
    generic cannot infer this shape, add `as Promise<ListProviderModelsResponse>` — inspect the
    `request` signature first and prefer inference.
- **`packages/client/src/index.ts`** (or the package's public export barrel): export
  `ProviderModel` and `ListProviderModelsResponse`.

## Out of scope
- Typing `listModes` / `refreshSnapshot` (still `unknown`).
- Any UI usage (tasks 003–004).

## Acceptance criteria
- [ ] `client.providers.listModels("pi")` is typed `Promise<ListProviderModelsResponse>`.
- [ ] `ProviderModel` and `ListProviderModelsResponse` are exported from the client package.
- [ ] `npm run build:client` and `npm run typecheck` pass.

## Test / verification plan
- Build: `npm run build:client` succeeds.
- Typecheck: `npm run typecheck` passes with the retyped method.
- Static confirmation: in a scratch `.ts`, `const r = await client.providers.listModels("pi")` gives
  `r.models[0].id` typed as `string` with no cast.

## Notes
- Append-only surface: adding exports and narrowing a `Promise<unknown>` to a concrete type is a
  compatible change; do not alter the RPC name or request payload.
