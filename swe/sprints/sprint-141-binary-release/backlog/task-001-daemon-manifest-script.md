# Task 001 — The daemon release files: `SHA256SUMS` and `latest.json`

- **Sprint:** sprints/sprint-141-binary-release
- **Status:** backlog
- **Type:** feature
- **Area:** scripts/release
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** sprint-140/task-001

## Goal
A script turns a folder of the four archives into `SHA256SUMS` and `latest.json` with the contract of
the spec, and refuses an incomplete set.

## Context / why
S1, S2, P13: one failed binary publishes none of them.

## Scope references
- `swe/features/single-binary-daemon.md` § Public contract 1
- Create: `scripts/release/daemon-manifest.mjs`, `scripts/release/daemon-manifest-test.mjs`
- Pattern: `desktop/apps/pistudiodesktop/scripts/release/update-manifest.mjs` (and its test)

## What to build
`node scripts/release/daemon-manifest.mjs --version <v> --dir <dir> --base-url <url>`: requires
exactly the four `pi-studio-<v>-<target>.tar.gz`; writes `SHA256SUMS` (sha256sum format) and
`latest.json` `{version, pub_date, assets: {target: {url, sha256, size}}}`. Exits non-zero naming the
missing target. GitHub's replacement of spaces in asset names does not apply (no spaces), but the URL
is built from the asset name exactly.

## Out of scope
The workflow (task-002).

## Acceptance criteria
- [ ] Tests: a complete set gives the expected files; a missing or extra target fails; a wrong version in a name fails.

## Test / verification plan
- `node --test 'scripts/release/*-test.mjs'`

## Notes
Root `scripts/release/` is new; name the test command in the root `AGENTS.md` at close (sprint-145/task-002).
