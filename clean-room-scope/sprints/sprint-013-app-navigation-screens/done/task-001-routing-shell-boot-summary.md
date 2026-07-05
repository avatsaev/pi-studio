# Task 001 — Host runtime, route grammar, app shell, provider stack, boot resolver — Summary

- **Sprint:** sprint-013-app-navigation-screens
- **Completed:** 2026-07-05
- **Status:** done

## What was implemented

Implemented the app runtime skeleton as framework-agnostic TypeScript contracts and algorithms: saved
host profiles, host runtime controller, route grammar, boot resolver, h/* guard, session context, and
app-shell/provider-stack metadata.

## Files created / changed

| File | Change |
|------|--------|
| `packages/app/src/runtime/host-profile.ts` | created host profile union (`direct`, `relay`, `ssh-gateway`, `local-embedded`) |
| `packages/app/src/runtime/host-runtime.ts` | created `HostRuntimeController`, connection snapshots, reconnect/backoff flow |
| `packages/app/src/runtime/route-grammar.ts` | created route builders/parsers, slug normalization, workspace id base64url encoding, `?open=` intents |
| `packages/app/src/runtime/boot-resolver.ts` | created boot resolver, h/* route guard, store-ready latch |
| `packages/app/src/runtime/session-context.ts` | created online-host session context value helper |
| `packages/app/src/runtime/app-shell.ts` | created provider-stack catalog, sidebar gating, host-switch route translation, overlay singleton list |
| `packages/app/src/runtime/index.ts` | created runtime barrel export |
| `packages/app/src/runtime/runtime.test.ts` | added 25 tests |
| `packages/app/src/index.ts` | exports runtime module |

## How it satisfies the scope

- Host runtime chooses a mockable connector path, records `serverId` + `features` from the hello/status
  result, exposes `idle|connecting|online|offline|error`, and schedules backoff reconnect on drop.
- Route grammar covers all documented core paths, `h/*` routes, legacy `/h/[serverId]/sessions`, settings
  slugs, host slugs, workspace id safe/base64url encoding, and `?open=` intents.
- Boot resolver implements remembered workspace → earliest online host → welcome-after-give-up → splash,
  plus desktop splash-error result.
- h/* guard shows splash until store-ready, allows known hosts, and redirects unknown hosts to the first
  host or `/welcome`.
- App shell exposes the fixed provider-stack order, sidebar chrome gating, active-host resolution, host
  switching route preservation, and always-mounted overlay singleton catalog.

## Build & test results

```
$ npx vitest run packages/app/src/runtime/runtime.test.ts
 ✓ packages/app/src/runtime/runtime.test.ts (25 tests) 5ms

$ npm --workspace @av-pi-studio/app run typecheck
 success
```

## Acceptance criteria

- [x] A saved host connects, completes hello/status, records `serverId`+`features`, and exposes state.
- [x] On socket drop the controller schedules backoff reconnect and rehydrates capabilities.
- [x] Documented routes resolve with correct params; unknown `serverId` redirects by guard rules.
- [x] Boot resolver routes to remembered workspace / online host / welcome and shows splash while waiting.
- [x] h/* routes show splash until store-ready; store-ready flag latches.

## Follow-ups / TODO(verify)

- Exact reconnect backoff and give-up timeout values remain TODO(verify); implementation uses injectable
  backoff for deterministic tests.
- Expo Router file tree / provider JSX will consume these contracts when the RN runtime is wired.
