# Task 003 — The desktop pin step — Summary

- **Sprint:** sprint-141-binary-release
- **Completed:** 2026-11-24
- **Status:** done

## What was built
`desktop/apps/pistudiodesktop/scripts/release/daemon-pin.mjs` (+ test): `--manifest <url> (--min <v> | --min-from <rust file>) --out <file> [--wait-minutes N]`; retries every 60 s while the version is below the minimum or the fetch fails, then fails `no daemon binary ≥ <min> is published`; a malformed manifest fails at once; writes `{version, assets}` for the four targets. `--min-from` reads `MIN_CLI_VERSION` from `desktop/crates/shell/src/cli_answers.rs` (where the constant lives). `desktop-release.yml`: the `version` job gets "Pin the daemon binary" (release runs only, and only when `desktop/daemon-pin.json` exists) exposing a job output; `bundle-release` writes it before the build (a job output, not an artifact: the release job attaches every artifact). Nothing else in the workflow changed (promote condition included). `desktop/docs/development.md` lists the script.

## Results
Desktop release-script tests 56 pass; root 9 pass; actionlint clean on the added steps. The step has never run against a real manifest; inert until 143/001 commits the first pin.

## Acceptance
- [x] Local-server tests (good, wait then fail, malformed). [x] actionlint.

## Slip
The agent ran `git stash`/`pop` in the shared tree for a second; the wave's full suite passed afterwards.
