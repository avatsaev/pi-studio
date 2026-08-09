# Task 001 — Pi auth runtime seam + auth-path resolution — Summary

- **Sprint:** sprint-054-provider-auth-cli
- **Completed:** 2026-08-07
- **Status:** done

## What was implemented

`packages/cli/src/auth-runtime.ts` — the injectable seam onto Pi's `ModelRuntime` auth engine that
every later task in this sprint builds on:

- `resolvePiAuthPaths(opts, env)` — derives `<piHome>/agent/auth.json` + `.../models.json` from
  `--pi-home` / `PI_STUDIO_PI_HOME` (flag wins), returning `{}` when neither is set so Pi's own
  default path resolution takes over. Mirrors `piProxyEnv()` (`pi-commands.ts`) literally.
- `AuthProviderInfo`, `AuthStatusInfo`, `AuthPromptLike`/`AuthEventLike`/`AuthInteractionLike` — a
  local structural type layer matching pi-ai's real `AuthPrompt`/`AuthEvent`/`AuthInteraction`
  field-for-field (`type` discriminant, `options: {id,label,description?}[]` for `select`,
  `userCode`/`verificationUri` for `device_code`, etc.) so no Pi type import is ever needed at any
  call site, while still being structurally assignable to Pi's real types.
- `AuthRuntime` interface (`listProviders`, `checkAuth`, `login`, `logout`, `authPathLabel`) — the
  seam `CliContext.auth` carries.
- `defaultAuthRuntime(paths)` — production implementation. Creates `ModelRuntime` lazily via
  `await import("@earendil-works/pi-coding-agent")` inside a cached-promise closure, on first
  method call only; `refreshOnCreate: false`. `listProviders()` filters to providers that can
  actually log in (`auth.apiKey.login` or `auth.oauth` present) and skips any single malformed
  provider entry rather than throwing.
- `CliContext.auth?: AuthRuntime` added (`cli-core.ts`), alongside the existing `pi`/`daemon`/
  `relay`/`update` injectable slots.
- `packages/cli/package.json` — added `@earendil-works/pi-coding-agent: ^0.84.1` as a direct
  dependency, identical range to `packages/server/package.json`.

## Files created / changed

| File | Change |
|------|--------|
| `packages/cli/src/auth-runtime.ts` | created |
| `packages/cli/src/auth-runtime.test.ts` | created |
| `packages/cli/src/cli-core.ts` | modified — added `auth?: AuthRuntime` to `CliContext` |
| `packages/cli/package.json` | modified — added `@earendil-works/pi-coding-agent` dependency |

## How it satisfies the scope

Maps to `swe/features/provider-auth-cli.md` § Public Contract (Pi API surface: `ModelRuntime.create`,
`getProviders`, `checkAuth`, `login`, `logout`) and § Behavior & Algorithms (path resolution). Path
parity with the daemon's `piHomeEnv()` (`packages/server/src/agent/provider-registry.ts:57`,
module-private, cited as a comment rather than imported per the task's own review-fix) is asserted
directly against the literal `join(piHome, "agent", "auth.json")` derivation, and additionally
regression-locked by mirroring `piProxyEnv()`'s already-tested derivation in `pi-commands.ts`. No
deviation from the task spec.

## Build & test results

```
$ npm install
up to date

$ npm run build:cli
tsc -b packages/cli && chmod +x packages/cli/dist/cli.js
(success)

$ npm run typecheck
tsc -b
(success, 0 errors)

$ npx oxlint packages/cli/src/auth-runtime.ts packages/cli/src/auth-runtime.test.ts packages/cli/src/cli-core.ts
(exit 0, no findings)

$ npx oxfmt --check packages/cli/src/auth-runtime.ts packages/cli/src/auth-runtime.test.ts packages/cli/src/cli-core.ts packages/cli/package.json
All matched files use the correct format.

$ npx vitest run packages/cli/src
Test Files  12 passed (12)
     Tests  164 passed (164)
```

`packages/cli/src/auth-runtime.test.ts` (13 tests): path resolution matrix (flag/env/both/neither,
daemon-parity literal assertion), lazy-import guarantee (mocked `ModelRuntime.create` not called at
construction, called exactly once across repeated method calls, called with the expected
`{authPath, modelsPath, refreshOnCreate: false}`), provider mapping + filtering (including a
malformed-entry skip case), `checkAuth` mapping (`undefined` → `{configured: false}`, present →
`{configured: true, type, source}`), and one real (unmocked, `vi.importActual`) integration test
against the actual `@earendil-works/pi-coding-agent` package proving `ModelRuntime.create` tolerates
a temp directory with no pre-existing `models.json`.

## Acceptance criteria

- [x] `resolvePiAuthPaths` returns `<piHome>/agent/auth.json` + `.../models.json` for both
      `--pi-home` and `PI_STUDIO_PI_HOME` (flag wins), and `{}` when neither is set — verified by
      the 4-case matrix in `auth-runtime.test.ts`.
- [x] Resolved `authPath` is byte-identical to the daemon's `piHomeEnv()` derivation, asserted as
      the literal `join(piHome, "agent", "auth.json")` — verified by the parity test; `piHomeEnv()`
      cited as a source comment, not imported (it's module-private).
- [x] `defaultAuthRuntime()` performs no import until first method call, imported at most once —
      verified by the mocked `ModelRuntime.create` spy tests.
- [x] `AuthRuntime` is fully implementable by a test fake with no Pi types imported — every test in
      the file constructs fakes/mocks using only `auth-runtime.ts`'s own exported types.
- [x] `packages/cli/package.json` declares `@earendil-works/pi-coding-agent` at `^0.84.1`, matching
      `packages/server/package.json`.

## Follow-ups / TODO(verify)

- None outstanding. The one inherited `TODO(verify)` (whether `ModelRuntime.create` tolerates a
  missing `models.json` on a fresh machine) is closed by the real-package temp-dir integration test
  in this task rather than deferred.
- Command registration, prompting, output rendering, and docs are explicitly out of scope here
  (tasks 002–006).
