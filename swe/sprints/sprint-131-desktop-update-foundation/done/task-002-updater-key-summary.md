# Task 002 — The updater key: generated, kept in a GitHub environment, public half in the config — Summary

- **Sprint:** sprint-131-desktop-update-foundation
- **Completed:** 2026-11-23
- **Status:** done (orchestrator)

## What was implemented
- Generated with `tauri signer generate --ci` (no password) by the orchestrator, never printed: `~/.config/pi-studio-release/updater.key` (0600, directory 0700) and `.pub`.
- GitHub environment `desktop-release` created with a custom deployment-branch policy `main` only; the secret `TAURI_SIGNING_PRIVATE_KEY` set in it from the file.
- The public key is in `tauri.conf.json` `plugins.updater.pubkey` (replacing the placeholder).
- `desktop/docs/development.md` § Releasing → The updater key.

## Files changed
`desktop/apps/pistudiodesktop/src-tauri/tauri.conf.json`, `desktop/docs/development.md`; outside the repo: the key file; GitHub: the environment and its secret

## Build & test results
```
gh api environments/desktop-release/deployment-branch-policies -> main (branch); gh secret list --env desktop-release -> TAURI_SIGNING_PRIVATE_KEY; stat -> 600; `tauri signer sign` with the key worked with no password and its signature carries the public key's key id; git status shows no key file
```

## Acceptance criteria
- [x] environment with main only and the secret name; file 0600; no key in git; a signature made with the key matches the committed public key's key id.

## Follow-ups
- The engineer must back up `~/.config/pi-studio-release/updater.key`.
- A full verification of a signature against the committed public key waits for the first real signed build (134).
- The `tauri.conf.json` guard test still passes.
