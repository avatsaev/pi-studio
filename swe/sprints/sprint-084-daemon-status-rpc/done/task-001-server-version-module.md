# Task 001 — `version.ts` single source; real `server_info.version` at all three handshakes

- **Sprint:** sprint-084-daemon-status-rpc
- **Status:** done
- **Type:** refactor
- **Area:** packages/server (version, extensions, daemon)
- **Priority:** P1
- **Estimated size:** XS
- **Depends on:** none

## Goal

`server_info.version` reports the real package version everywhere. `DaemonStatus.version` will read
the same constant.

## Context / why

The handshake version is `"1.0.0"` at `bootstrap.ts:733` (direct) and `:837` (relay), and
`"0.1.0-dev"` at `dev-bootstrap.ts:372`. No consumer reads it (verified by the spec). `SERVER_VERSION`
lives in `extensions/curated-packs.ts:58`; `sync-executor.ts:8` imports it. This also covers
`features/self-update.md`'s version-replacement requirement.

## Scope references

- swe/features/daemon-status-rpc.md § `server_info.version` (decision), § Acceptance "Real version
  everywhere"
- swe/features/self-update.md (version row)
- packages/server/src/extensions/curated-packs.ts:58, :191; extensions/sync-executor.ts:8
- packages/server/src/daemon/bootstrap.ts:733, :837; daemon/dev-bootstrap.ts:372

## What to build

- `packages/server/src/version.ts` exporting `SERVER_VERSION` (the same `createRequire`
  package.json read, path adjusted).
- Every importer migrates to `version.js`. **No re-export from `curated-packs.ts`**: this is a
  planning-time refinement of the spec's "re-exported by curated-packs", per the repo's
  clean-cutover rule.
- The three handshake sites use `SERVER_VERSION`.

## Acceptance criteria

- [ ] A dev-daemon handshake test asserts `server_info.version === SERVER_VERSION`, and that it is
  neither `"1.0.0"` nor `"0.1.0-dev"`.
- [ ] No string literal `"1.0.0"` remains as a handshake version in `packages/server/src`.
- [ ] Existing curated-packs and sync tests pass.

## Test / verification plan

- `npx vitest run packages/server/src/extensions packages/server/src/ws packages/server/src/daemon`
- `npm run build:server`
