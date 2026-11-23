# Task 003 — The manifest script and its contract test against the plug-in's types — Summary

- **Sprint:** sprint-131-desktop-update-foundation
- **Completed:** 2026-11-23
- **Status:** done (orchestrator)

## What was implemented
- `scripts/release/update-manifest.mjs` (`--dir --version --base-url --release-url [--self-check] [--require] [--pub-date] [--out]`): finds update files by suffix and their `.sig`, writes `latest.json` or `self-check.json` with the seven targets (macOS universal file for both darwin targets); `--self-check` gives `<next patch>-selfcheck`; a missing/empty `.sig`, a missing required kind or two files of one kind fail. Spaces in asset names become dots (GitHub's rewrite) before URL encoding.
- Two committed fixtures; a Rust test deserializes them with the plug-in's public `RemoteRelease` and repeats its target lookup order over the public fields.

## Files changed
`desktop/apps/pistudiodesktop/scripts/release/{update-manifest.mjs,update-manifest-test.mjs,fixtures/latest.json,fixtures/self-check.json}`, `src-tauri/tests/update_manifest.rs`

## Build & test results
```
Wave gate: cd desktop && cargo fmt --all && cargo xtask ci -> all 8 steps passed (after fixing one oxlint error in update-manifest.mjs and the CLI's command-list test); root npm run build, typecheck ok; lint 0 errors; npm test -> 299 files / 4280 tests passed; node --test 'scripts/release/*-test.mjs' -> 21 passed
```

## Acceptance criteria
- [x] node cases (complete set, missing sig, missing kind, self-check ordering); Rust fixture test.

## Follow-ups
- Run with the glob `node --test 'scripts/release/*-test.mjs'` (`node --test <dir>` fails on Node 24). The test is named `-test.mjs` so the vitest include (`scripts/**/*.test.mjs`) skips it.
- Regenerate fixtures with `UPDATE_FIXTURES=1`.
- 134/t002: `--base-url https://github.com/avatsaev/pi-studio/releases/download/desktop-v<N>`, `--release-url .../releases/tag/desktop-v<N>`, all files in one flat directory, run twice (plain and `--self-check`).
