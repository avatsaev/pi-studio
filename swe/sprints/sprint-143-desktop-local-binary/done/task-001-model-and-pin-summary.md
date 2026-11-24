# Task 001 — The pin and the new local model — Summary

- **Sprint:** sprint-143-desktop-local-binary
- **Completed:** 2026-11-24
- **Status:** done

## What was built
- `desktop/daemon-pin.json` written by `daemon-pin.mjs` from the published `latest.json` (daemon 0.0.131, four targets).
- `model::pin`: `DaemonPin::{parse, built_in, asset(target)}`, `target_of(os, arch)`, `this_target()` (None on Windows); validation: `M.m.p` version, exactly the four targets, http(s) url, 64-hex sha256, size > 0; errors carry no address; a test parses the committed file (an invalid pin fails `cargo test`/`xtask ci`).
- `LocalState`: `unsupported`, `outdated{version}`, `checking`, `downloading{received,total}`, `installing`, `stopped`, `starting`, `stopping`, `updating`, `running`, `failed`; `FailReason`: `not_healthy`, `timeout`, `bad_output`, `spawn_failed`, `download_failed`, `checksum_mismatch`, `install_failed` (`cli_missing`, `cli_outdated`, `update_failed` removed from the local side; the SSH `RemoteState` untouched). Serde forms pinned in tests, removed forms rejected.
- `cliPath` removed from settings, `settings.set/get`, the batch JSON and the Daemons screen (an old key is ignored on load; `settings.set cliPath` is `BadParams`).
- `--daemon-pin <FILE>` (`src-tauri/src/daemon_pin.rs`, 64 KiB cap; invalid file = exit 2, message names the option, no path/address; log `daemon pin: <version> (built in|override)`).
- `desktop-release.yml`: the pin step and "Write the daemon pin" now run on every publishing run (guards removed).
- TypeScript adjusted only to compile (workbench `host/types.ts`, daemons presentation/view/actions/screen/css, test-daemons; desktop `daemons-view.ts`, `daemons.ts`) — the real page is 143/004.

## Results
`cd desktop && cargo fmt --all && cargo xtask ci` 8/8 green; clippy clean; `npx tsc -b --force` clean; `npm run build:workbench` ok; desktop frontend `npm run check`/`lint` clean, `npm test` 322 passed; workbench daemons/connection/test vitest 296 passed.

## Acceptance
- [x] Model and engine tests, serde forms pinned. [x] `cargo xtask ci` green.

## Follow-ups
- The supervisor still runs the old `pi-studio update` flow and produces none of the new states: 143/003.
- Platform-check scripts still use `cliPath`/`cli_outdated` (`scripts/platform-checks/macos.mjs` ~l.287-309, 481) and `cli_missing` (`windows.mjs` ~l.79): to be updated with 143/003; they fail on runners until then. Historical rows in `desktop/docs/platform-checks.md` keep the old names on purpose.
