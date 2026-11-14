# Task 001 — version.ts single source — Summary

- **Sprint:** sprints/sprint-084-daemon-status-rpc
- **Completed:** 2026-11-13
- **Status:** done

## What was implemented
`packages/server/src/version.ts` exports `SERVER_VERSION`; moved out of `extensions/curated-packs.ts` with no re-export. `curated-packs.ts`, `sync-executor.ts`, both bootstraps (direct + relay handshakes, dev handshake) import it. Version tests moved to `version.test.ts`; new dev-daemon handshake test.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/version.ts` | created |
| `packages/server/src/version.test.ts` | created (moved from curated-packs.test.ts) |
| `packages/server/src/daemon/server-version.test.ts` | created |
| `packages/server/src/extensions/curated-packs.ts`, `.test.ts`, `sync-executor.ts` | modified (import migration) |
| `packages/server/src/daemon/bootstrap.ts`, `dev-bootstrap.ts` | modified (real version) |
| `packages/server/AGENTS.md` | layout line |

## Build & test results
```
$ npm run build:server          -> success
$ npx vitest run packages/server/src/extensions packages/server/src/version.test.ts packages/server/src/daemon/server-version.test.ts -> 9 files, 91 passed
$ npx oxlint <changed>          -> clean
```

## Acceptance criteria
- [x] Dev handshake test asserts version === SERVER_VERSION, not placeholders.
- [x] No `"1.0.0"` handshake literal remains in packages/server/src.
- [x] Curated-packs and sync tests pass.

## Follow-ups / TODO(verify)
- None.
