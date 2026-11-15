# Task 005 — Fixtures for the new download shapes, JSON and binary

- **Sprint:** sprint-097-download-ranges
- **Status:** backlog
- **Type:** feature
- **Area:** packages/protocol (fixtures), packages/server (live fixture scenario)
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-003

## Goal
A non-TypeScript client can pin the ranged request, a rejection, the cancel exchange and a download `Begin` from files, each checked against the live dev daemon or the real codec.

## Context / why
Task-002 reshaped the two existing download fixtures. The shapes added since (a range, a rejection, cancel, the richer `Begin`) have no fixture, and the Rust transfer engine of the desktop client is written against this directory.

## Scope references
- `swe/features/desktop-client-protocol-followups-2.md` § 4 (rows "New" and "New binary")
- `swe/architecture/external-client-fixtures.md`, `packages/protocol/fixtures/external-clients/README.md` (format, the additive rule, how to add a fixture)
- `packages/protocol/fixtures/external-clients/` (`manifest.json`, `CHANGELOG.md`, `.signatures.json`, `binary/manifest.json`, `binary/file_transfer.begin.json`)
- `packages/server/src/test-support/external-fixtures-scenario.ts` (the variant key function and the file-transfer steps)
- `packages/server/src/daemon/external-fixtures-e2e.test.ts` (Layer B)
- `packages/protocol/src/external-fixtures.test.ts` (Layer A), `packages/protocol/src/external-binary-fixtures.test.ts` (asserts nine binary fixtures, one per frame)

## What to build
- JSON fixtures, each listed in `manifest.json` with `requiresFeature: "fileDownloadRanges"`:
  - `file_download_request.range.json` (`path`, `offset`, `length`, `ifUnchanged`), paired with the acceptance response;
  - `file_download_response.rejected.json` (`ok: false` with an `error`);
  - `file_download_cancel_request.json` and `file_download_cancel_response.json`.
- The live scenario issues the requests that produce them, and its variant key maps the two new variants of existing types.
- Binary fixture: a download `Begin` whose metadata carries `totalBytes`, `mtimeMs`, `offset` and `length`, as a new file listed in `binary/manifest.json`. The existing `Begin` fixture is not edited and the binary manifest's `formatVersion` stays 1.
- A dated additive `CHANGELOG.md` entry; the fixtures `README.md` tables; regenerated signatures.

Shared documents: `docs/desktop-client-handoff.md` and `swe/features/desktop-client-protocol-followups-2.md` are touched by most tasks of this sprint. Run alone, update what this task makes stale there. In a parallel wave, do not edit them: put the exact changes in the summary and the orchestrator applies them after the wave gate.

## Out of scope
- Removing or reshaping fixtures (done in task-002; `formatVersion` is already 2).
- `hello.agentStreams.json` (sprint-098/task-002).
- A live layer for binary fixtures (they have none by design).

## Acceptance criteria
- [ ] The four JSON files exist, are listed in the manifest, and pass Layer A and Layer B.
- [ ] The binary directory has ten fixtures; the new one decodes to its `decoded` form and encodes back to the same bytes through the real codec.
- [ ] `manifest.json` keeps `formatVersion` 2 and `binary/manifest.json` keeps 1; the changelog entry says the change is additive.
- [ ] The signature guard passes with regenerated signatures.

## Test / verification plan
- `npm run fixtures:update -w @av-pi-studio/protocol`
- `npx vitest run packages/protocol/src packages/server/src/daemon/external-fixtures-e2e.test.ts`
- `npm run build:protocol && npm run build:server`
- `npx oxfmt <changed files>`

## Notes
- Spec TODO(verify): the binary round-trip test is assumed to accept two fixtures for one opcode. It asserts "one per frame, nine in all" today, so extend the test rather than edit the existing fixture.
- `file_download_cancel_response`: `ok: true` needs a download that is still running when the cancel arrives, which a small scenario file may not give deterministically. A cancel for an idle stream deterministically answers `{ ok: false, error: "not_found" }`. Fixture whichever the scenario can produce every time, and state which in the fixture's description and in the changelog.
- For the binary `Begin`, a consumer compares parsed JSON, not bytes (the README says so for `Begin` and `Resize`).
