# Task 003 — Per-project pi-studio.json config + revision model — Summary

- **Sprint:** sprint-003-persistence-config
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
`packages/server/src/config/project-config.ts`:
- **`piStudioConfigSchema`** for `pi-studio.json`: `worktree.{setup,teardown}` (each `string |
  string[]`), `scripts: Record<name, ScriptEntry>`, `instructions?`.
- **Normalization:** `setup`/`teardown` → deduped command arrays (string → single-element array,
  blanks dropped, default `[]`) via a Zod transform; `normalizeProjectConfig(raw)` parses + normalizes.
- **`scriptEntrySchema`** (`{ type?, command }`, passthrough for unknown fields) + `isServiceScript`
  (flags `type:"service"` for proxying).
- **Revision / stale-write model:** `piStudioConfigRevisionSchema` (content-hash token, nullable),
  `computeRevision` (sha256), `readProjectConfig` (returns `{ config, revision }`; missing/corrupt →
  defaults + `null` revision), and `writeProjectConfig(path, newConfig, expectedRevision)` returning
  typed errors `project_not_found` | `invalid_project_config` | `stale_project_config` | `write_failed`.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/config/project-config.ts` | created |
| `packages/server/src/config/index.ts` | modified — re-exports project config |
| `packages/server/src/config/project-config.test.ts` | added — 10 tests |

## How it satisfies the scope
- **config.md § Per-project config / § Error Handling:** schema shape, `setup`/`teardown`
  normalization, and the `Pi-StudioConfigRevisionSchema` error codes are reproduced.
- **worktrees.md § Lifecycle config:** `worktree.setup`/`teardown` `string|string[]` shape.
- **service-proxy.md § Triggering:** `type:"service"` scripts are detectable via `isServiceScript`.

## Build & test results
```
$ npm run build:server          → exit 0 (no type errors)
$ npx vitest run packages/server/src/config/project-config.test.ts
 ✓ project-config.test.ts (10 tests)
 Test Files  1 passed (1)      Tests  10 passed (10)
$ npx oxlint packages/server   → clean
```

## Acceptance criteria
- [x] `setup: "cmd"` normalizes to `["cmd"]`; absent → `[]`.
- [x] `scripts` entries with `type:"service"` parse and are flagged for proxying.
- [x] A write against a stale revision returns `stale_project_config`.
- [x] Invalid project config returns `invalid_project_config` (also `project_not_found` /
      `write_failed` paths exist).

## Follow-ups / TODO(verify)
- Full script-entry schema (fields beyond `type`/`command` — assigned port, env, cwd, etc.) is
  TODO(verify); extra fields are currently tolerated via passthrough.
- Running setup/teardown and service-proxy route registration land in sprints 008/009.
