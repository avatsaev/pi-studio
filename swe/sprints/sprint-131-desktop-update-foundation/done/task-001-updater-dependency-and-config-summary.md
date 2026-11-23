# Task 001 — The updater plug-in, its configuration, the test overlay and version 0.3.0 — Summary

- **Sprint:** sprint-131-desktop-update-foundation
- **Completed:** 2026-11-23
- **Status:** done (orchestrator)

## What was implemented
- `tauri-plugin-updater = "2"` (default features: rustls with ring, system proxy, zip) in the workspace and the app binary only; registered in `main.rs`. No `aws-lc` in `Cargo.lock`; every new crate's licence is permissive (MIT, Apache-2.0, ISC, Zlib, CC0, MIT-0) and listed in `ATTRIBUTION.md`.
- `tauri.conf.json` `plugins.updater`: the manifest endpoint, `windows.installMode: passive`, and a placeholder `pubkey` (the public half of a throwaway pair; the real key is 131/t002). No `createUpdaterArtifacts`, no `dangerous*` key.
- `tauri.update-test.conf.json`: `createUpdaterArtifacts: true`, `dangerousInsecureTransportProtocol: true`, no `pubkey` (a run generates a throwaway pair and merges its public key into a copy; recipe in the header of `tests/updater_config.rs` and `docs/architecture.md`).
- Guard test `src-tauri/tests/updater_config.rs` (5 tests); shown failing once with a `dangerous*` key added.
- Version line 0.3.0.

## Files changed
`desktop/Cargo.toml`, `Cargo.lock`, `ATTRIBUTION.md`, `apps/pistudiodesktop/src-tauri/{Cargo.toml,tauri.conf.json,tauri.update-test.conf.json,src/main.rs,tests/updater_config.rs}`, `docs/architecture.md`

## Build & test results
```
Wave gate (combined tree): cd desktop && cargo fmt --all && cargo xtask ci -> all 8 steps passed; npm run build, typecheck ok; npm run lint 0 errors; npm test -> 299 files / 4280 tests passed
```

## Acceptance criteria
- [x] xtask ci passes, no aws-lc; licences listed; guard test fails on a `dangerous*` key; snapshot passes.

## Follow-ups
- The `pubkey` is a placeholder until 131/t002.
- The app was not launched with the placeholder key: the plug-in's startup parse of it is untested until a live run (133/t003).
- The spec's TODO(verify) on licences and `aws-lc` is answered.
