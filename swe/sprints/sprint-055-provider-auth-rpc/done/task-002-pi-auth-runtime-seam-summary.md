# Task 002 — Daemon Pi auth runtime seam + `resolvePiAgentDir` path parity — Summary

- **Sprint:** sprint-055-provider-auth-rpc
- **Completed:** 2026-08-20
- **Status:** done

## What was implemented

`packages/server/src/agent/pi-home.ts` — `resolvePiAuthPaths(config)`, deriving `<agentDir>/
auth.json` + `<agentDir>/models.json` from the existing `resolvePiAgentDir(config)` (added
sprint-057, unchanged here) rather than re-deriving the precedence independently. Returns `{}`
when `resolvePiAgentDir` returns `undefined` (Pi's own defaults).

`packages/server/src/agent/provider-auth/pi-auth-runtime.ts` (new) — the daemon-side seam onto
Pi's `ModelRuntime` auth engine:

- `AuthPromptTextLike`/`AuthPromptSecretLike`/`AuthPromptSelectLike`/`AuthPromptManualCodeLike`/
  `AuthPromptLike`, `AuthEventInfoLike`/`AuthEventAuthUrlLike`/`AuthEventDeviceCodeLike`/
  `AuthEventProgressLike`/`AuthEventLike`, `AuthInteractionLike` — local structural mirrors of
  pi-ai's real `AuthPrompt`/`AuthEvent`/`AuthInteraction` (verified field-for-field against
  `@earendil-works/pi-ai`'s `dist/auth/types.d.ts`, nested under `pi-coding-agent`'s own
  `node_modules`), so no call site imports a Pi type.
- `PiAuthProviderInfo`, `PiAuthCheckResult`, `PiAuthRuntime` interface (`listProviders`,
  `checkAuth`, `login`, `logout`, `authPathLabel`).
- `createPiAuthRuntime(paths, opts?)` — production implementation. Cached-promise lazy
  `await import("@earendil-works/pi-coding-agent")` → `ModelRuntime.create({authPath, modelsPath,
  refreshOnCreate: false})`; **on a failed construction the cached promise is cleared** so the next
  call retries (verified by a mock that rejects once then resolves). `listProviders()` filters to
  login-capable providers (`auth.apiKey.login` or `auth.oauth` present), maps to `{id, name,
  authTypes, oauthLoginLabel?, oauthIsSubscription?}`, and skips a malformed entry rather than
  throwing. `checkAuth()` bounded via `Promise.race` against a `setTimeout` (default 3000 ms,
  injectable `checkAuthTimeoutMs`, mirroring sprint-054's `checkAuthBounded`) — degrades to
  `{configured: "unknown"}` rather than hanging. `login()` merges the caller-supplied
  `AbortSignal` onto the interaction (falling back to the interaction's own `.signal`) before
  calling `runtime.login()`, so the flow service's `AbortController` is always the one that races.
  `logout()` delegates then re-checks, reporting `stillConfigured` when an ambient credential (e.g.
  an env var) survives removal.
- `packages/server/src/promise-with-resolvers.d.ts` (new) — ambient `Promise.withResolvers()`
  augmentation, matching the identical file already present in `packages/cli/src/` and
  `packages/web-client/src/lib/`: the runtime (Node 22+) implements it, but this package's shared
  `tsconfig.base.json` targets `lib: ["ES2023"]`, which predates it. Required because
  `pi-auth-runtime.ts` is real (non-test) source under `tsc -b`'s `include`, unlike the server's
  existing `Promise.withResolvers` usages which are all in `.test.ts` files excluded from that
  project.

## Files created / changed

| File | Change |
|------|--------|
| `packages/server/src/agent/pi-home.ts` | modified — added `resolvePiAuthPaths` |
| `packages/server/src/agent/provider-auth/pi-auth-runtime.ts` | created |
| `packages/server/src/agent/provider-auth/pi-auth-runtime.test.ts` | created |
| `packages/server/src/agent/provider-registry.test.ts` | modified — path-parity cases for `resolvePiAuthPaths` |
| `packages/server/src/promise-with-resolvers.d.ts` | created — ambient `Promise.withResolvers()` declaration |

## How it satisfies the scope

Maps to `swe/features/provider-auth-rpc.md` § Behavior & Algorithms (runtime bullet, `list`
bullet), § Error Handling (runtime-unavailable row). The one intentional coupling point — the
daemon's write path and a spawned agent's read path must agree — is asserted directly:
`resolvePiAuthPaths(config).authPath` is compared byte-for-byte against the real
`spawns[0].env.PI_CODING_AGENT_DIR` captured from a fake Pi transport, for both the plain
`daemon.piHome` case and the `agents.providers.pi.env.PI_CODING_AGENT_DIR` override case. No
deviation from the task spec; `packages/cli` was not touched (a separate package/owner this
sprint, referenced only for structural pattern).

One test-environment issue surfaced and was fixed during verification: `vi.useFakeTimers()`
enabled *before* the lazy `await import()` resolves interferes with the dynamic-import machinery
and hangs the test past its 5s timeout. Fixed by warming the runtime cache under real timers first
(`await runtime.listProviders()`), then switching to fake timers only for the actual bounded
`checkAuth()` call — which also matches the realistic case: a long-lived daemon's runtime is
already constructed by the time any individual `checkAuth` races its bound.

## Build & test results

```
$ npm run build:server
tsc -b packages/server && chmod +x packages/server/dist/daemon/main.js
(success — required adding packages/server/src/promise-with-resolvers.d.ts; TS2550 without it)

$ npm run clean && npm run typecheck
tsc -b
(success, 0 errors)

$ npx oxlint packages/server/src/agent/pi-home.ts packages/server/src/agent/provider-auth/pi-auth-runtime.ts \
    packages/server/src/agent/provider-auth/pi-auth-runtime.test.ts packages/server/src/agent/provider-registry.test.ts \
    packages/server/src/promise-with-resolvers.d.ts
(exit 0, no findings)

$ npx oxfmt --check <same files>
All matched files use the correct format.

$ npx vitest run packages/server/src/agent
Test Files  20 passed (20)
     Tests  226 passed (226)
```

`pi-auth-runtime.test.ts` (16 tests): lazy-import guarantee (not called at construction, called
exactly once across repeated calls, called with `{authPath, modelsPath, refreshOnCreate: false}`,
**retried after a rejected construction**), provider mapping/filtering (including a malformed-entry
skip case), bounded `checkAuth` (unconfigured → `false`, configured → `{true, type, source}`,
never-settling probe → `"unknown"` within the bound under fake timers), `login`'s signal merge
(explicit signal wins, falls back to the interaction's own signal), `logout`'s `stillConfigured`
reporting (true when a re-check still shows configured, false once actually gone), `authPathLabel`
(resolved path / placeholder, no import triggered), and one real (unmocked, `vi.importActual`)
integration test proving `ModelRuntime.create` tolerates a temp dir with no pre-existing
`models.json`. `provider-registry.test.ts` gained 2 new path-parity cases (13 tests total, up from
11).

## Acceptance criteria

- [x] `resolvePiAuthPaths(config)` returns `<piHome>/agent/auth.json` + `.../models.json` for a
      `daemon.piHome` config, honours an `agents.providers.pi.env.PI_CODING_AGENT_DIR` override
      above it, and returns empty (Pi defaults) when neither is set.
- [x] The resolved `authPath` is byte-identical to the `PI_CODING_AGENT_DIR` a spawned agent gets
      from `buildPiClient` for the same config — asserted directly, including the override case.
- [x] `piHomeEnv`/`buildPiClient` behavior is unchanged (existing `provider-registry.test.ts`
      cases pass untouched).
- [x] No Pi import happens until the first runtime-backed method call; the module is imported at
      most once across repeated calls.
- [x] A failed `ModelRuntime.create` is retried on the next call (second call succeeds after a
      transient failure) — asserted with a mock that fails once then succeeds.
- [x] `listProviders()` returns only login-capable providers, carries `oauthLoginLabel` /
      `oauthIsSubscription`, and skips a malformed entry without throwing.
- [x] `checkAuth()` on a provider that never settles resolves to `configured: "unknown"` within the
      bound (fake timers — no wall-clock wait).
- [x] `logout()` reports `stillConfigured: true` when a re-check still shows the provider
      configured.

## Follow-ups / TODO(verify)

- None outstanding for this task's own scope. Flow registry, prompt correlation, and session
  pushes are task-003's; RPC handlers and bootstrap wiring are task-004's.
- Noted for whoever next touches `packages/server`'s `tsconfig.base.json`: three packages now carry
  an identical `promise-with-resolvers.d.ts` ambient shim (cli, web-client, server). Consolidating
  or bumping the shared `lib` target to `ES2024` would remove the duplication — out of scope here,
  flagging for a future chore.
