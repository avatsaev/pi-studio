# Task 008 — Follow-ups close: docs, spec ticks, live checks, full gates — Summary

- **Sprint:** sprints/sprint-096-desktop-protocol-followups
- **Completed:** 2026-11-14
- **Status:** done

## What was implemented
Spec `desktop-client-protocol-followups.md` marked shipped with every acceptance criterion ticked (evidence noted per line) and the live check recorded under the water-mark note; MAIN-SCOPE spec row and § 10 item resolved; PLAN row 096, the task-007 row (binary manifest lives in `binary/`) and the follow-ups checkbox updated; handoff doc status table/plan row/last-updated/transfer facts brought to the real wire with the 0.0.118 marker; `hello.platform.json` reformatted with oxfmt (fixture tests still pass). Root/protocol/client/server AGENTS and the fixtures README already described the shipped behaviour from tasks 001-007.

## Files created / changed
| File | Change |
|------|--------|
| `swe/features/desktop-client-protocol-followups.md` | status, criteria, live check |
| `swe/MAIN-SCOPE.md` | spec row, §10 |
| `swe/sprints/PLAN.md` | 096 row, task-007 row, checkbox |
| `docs/desktop-client-handoff.md` | status, plan row, measured facts |
| `packages/protocol/fixtures/external-clients/hello.platform.json` | oxfmt |

## How it satisfies the scope
Relay not exercised live (needs a relay + pairing + E2EE client); no unpaced control run for the download memory figure; water marks stay chosen, not measured.

## Build & test results
```
LIVE (isolated production daemon :6790, ports/files cleaned up): (1) 600 MiB upload via the browser UI, SHA-256 match, JS heap 14-19 MB (task-005). (2) 600 MiB download via the SDK with the client's TCP socket paused 6 s: daemon RSS +58 MB (166->224), then resumed, completed in ~7 s with matching SHA-256. (3) A DaemonClient with platform 'desktop'/clientType 'browser' appears in daemon_status_request clients as platform:'desktop'. GATES: npm run clean && build && typecheck && lint: exit 0 (warnings pre-existing); npm test: 270 files / 3705 tests pass; oxfmt --check over all 478 branch-changed code/JSON files: only packages/web-client/package.json fails (pre-existing, not touched by this work) after reformatting hello.platform.json. Repo-wide fmt:check is red outside this branch (39 pre-existing files).
```

## Acceptance criteria
['Every criterion in the spec is ticked: met.', 'Handoff doc describes the wire with versions: met (0.0.118 markers).', 'All gates pass from a clean tree: build/typecheck/lint/test yes; fmt:check not repo-wide (pre-existing failures).', 'Summary lists what the desktop agent can rely on: below.', 'Handoff doc matches repo: updated.']

## Follow-ups / TODO(verify)
- Desktop agent can now rely on: `hello.platform` (daemon stores it, shows it in daemon_status; invalid values dropped); `fileTransferAck` + `file_upload_complete` for real upload completion with the daemon's reason; paced daemon downloads on direct connections; `Error` frame without `End` on read failures; session-owned upload streams; `Transport.bufferedAmount` and the SDK's paced, abortable, progress-reporting `upload` as a reference flow; 29 JSON + binary fixtures for file transfer and terminals; a dev daemon that serves file transfer and terminals; a browser host upload that never reads the file whole.
- Unverified: relay live, LAN/relay water marks, Tauri webview dialogs/links.
