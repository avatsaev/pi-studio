# Task 007 — Binary frame fixtures — Summary

- **Sprint:** sprints/sprint-096-desktop-protocol-followups
- **Completed:** 2026-11-14
- **Status:** done

## What was implemented
Nine binary fixtures in `fixtures/external-clients/binary/` with their own `manifest.json` (formatVersion 1), generated from the real codecs; `src/external-binary-fixtures.test.ts` round-trips each (hex->decoded and decoded->hex), checks the opcode byte against a literal table, and fails on unlisted/missing files. README section + CHANGELOG entry + AGENTS. Deviation from the spec: a `binary/` SUBDIRECTORY instead of a top-level `binary-manifest.json`, because the dashboard's `vendored_fixtures.rs` fails on any top-level `*.json` not listed in `manifest.json` (checked in ../pi-studio-dashboard); the spec is updated.

## Files created / changed
| File | Change |
|------|--------|
| `packages/protocol/fixtures/external-clients/binary/` | manifest + 9 frame fixtures |
| `packages/protocol/src/external-binary-fixtures.test.ts` | round-trip + manifest tests |
| `packages/protocol/fixtures/external-clients/{README,CHANGELOG}.md` | docs |

## How it satisfies the scope
No codec change; no live layer. `manifest.json` and its formatVersion untouched.

## Build & test results
```
vitest packages/protocol: 13 files / 324 tests pass; `npm pack --dry-run` lists binary/* in the tarball (package `files` already includes `fixtures`).
```

## Acceptance criteria
['Nine binary fixtures round-trip in both directions: met.', 'manifest.json and formatVersion untouched: met.', 'JSON fixture tests pass and ignore the new files: met (subdirectory).', 'README explains use: met.', 'Handoff doc: updated.']

## Follow-ups / TODO(verify)
- Dashboard re-vendor will carry `binary/` along unchanged (rsync -a --delete); not run.
