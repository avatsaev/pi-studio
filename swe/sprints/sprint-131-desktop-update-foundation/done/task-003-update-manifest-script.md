# Task 003 — The manifest script and its contract test against the plug-in's types

- **Sprint:** sprints/sprint-131-desktop-update-foundation
- **Status:** done
- **Type:** feature
- **Area:** desktop/apps/pistudiodesktop/scripts/release, src-tauri tests
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
`update-manifest.mjs` turns a directory of signed release files into `latest.json` and
`self-check.json`; the plug-in's own type reads its output.

## Context / why
Spec § 2 (Release files), U3, U6, P3, P4, P7.

## Scope references
- `swe/features/desktop-self-update.md` § 2, U3, U6
- New: `desktop/apps/pistudiodesktop/scripts/release/update-manifest.mjs` (+ `.test.mjs`, node's test
  runner like `scripts/platform-checks/*.test.mjs`), a committed fixture, a Rust test in `src-tauri`

## What to build
- Input: `--dir <files> --version <N> --base-url <asset URL prefix> --release-url <page>`
  `[--self-check]`. Finds each update file by suffix (`.AppImage`, `.deb`, `.rpm`, `.app.tar.gz`,
  `-setup.exe`, `.msi`) and its `.sig`; fails if an expected file or signature is missing
  (`--require <kinds>` names which).
- Output `latest.json`: `version` N, `pub_date`, `notes` = release URL, `platforms` keyed
  `linux-x86_64-appimage|deb|rpm`, `darwin-aarch64`, `darwin-x86_64` (same file), `windows-x86_64-nsis|msi`.
- `--self-check`: the same files under version `<next patch>-selfcheck` (U6).
- A fixture made by the script, committed; a Rust test deserializes it with the plug-in's
  `RemoteRelease` and checks each target resolves.

## Out of scope
Uploading (sprint 134).

## Acceptance criteria
- [ ] Node tests: complete set; a missing `.sig`; a missing required kind; the self-check version
  ordering (greater than N, semver).
- [ ] Rust test reads the fixture with the plug-in's type.

## Test / verification plan
- `node --test desktop/apps/pistudiodesktop/scripts/release/`
- `cd desktop && cargo xtask ci`
