# Task 001 — `daemon-manifest.mjs` — Summary

- **Sprint:** sprint-141-binary-release
- **Completed:** 2026-11-24
- **Status:** done

## What was built
`scripts/release/daemon-manifest.mjs --version --dir --base-url [--pub-date]` + `daemon-manifest-test.mjs`: requires exactly the four `pi-studio-<v>-<target>.tar.gz` (targets from `TARGETS` in `scripts/build-binary.mjs`); fails naming missing targets, on an extra archive or a wrong version in a name, writing nothing; writes `SHA256SUMS` (checked with `sha256sum -c` in a test) and `latest.json` `{version, pub_date, assets:{target:{url,sha256,size}}}`.

## Results
Root `scripts/release` tests pass; 19 node tests across `scripts/release` and `scripts/*.test.mjs` pass.

## Acceptance
- [x] Complete set; missing; extra; wrong version.

## Follow-ups
Name the root test command in root `AGENTS.md` at sprint-145/task-002; the desktop release's `version` job runs only the desktop release-script tests.
