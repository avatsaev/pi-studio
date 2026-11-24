# Task 006 — The first binary release — Summary

- **Sprint:** sprint-142-binary-self-update
- **Completed:** 2026-11-24
- **Status:** done

## What happened
The owner told me to merge PR #68 (squash, `c86ba92`). The `Release` run (45408961901, ~11 min) succeeded: `release`, the four `binaries / build` jobs and `binaries / publish`. npm and Docker published as for any merge (0.0.131, `104705c`).

## Checked (2026-11-24)
- `daemon-v0.0.131`: exists, not draft, **not latest** (`desktop-v0.3.2` is the latest release); assets: `pi-studio-0.0.131-{darwin-arm64,darwin-x64,linux-arm64,linux-x64}.tar.gz` (57.1, 60.2, 67.8, 68.0 MB) and `SHA256SUMS`.
- `daemon-updates` exists (not latest, not draft); `latest.json` names `0.0.131`, `pub_date` 2026-11-24T14:09:42Z, all four targets.
- `linux-x64` archive downloaded: `sha256sum -c SHA256SUMS` OK and equal to the `latest.json` checksum (`b8823aaa…`).
- The downloaded binary passed the full smoke test (`--expect-version 0.0.131`): version, daemon start, health, mock turn, terminal, 1 MiB transfer, `__pi --version`, stop.
- macOS: the release's own smoke test ran on a macos-15 and a macos-15-intel runner (D16).

## Acceptance
- [x] Each item recorded; no failure to fix.

## Follow-ups
Sprint 143 pins 0.0.131 (143/001). The PR's own Desktop CI/release runs were cancelled by the owner's request after the merge (redundant with the runs on `main`).
