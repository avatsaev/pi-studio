# Task 001 — The updater plug-in, its configuration, the test overlay and version 0.3.0

- **Sprint:** sprints/sprint-131-desktop-update-foundation
- **Status:** backlog
- **Type:** chore
- **Area:** desktop/Cargo.toml, desktop/apps/pistudiodesktop/src-tauri (config), ATTRIBUTION.md
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal
The app binary depends on `tauri-plugin-updater` and starts it; `tauri.conf.json` has the endpoint and
Windows mode; a test overlay exists; the version line is 0.3.0.

## Context / why
Spec § 1 (Configuration and build), U2, U5, P15, P5. The real public key comes in task-002; until
then `pubkey` holds a placeholder the build accepts.

## Scope references
- `swe/features/desktop-self-update.md` § 1, U2, U5, P5, P15, § TODO(verify) (licences, aws-lc)
- `desktop/Cargo.toml`, `desktop/Cargo.lock`, `desktop/apps/pistudiodesktop/src-tauri/Cargo.toml`
- `desktop/apps/pistudiodesktop/src-tauri/tauri.conf.json`, new `tauri.update-test.conf.json`
- `desktop/apps/pistudiodesktop/src-tauri/src/main.rs` (plug-in registration)
- `desktop/ATTRIBUTION.md`, `desktop/xtask/src/layers.rs` (`FORBIDDEN_PACKAGES` unchanged)

## What to build
- `tauri-plugin-updater = "2"` in the workspace table (the Tauri family comment), used by the app
  binary only; registered at startup. Default features (`rustls` with `ring`, system proxy, `zip`).
- `tauri.conf.json` → `plugins.updater`: `endpoints` = the fixed manifest URL of spec § 1,
  `windows.installMode: "passive"`, `pubkey`: a placeholder the build accepts until task-002 sets
  the real key (record which in the summary). No `createUpdaterArtifacts`, no `dangerous*` key.
- `tauri.update-test.conf.json`: `createUpdaterArtifacts: true`,
  `plugins.updater.dangerousInsecureTransportProtocol: true`; its `pubkey` is supplied per run
  (document how: the run generates a throwaway key and passes a merged config).
- A test (Rust or the frontend's node tests) that fails if `tauri.conf.json` holds any `dangerous*`
  updater key or `createUpdaterArtifacts`.
- `[workspace.package] version = "0.3.0"`.
- `ATTRIBUTION.md`: the new crates and their licences.

## Out of scope
The real key (task-002); any update logic (sprint 132).

## Acceptance criteria
- [ ] `cargo xtask ci` passes; `Cargo.lock` has no `aws-lc-rs`/`aws-lc-sys`.
- [ ] Every new crate's licence is permissive and listed.
- [ ] The guard test fails when a `dangerous*` key is added to `tauri.conf.json` (shown once, then reverted).
- [ ] `npm run snapshot` in `desktop/apps/pistudiodesktop` still passes (the CSP is unchanged).

## Test / verification plan
- `cd desktop && cargo xtask ci`
- `cd desktop/apps/pistudiodesktop && npm run check && npm run snapshot`

## Notes
TODO(verify) from the spec: the plug-in's dependencies (`minisign-verify`, `zip`, `tar`, `flate2`,
`infer`, `osakit`) and the absence of `aws-lc`. If `aws-lc` appears, stop and report.
