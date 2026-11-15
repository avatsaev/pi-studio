# Task 007 — Download: documents to the real wire, live checks — Summary

- **Sprint:** sprints/sprint-097-download-ranges
- **Completed:** 2026-11-15
- **Status:** done

## What was implemented
**Documents** (a docs subagent plus the orchestrator): `swe/features/file-explorer-transfer.md` rewritten to the built download flow, planned-change banner removed; `swe/features/desktop-client-protocol-followups.md` marks "the token flow does not change" superseded; `swe/architecture/websocket-protocol.md` records the one append-only exception (D4); `swe/architecture/external-client-fixtures.md` and the fixtures README cover the first breaking bump (`formatVersion` 2) and the new files; root `AGENTS.md` (sprint-097 bullet, fixtures bullet), `packages/{protocol,client,server,workbench}/AGENTS.md`, `packages/server/README.md`, `swe/MAIN-SCOPE.md`, `swe/features/{feature-panels-ui,inline-image-rendering}.md`, `docs/desktop-client-handoff.md` (transfer section, plan/status tables, fixture counts: 83 JSON entries, ten binary fixtures, measurements) and the two historical docs (current-behaviour lines only). A stale source comment in `packages/workbench/src/hooks/use-file-text.ts` was corrected. The spec's Download and fixtures criteria are ticked, with notes where the built behaviour differs (SDK holds an aborted stream id until the daemon's final frame).

**Live checks** (isolated production daemon, own `PI_STUDIO_HOME` and port 6869; SDK client in Node; scripts kept outside the repository and deleted):
| Check | Result |
|---|---|
| 600 MiB file downloaded whole | SHA-256 matches; 0.7 s (~890 MiB/s, page cache) |
| Ten consecutive 64 MiB ranges | SHA-256 matches |
| Abort at ~200 MiB, resume with `offset` + `ifUnchanged` | SHA-256 matches; aborted stream id released by the daemon's final frame |
| Same resume after touching the file | rejected with `changed` |
| Cancel one running download while a second (150 MiB range) runs on the same connection | second intact (hash matches); both ids released |
| Client TCP socket paused 6 s | daemon RSS 205 → peak 242 MiB (+37 MiB vs a 600 MiB file); download completes, SHA-256 matches, 6.6 s |
| Response vs stream | first `Chunk` 2 ms after the request |
| Headless Chromium against that daemon | image viewer rendered (blob URL, 96×96); PDF rendered via pdf.js; "Download" from the explorer menu and the PDF toolbar saved byte-identical files; no page errors |

Not measured: LAN, relay, an unpaced control run. The sprint 096 comparison figure (+58 MB, ~7 s) used a different file cache state and method, so it is cited but not compared.

## Files created / changed
Documents above; `packages/workbench/src/hooks/use-file-text.ts` (comment only).

## Build & test results
```
$ npm run build; npm run typecheck     success
$ npm test                              Test Files 270 passed / Tests 3762 passed
$ npm run lint                          0 errors (warnings only in untouched files)
$ rg -il "download_token|transferToken|invalid_or_expired_token" (outside swe/sprints and the fixtures changelog)
  remaining hits describe the removal or are history (listed in the sweep report)
```

## Acceptance criteria
- [x] `rg` finds only text that describes the removal (plus a TODO(verify) about out-of-tree readers in `MAIN-SCOPE.md`).
- [x] `file-explorer-transfer.md` describes the built flow, no banner.
- [x] `docs/desktop-client-handoff.md` matches the repository for what this sprint changed.
- [x] Every live check was run and recorded (table above).
- [x] `npm run build`, `typecheck`, `lint`, `test` pass.

## Follow-ups / TODO(verify)
- Out-of-tree readers of `transferToken` were not checked (`swe/MAIN-SCOPE.md`).
- `lru-cache` in `packages/server/package.json` appears unused in `src` after the token store's removal; not removed here (out of scope), worth a check.
- `packages/server/AGENTS.md:5` says "HTTP health/download endpoint", unrelated to this sprint and contradicted at line ~1884.
- Browser check used headless Chromium; no PDF/image check at large sizes.
