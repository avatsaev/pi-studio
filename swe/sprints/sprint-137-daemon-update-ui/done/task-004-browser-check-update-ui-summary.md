# Task 004 — Browser check of the update UI against the dev daemon's scripts — Summary

- **Sprint:** sprint-137-daemon-update-ui
- **Completed:** 2026-11-23
- **Status:** done (orchestrator)

## What was implemented
- Seen in headless Chromium, dark and light, two clients on separate origins, vite on 5211 against scratch dev daemons: `available` (orange pill, dialog 0.0.129 -> 9.9.9, three stages, the other client's grey 'Daemon updating', reconnect wait, 'Updated to 9.9.9' once per client, a working Reload), `cannot` (reason, command, Copy), `fail` (red pill, message, Retry), `rollback` (via Settings, 'back on 0.0.129'), another client's terminal counted, unset (no pill, Settings shows version and kind), a daemon without the flag (no pill, no category). Screenshots under `/tmp/duui-shots` (not committed).
- Defects fixed: the dialog undercounted running agents (now from `list_agents_request`, with `countRunningListedAgents` tested); the command box clipped long commands (wraps).

## Files changed
`packages/workbench/src/features/daemon-update/{daemon-update-dialog-view.ts,daemon-update-dialog-view.test.ts,use-update-impact.ts,DaemonUpdateDialog.module.css}`, `packages/workbench/AGENTS.md`

## Build & test results
```
Gate: npm run build, typecheck ok; lint 0 errors; npm test -> 318 files / 4536 tests passed; cd desktop && cargo fmt --all && cargo xtask ci -> all 8 steps passed
```

## Acceptance criteria
- [x] every state in both themes with two clients; counts include another client's terminal; no pill without the flag.

## Follow-ups
- Not seen: the real `failed` outcome (daemon down), the desktop host, relay clients, Escape blocked while restarting; 'no flag' came from a scratch script that strips the flag.
- Two tabs of one browser profile share the shown-result marker (per-client storage, as specified).
