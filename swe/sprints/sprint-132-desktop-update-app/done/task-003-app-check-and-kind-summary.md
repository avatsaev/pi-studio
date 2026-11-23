# Task 003 — App binary: the check through the plug-in, the install kind, `--update-manifest`, the event and the menu dialog — Summary

- **Sprint:** sprint-132-desktop-update-app
- **Completed:** 2026-11-23
- **Status:** done (orchestrator)

## What was implemented
- `src-tauri/src/update.rs`: `PluginUpdater` implements `UpdaterHook`: `check` (plug-in, 30 s, the manifest endpoint or `--update-manifest`, an explicit `.target(..)` per kind and U12's first-kind entry when unknown); error mapping to `offline`/`manifest_invalid`/`no_target`; the release link is the manifest's `notes` only when it is `https`, else the releases page; `kind_of` (macOS `App` only inside `*.app/Contents/MacOS`) and the four `cannot_install` rules with injected probes; `Runner` (begins on the owner thread, runs on `spawn_blocking`) implements `Notify::update`; the menu check with U11's Install/Later dialog; the schedule thread (launch, hourly tick with the 24 h rule) and the wake hook; `update_changed` emitted on every change; the menu redrawn when `update.check`'s enabled flips.
- `main.rs` option `--update-manifest <URL>`; macOS application-menu item after About, Help menu elsewhere; `Native` shared and implements `Prompts`.
- `download`/`install` return `UpdateCode::Install` and `restart` only logs: no pretend success; 132/t004 replaces them.
- 37 tests including the real plug-in against a local `TcpListener` manifest server (newer, equal, older, missing entry, bad manifests, 404, closed port, headers).

## Files changed
`desktop/apps/pistudiodesktop/src-tauri/src/{update.rs,update/tests.rs,main.rs,bridge.rs,daemons.rs,menu.rs,resume.rs,services.rs}`, `desktop/AGENTS.md`, `docs/{architecture,control-protocol}.md`

## Build & test results
```
Wave gate: cd desktop && cargo fmt --all && cargo xtask ci -> all 8 steps passed; root npm run build, typecheck ok; lint 0 errors; npm test -> 299 files / 4280 tests passed
```

## Acceptance criteria
- [x] kind and every cannot_install rule; error mapping; `--update-manifest` parsed and shown as `manifest: override`; a check against a local manifest server finds a newer version.

## Follow-ups
- Not run live (no display): the native menu item, the Install/Later dialog, a real wake.
- The plug-in logs `failed to check for updates: {err}` at error level from its own target; with `--update-manifest` that line can carry the override URL (the spec says no URL but the fixed one): check at the live run and filter it if it does.
- `is_writable` creates and removes `.pi-studio-update-probe-<pid>` in the AppImage's directory.
- reqwest follows `HTTP_PROXY`: a proxied CI could break the loopback tests.
- 132/t004 must keep or re-check the plug-in's `Update`, which `check` currently drops.
- A page-initiated and a menu check racing can show the dialog on the wrong one (rare).
