# Task 002 — Documents and spec close for milestone 4 — Summary

- **Sprint:** sprint-130-desktop-relay-ssh-close
- **Completed:** 2026-11-22
- **Status:** done (orchestrator)

## What was implemented
- Specs amended with a dated marker and the stale sentences corrected: `desktop-transport-bridge.md`, `desktop-daemon-registry.md`, `desktop-transfer-engine.md`, `workbench-host-adapter.md`, `ssh-gateway-connections.md` (status: built). The spec `desktop-relay-ssh.md` itself aligned with the code (the `no_current` and `exec_failed` details, the `known_hosts` code, the built signatures of `relay::connect` and `Session::open_daemon`), its acceptance criteria and TODOs ticked with what was seen, and three left open on purpose (SDK 45 s wait; `-lic` on zsh/fish; Windows/macOS run).
- `desktop/AGENTS.md` (crate map and layer table with `relay` and `ssh`, `DaemonSocket`, rule 10 without an exception, milestone paragraphs), `desktop/docs/architecture.md`, `control-protocol.md`, `desktop/README.md`, `packages/workbench/AGENTS.md`, `packages/client/AGENTS.md`, root `AGENTS.md` (desktop paragraph).
- `docs/desktop-client-handoff.md` and `swe/MAIN-SCOPE.md`: milestone 4 built; `PLAN.md`: close note.
- Grep for `not_bridged` and `webview's own socket` in current docs: only history (run records, task summaries, the grill) and the markers that say they no longer exist remain.

## Files changed
see the summary of the documents above; `swe/features/desktop-relay-ssh.md`, `docs/desktop-client-handoff.md`, `swe/MAIN-SCOPE.md`, `swe/sprints/PLAN.md`

## Build & test results
```
grep -rn "not_bridged\|webview's own socket" swe docs desktop packages --include=*.md -> history only (sprint summaries, the grill, run records, the amendment markers)
```

## Acceptance criteria
- [x] No document says a relay entry uses the page's socket or that a command returns the link, outside history and amendment markers.

## Follow-ups
- `xtask/src/layers.rs`'s `TABLE` doc comment still says only `transfer` and an app binary may use `net` (the layer check allows `relay` and `ssh`): fix when next touching xtask.
