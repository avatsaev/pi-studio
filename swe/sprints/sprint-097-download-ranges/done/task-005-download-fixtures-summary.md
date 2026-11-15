# Task 005 — Fixtures for the new download shapes, JSON and binary — Summary

- **Sprint:** sprints/sprint-097-download-ranges
- **Completed:** 2026-11-15
- **Status:** done

## What was implemented
- JSON fixtures `file_download_request.range.json`, `file_download_response.rejected.json`, `file_download_cancel_request.json`, `file_download_cancel_response.json` (`requiresFeature: "fileDownloadRanges"`, `since` 0.0.119), listed in `manifest.json`, requests paired with their responses. The cancel response fixtures `{ ok: false, error: "not_found" }` (cancel of idle stream 200): `ok: true` needs a download still running, which the test client cannot hold deterministically; the description and changelog say so.
- Binary fixture `binary/file_transfer.begin.download.json` (a download `Begin` with `totalBytes` 32, `mtimeMs`, `offset` 8, `length` 16), listed in `binary/manifest.json`; the existing `Begin` fixture and the binary `formatVersion` (1) are untouched. `external-binary-fixtures.test.ts` now expects ten fixtures, two for `Begin`.
- Live scenario: whole-file download, a ranged download using the file's real `ifUnchanged`, a rejected download, a cancel on an idle stream; the variant key maps `file_download_response` to `.rejected` when `ok` is false. Layer B fills `ifUnchanged` with live values.
- `file_download_response.json`: description refreshed with the later errors; `/message/offset` and `/message/length` added to `volatile` (the ranged request is paired with it). Leaf paths and types are unchanged, so the signature guard is unaffected; the changelog says so.
- Dated additive changelog entry (`formatVersion` stays 2), README tables, `packages/protocol/AGENTS.md`, regenerated signatures.

## Files created / changed
| File | Change |
|------|--------|
| `packages/protocol/fixtures/external-clients/*.json` (4 new, `file_download_response.json` edited), `binary/file_transfer.begin.download.json` (new) | fixtures |
| `…/manifest.json`, `…/binary/manifest.json`, `…/CHANGELOG.md`, `…/README.md`, `…/.signatures.json` | entries, docs, signatures |
| `packages/protocol/src/external-binary-fixtures.test.ts` | ten fixtures, two for `Begin` |
| `packages/protocol/AGENTS.md` | fixture sections |
| `packages/server/src/test-support/external-fixtures-scenario.ts`, `daemon/external-fixtures-e2e.test.ts` | live steps, variant key, live `ifUnchanged` |

## Build & test results
```
$ npm run fixtures:update -w @av-pi-studio/protocol     wrote .signatures.json (formatVersion 2)
$ npx vitest run packages/protocol/src packages/server/src/daemon/external-fixtures-e2e.test.ts
Test Files  14 passed / Tests  423 passed
Wave gate on the combined tree: build, typecheck, npm test (270 files, 3761 tests), lint all green.
```

## Acceptance criteria
- [x] Four JSON files exist, are listed, pass Layer A and Layer B.
- [x] Ten binary fixtures; the new one round-trips through the real codec.
- [x] `manifest.json` `formatVersion` 2, binary 1; changelog entry says additive.
- [x] Signature guard passes with regenerated signatures.

## Follow-ups / TODO(verify)
- The `ok: true` cancel outcome has no fixture (see above).
