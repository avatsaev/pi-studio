# Task 007 — Download: documents to the real wire, live checks

- **Sprint:** sprint-097-download-ranges
- **Status:** done
- **Type:** docs
- **Area:** docs, swe specs, package documents; live verification
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002, task-003, task-004, task-005, task-006

## Goal
Every document that describes downloads matches the code, and the new flow is proven against an isolated production daemon and in a browser.

## Context / why
The download token appears in a dozen documents, several of which other agents treat as the contract (the root `AGENTS.md`, the package `AGENTS.md` files, the desktop handoff). The unit and fixture tests use small files on loopback inside one process; the claims that matter for the desktop client (resume, flat memory, a response that no longer waits for the stream) need a run with a large file.

## Scope references
- `swe/features/desktop-client-protocol-followups-2.md` § Acceptance criteria (Download; Fixtures and documents)
- Documents that mention the token or the old flow (found at planning with `rg -il "download_token|download token|transferToken|invalid_or_expired_token"`):
  `AGENTS.md` (root, § Protocol overview), `docs/desktop-client-handoff.md`, `packages/client/AGENTS.md`, `packages/protocol/AGENTS.md`, `packages/server/AGENTS.md`, `packages/server/README.md`, `packages/protocol/fixtures/external-clients/README.md`, `swe/MAIN-SCOPE.md`, `swe/features/file-explorer-transfer.md`, `swe/features/desktop-client-protocol-followups.md`, `swe/features/feature-panels-ui.md`, `swe/features/inline-image-rendering.md`, `docs/molviewer-integration-scope.md`, `docs/plan-a.md`
- `swe/architecture/websocket-protocol.md` (append-only rule), `swe/architecture/external-client-fixtures.md` (breaking-change procedure)
- `swe/av-swe.config.json` § `gateNotes.liveChecks`

## What to build
Documents:
- `swe/features/file-explorer-transfer.md`: rewrite the download section to the built flow and remove the "Planned change" banner at its top.
- `swe/features/desktop-client-protocol-followups.md`: mark "the token flow does not change" as superseded.
- `swe/architecture/websocket-protocol.md`: record the one exception to the append-only rule (spec decision D4) and what was removed.
- `swe/architecture/external-client-fixtures.md` and the fixtures `README.md`: the first breaking bump (`formatVersion` 2) and the new files.
- Root and package `AGENTS.md` / `README.md` files listed above: the request by path, the response-before-stream order, ranges, `ifUnchanged`, cancel, `fileDownloadRanges`, the SDK's `downloadTo`.
- `docs/desktop-client-handoff.md`: the file-transfer section (wire flow, what a Rust engine implements, "no resume" now true only for uploads), the fixture counts, the plan table.
- Historical documents (`docs/plan-a.md`, `docs/molviewer-integration-scope.md`): change only statements presented as current behaviour.
- Tick the Download criteria in the spec that the checks below prove.

Live checks, run in the orchestrator against an isolated production daemon (its own `PI_STUDIO_HOME` and port):
- a 600 MiB file downloaded whole, and as consecutive ranges, with matching SHA-256;
- a download aborted part-way and resumed with `offset` and `ifUnchanged`, matching SHA-256; the same resume after touching the file answers `changed`;
- a cancel that stops a running download while a second download on the same connection completes;
- a client that stops reading for several seconds: the daemon's RSS growth stays far below the file size;
- in a browser against that daemon: "Download" from the Files explorer, and viewing an image and a PDF.
Record the measured figures in the spec and the handoff document.

## Out of scope
- Agent stream mode and the CLI's JSON output (sprint 098).
- LAN or relay measurements.

## Acceptance criteria
- [ ] `rg -il "download_token|transferToken|invalid_or_expired_token"` over the repository (outside `swe/sprints/` and the fixtures changelog) finds only text that describes the removal.
- [ ] `swe/features/file-explorer-transfer.md` describes the built download flow and no longer carries the planned-change banner.
- [ ] `docs/desktop-client-handoff.md` matches the repository for everything this sprint changed.
- [ ] Each live check above was run and its result recorded, or the summary names the one that could not be run and why.
- [ ] `npm run build`, `npm run typecheck`, `npm run lint` and `npm test` pass.

## Test / verification plan
- `npm run build && npm run typecheck && npm run lint && npm test`
- Live checks as listed; keep the scripts out of the repository.

## Notes
- Sprint 096 measured a 600 MiB loopback download at about 7 s and a daemon RSS growth of about 58 MB with the client paused for 6 s. Use those as the comparison, and say when a figure was not re-measured.
- The water marks are still the chosen 1 MiB and 256 KiB.
