# Task 003 — Linux live checks of the update in the real webview (AppImage and .deb), recorded — Summary

- **Sprint:** sprint-133-desktop-update-ui
- **Completed:** 2026-11-23
- **Status:** done (orchestrator)

## What was implemented
- Test builds A (0.3.0) and B (0.3.1) as AppImage and `.deb` from a clean worktree with a throwaway key; the update driven through the control socket, the indicator and the native Help menu/dialog (xdotool), in the `pi-desktop-xvfb` container.
- Rows U-L1..U-L11 with evidence in `desktop/docs/platform-checks.md`; recipe in `desktop/docs/development.md` § The app's self-update in the real webview.
- Bug found and fixed: the plug-in logged the manifest address at error level on a failed check; `logging.rs` now never logs the `tauri_updater` target (test added).

## Files changed
`desktop/apps/pistudiodesktop/src-tauri/src/logging.rs`, `desktop/docs/{platform-checks,development}.md`

## Build & test results
```
Wave gate: cd desktop && cargo fmt --all && cargo xtask ci -> all 8 steps passed; root npm run build, typecheck ok; lint 0 errors; npm test -> 299 files / 4281 tests passed; node --test 'scripts/release/*-test.mjs' 25 passed
```

## Acceptance criteria
- [x] AppImage A->B and .deb A->B (rule and a text agent); dismissed -> refused; no pkexec -> cannot_install(no_pkexec) with no download; wrong signature -> nothing changed; offline -> silent plus one code; transfer at restart; setting off; menu item and dialog.
- [x] The browser client unchanged (checked by Main on 2026-11-23).

## Follow-ups
- Not seen: a FUSE-mounted AppImage (extracted run only), a graphical polkit Cancel (126), .rpm, .msi, NSIS, macOS, the codes manifest_invalid/no_target/download live.
- Orchestrator change after this task: a `refused` failure now opens the release page from the indicator (spec error table), with a test.
- The `WARN ... not detected as an AppImage` under extract-and-run: [INFERENCE] from not mounting with FUSE.
- The close question reads "Quit anyway?" (wording).
- `desktop/AGENTS.md` 'Where it stands' to be updated in 134/t003.
