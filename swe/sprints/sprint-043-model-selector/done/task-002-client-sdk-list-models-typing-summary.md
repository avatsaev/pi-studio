# Task 002 — Type the client SDK `providers.listModels` response — Summary

- **Sprint:** sprint-043-model-selector
- **Completed:** 2026-07-24
- **Status:** done

## What was implemented
Added exported `ProviderModel` (`{ id, label?, description? }`) and `ListProviderModelsResponse`
(`{ type, requestId, provider, models: ProviderModel[] }`) interfaces to
`packages/client/src/pistudio-client.ts`. Updated `PiStudioProviderActions.listModels` and
`ProviderHandle.listModels` to return `Promise<ListProviderModelsResponse>` (using
`daemon.request<ListProviderModelsResponse>(...)` — inference worked, no cast needed since
`DaemonClient.request<T = unknown>` already supports an explicit type argument). Both types are
re-exported from the package's public surface automatically via `index.ts`'s existing
`export * from "./pistudio-client.js"`.

## Files created / changed
| File | Change |
|------|--------|
| `packages/client/src/pistudio-client.ts` | modified — added `ProviderModel`/`ListProviderModelsResponse` interfaces; retyped `PiStudioProviderActions.listModels` and `ProviderHandle.listModels` |

`packages/client/src/index.ts` needed no change — its existing `export *` barrel already re-exports
every interface added to `pistudio-client.ts`.

## How it satisfies the scope
Matches `features/provider-usage.md` § model discovery: the type lives in the client package (not
`packages/protocol`), following the same untyped-discovery-RPC convention as `list_providers`
(no protocol schema). `daemon.request`'s existing generic (`request<T = unknown>`) was sufficient —
no cast was required, so the plan's contingency ("cast via `as Promise<...>` if inference fails")
was not needed.

## Build & test results
```
$ npm run build:client
> tsc -b packages/client
(success, no errors)

$ npm run typecheck
> tsc -b
(success, no errors)

$ npx vitest run packages/client/src/pistudio-client.test.ts
✓ packages/client/src/pistudio-client.test.ts (10 tests) 27ms
Test Files  1 passed (1)
     Tests  10 passed (10)
```
The existing `client.providers.listModels("mock")` test (line ~266, casts the result to
`{ models: { id: string }[] }`) continues to pass unchanged — the new concrete return type is a
superset-compatible narrowing of the previous `Promise<unknown>`.

## Acceptance criteria
- [x] `client.providers.listModels("pi")` is typed `Promise<ListProviderModelsResponse>`.
- [x] `ProviderModel` and `ListProviderModelsResponse` are exported from the client package (via the
      existing `pistudio-client.js` barrel re-export).
- [x] `npm run build:client` and `npm run typecheck` pass.

## Follow-ups / TODO(verify)
- None.
