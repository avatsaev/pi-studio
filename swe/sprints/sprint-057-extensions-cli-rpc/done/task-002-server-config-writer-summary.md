# Task 002 — Server-side `config.json` writer that never bakes env overrides onto disk — Summary

- **Sprint:** sprint-057-extensions-cli-rpc
- **Completed:** 2026-08-13
- **Status:** done

## What was implemented

`persistExtensionPacks(configPath, packs)` in `packages/server/src/config/daemon-config.ts`: reads
the raw `config.json` (`{}` on missing/corrupt, never throws), merges only
`daemon.extensions.packs` into that raw object (preserving every other key including unknown ones),
writes atomically via `atomicWriteJson` with a permissive `z.record(z.string(), z.unknown())` schema
(deliberately not `persistedConfigSchema`, which would materialize every field's default), then
re-`chmodSync`s to `0600` (mode only applies on file creation, so pre-existing looser-permission
files are re-tightened, mirroring the CLI's `setDaemonPassword` idiom). `process.env` is never read
inside the function — only the `packs` argument and the file on disk feed the merge, which is what
keeps in-memory env overlays (`overlayEnv`) from ever being persisted.

## Files created / changed

| File | Change |
|------|--------|
| `packages/server/src/config/daemon-config.ts` | added `persistExtensionPacks` (imports `chmodSync` from `node:fs`, `atomicWriteJson` from `../persistence/atomic-store.js`) |
| `packages/server/src/config/daemon-config.test.ts` | added `describe("persistExtensionPacks")` — 8 new tests |

## How it satisfies the scope

Matches the task's exact signature and every behavioral requirement in `swe/features/preinstalled-extensions.md` § Data & Persistence and the task's own "What to build" section. No deviations. Implemented by a delegated subagent under this session; independently re-verified (build, lint, format, full test run, and a manual read of the implementation and its tests) before being accepted into the sprint.

## Build & test results

```
$ npm run build:server
(success)

$ npx oxfmt --check packages/server/src/config/daemon-config.ts packages/server/src/config/daemon-config.test.ts
All matched files use the correct format.

$ npx oxlint packages/server/src/config/daemon-config.ts packages/server/src/config/daemon-config.test.ts
(clean, no warnings)

$ npx vitest run packages/server/src/config
Test Files  2 passed (2)
     Tests  32 passed (32)   [daemon-config.test.ts: 22 passed, up from 14 baseline]
```

## Acceptance criteria

- [x] Writes `daemon.extensions.packs` into a fresh (absent) `config.json`, creating the directory,
      with mode `0600`.
- [x] Preserves unrelated keys on an existing file — unknown top-level key and unknown key inside
      `daemon` — asserted by deep-equal on everything except the changed path.
- [x] Env overrides are never persisted (headline test): `PI_STUDIO_LISTEN`,
      `PI_STUDIO_EXTENSIONS_AUTOSYNC`, `PI_STUDIO_EXTENSION_PACKS` set in env during the call leave
      `daemon.listen`/`daemon.extensions.autoSync` absent from the file; only the `packs` argument
      is written.
- [x] Defaults are not materialised: `{"version":1}` gains only `daemon.extensions.packs`.
- [x] Re-tightens a pre-existing `0644` config to `0600`.
- [x] A corrupt/unparseable existing file does not throw; replaced with the merged document.
- [x] `loadConfig(configPath, {})` after a write returns the persisted packs; with
      `PI_STUDIO_EXTENSION_PACKS` set, env still wins in memory (overlay precedence intact).
- [x] Written atomically — no temp file left behind on success.

## Follow-ups / TODO(verify)

- None. Task 003 consumes `persistExtensionPacks` next, from `ExtensionsService.setSelectedPacks`.
