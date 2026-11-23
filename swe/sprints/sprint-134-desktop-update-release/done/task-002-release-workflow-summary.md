# Task 002 — `desktop-release.yml`: signed update files, per-release manifests, the three-system update check and promotion — Summary

- **Sprint:** sprint-134-desktop-update-release
- **Completed:** 2026-11-23
- **Status:** done (orchestrator)

## What was implemented
- `bundle-release` (publishing runs only, `environment: desktop-release`, `TAURI_SIGNING_PRIVATE_KEY`, overlay with `createUpdaterArtifacts`) is a job of its own, so no job a PR run executes names the environment or the secret; `bundle` (manual and PR runs) builds test builds with a throwaway key: P 0.0.1 and N, both with every format, the universal macOS build as in the release.
- Staging signs a copy of every update file with `--app-version <next>-selfcheck` into `<file>.selfcheck.sig` (`self-check-signatures.mjs`, no shell, copies across drives); `release` makes `latest.json` and `self-check.json` with `update-manifest.mjs` and uploads them with the installers and `.sig` files; `update-check` (matrix of three, fail-fast off) installs P (from `desktop-updates/latest.json`; absent -> self check only) or N, runs `update-check.mjs`, uploads its output; in a PR run it serves the test files from `serve-directory.mjs` on 127.0.0.1:8791; `promote` creates `desktop-updates` (`--latest=false`) the first time and `gh release upload --clobber`s `latest.json` only when every check passed.
- `next-version.mjs` (+ test) makes the version step ignore the `desktop-updates` tag; the `version` job runs `node --test scripts/release/*-test.mjs`.
- Composite action `.github/actions/desktop-build-tools`; `set-version.sh`; a macOS diagnostics step on failure.
- Product fix found by the check: `control_server::bind` retries a port in use for 10 s (50 ms steps), because on macOS Tauri's restart starts the new instance while the old one holds the `--control` port; 4 tests.
- Docs: `AGENTS.md`, `desktop/AGENTS.md`, `docs/{development,control-protocol}.md`.

## Files changed
`.github/workflows/desktop-release.yml`, `.github/actions/desktop-build-tools/action.yml`, `desktop/apps/pistudiodesktop/scripts/release/{next-version,self-check-signatures,serve-directory}(.mjs,-test.mjs)`, `set-version.sh`, `update-manifest.mjs` (exports `findBySuffix`), `src-tauri/src/control_server.rs`, docs

## Build & test results
```
Gate on the final tree: cd desktop && cargo fmt --all && cargo xtask ci -> all 8 steps passed; root npm run build, typecheck ok; lint 0 errors; npm test -> 299 files / 4281 tests passed; PR #65 run 45278838906: gate, Version, Bundle x3, Update check x3 succeeded, Bundle for release / Release / Promote skipped
```

## Acceptance criteria
- [x] PR run: update-check passes on three systems (Linux AppImage 12/12 and .deb 13/13, macOS 12/12, Windows 12/12, each P 0.0.1 -> N then N -> N); release and promote skipped; times: Linux 83 s, macOS 33 s, Windows 53 s per job; bundle jobs 10-18 min.
- [x] No PR job names the environment or the secret.

## Follow-ups
- Only a publishing run can check: `bundle-release` with the environment and secret; the real signatures and `.selfcheck.sig` over real files; `release` over the real flat directory (six kinds, `.rpm`/`.msi` with `.sig`) and GitHub's space-to-dot rename; `update-check`'s release path (Fetch the installers, with `gh`); `promote`; how long the check adds to a real release.
- Deviations from the spec: `bundle`/`bundle-release` split; `update-check` needs the whole bundle matrix; the release uploads `.sig` files but not `.selfcheck.sig`; extra macOS diagnostics step.
- Risks: macOS runner queues; the key is an env var of the whole bundle step; `polkitd` start untested beyond one runner image.
