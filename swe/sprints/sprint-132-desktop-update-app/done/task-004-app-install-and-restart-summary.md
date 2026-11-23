# Task 004 — App binary: download, install (incl. `pkexec`), and restart — Summary

- **Sprint:** sprint-132-desktop-update-app
- **Completed:** 2026-11-23
- **Status:** done (orchestrator)

## What was implemented
- The plug-in's `Update` is kept from the check (a later check replaces it); download with progress and a 15 min limit (set on the clone: the check's 30 s would otherwise apply); error mapping: signature mismatch/encoding/version -> `signature`, connect/timeout -> `offline`, bad status/cut stream -> `download`, plug-in install failure -> `install`.
- Install by kind: AppImage and macOS app through the plug-in's `install(bytes)`; `deb`/`rpm` through the app's own `pkexec dpkg -i|rpm -U <file>` (file 0600 in a 0700 cache directory, removed in every path by a `Drop` guard; exit 126/127 -> `refused`; other, a signal or a pkexec that does not start -> `install`); a leftover file removed at launch; the plug-in's own package install is never used.
- Windows: the first click keeps the bytes; at restart the app saves its stored keys, then the plug-in's `install` starts the installer; a failed start -> `failed(install)` with the version and link.
- Restart: the close question first when transfers run (Cancel keeps `restart_needed`), then `request_restart()`; a second click is ignored; quitting drops the kept bytes (process memory).
- Spec change: `UpdaterHook::restart` returns `Result<(), UpdateCode>`; the `Updater` remembers the release URL so a failed Windows restart shows `failed(code, version, releaseUrl)`.

## Files changed
`src-tauri/src/update/{install.rs,install/tests.rs}`, `src-tauri/src/{update.rs,update/tests.rs,main.rs,services.rs,bridge.rs}`, `crates/shell/src/{update.rs,update/tests.rs,owner.rs,tests.rs}`, `desktop/AGENTS.md`, `docs/{architecture,control-protocol}.md`

## Build & test results
```
Gate: cd desktop && cargo fmt --all && cargo xtask ci -> all 8 steps passed (the agent's run, then 3 of my 4 runs; one run failed once at `test` with no failure left in the log: the flake noted earlier, untraced); root npm run build, typecheck ok; lint 0 errors; npm test -> 299 files / 4280 tests passed
```

## Acceptance criteria
- [x] pkexec exit-code mapping and the file's mode/removal in every path (fake runner); a signature failure writes nothing (fake and real plug-in over local HTTP); a restart refuses on a no to the close question.

## Follow-ups
- Not verified without a live run: `pkexec` with a real agent and `dpkg`/`rpm`, 126/127, the AppImage and macOS swaps, the Windows installer start, `request_restart` bringing the new build up, quitting mid-install, a real signature (needs a build made with a key) -> 133/t003 and 134.
- `pkexec` is given `dpkg`/`rpm` by name (resolved through PATH by pkexec, from memory); the file path is a separate argument.
- The Windows restart saves only the stored keys, then the process ends without exit events.
