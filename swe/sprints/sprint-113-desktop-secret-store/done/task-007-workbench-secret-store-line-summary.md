# Task 007 — Workbench: `secretStore` in the registry view and the Daemons screen's line — Summary

- **Sprint:** sprints/sprint-113-desktop-secret-store
- **Completed:** 2026-11-21
- **Status:** done

## What was implemented
- `HostDaemons.snapshot()` gains optional `secretStore?: "keychain" | "file"`.
- The Daemons screen's view model carries `secretStoreNote` (`FILE_SECRET_STORE_NOTE` for `file`, otherwise null); the screen draws it as one muted paragraph under the settings section, with existing tokens only.
- The desktop parser `parseDaemonsView` keeps `keychain` and `file` and drops anything else.
- Outside the listed files: `host/daemons.ts` `resync()` (the re-read after the `daemons_changed` listener registers) now keeps the boot value of `secretStore`, because `daemon.list` and `settings.get` do not carry it.
- Docs: `packages/workbench/README.md`, `AGENTS.md`, `swe/architecture/workbench-host-adapter.md` (interface, the `daemons` row, a history row).

## Files
`packages/workbench/src/host/types.ts`, `features/daemons/{daemons-screen-view.ts, DaemonsScreen.tsx, DaemonsScreen.module.css, daemons-screen-view.test.ts}`, `desktop/apps/pistudiodesktop/src/host/{daemons-view.ts, daemons-view.test.ts, daemons.ts, daemons.test.ts}`, and the three documents above.

## Results
```
npx vitest run packages/workbench/src/features/daemons   147 passed
npm run build:workbench                                   built; check-dist ok
(cd desktop/apps/pistudiodesktop && npm run check && npm run lint && npm test)   clean; 111 passed
```

## Wave gate (orchestrator, combined tree, 2026-11-21)
```
$ (cd desktop && cargo xtask ci)     all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm)
$ npm run build && npm run typecheck && npm run lint && npm test
  build 0, typecheck 0, lint 0 (warnings only in files this work did not touch), 291 files, 4132 tests passed
```

## Acceptance criteria
All four met (the root gates are the wave gate above).

## Follow-ups / TODO(verify)
- Task-006 must send `secretStore` in the `boot` view and in the `daemons_changed` payload; if only on `boot`, an event view without it would drop the line (a one-line fix in `onChanged`).
- Merging this to `main` publishes a workbench npm release.
- `oxfmt` prints "Expected at least one target file" for `desktop/apps/pistudiodesktop/src/host`: those files are checked by oxlint only.
