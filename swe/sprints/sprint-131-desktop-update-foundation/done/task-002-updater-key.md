# Task 002 — The updater key: generated, kept in a GitHub environment, public half in the config

- **Sprint:** sprints/sprint-131-desktop-update-foundation
- **Status:** done
- **Type:** chore
- **Area:** GitHub repository settings, tauri.conf.json, desktop/docs/development.md
- **Priority:** P1
- **Estimated size:** XS
- **Depends on:** task-001

## Goal
The real key pair exists: the private half in the environment `desktop-release` (deployments from
`main` only) and in one 0600 file on the engineer's machine; the public half in `tauri.conf.json`.

## Context / why
D9, U1, spec § Data & persistence touchpoints.

## Scope references
- `swe/features/desktop-self-update.md` D9, U1, § Data & persistence touchpoints
- `desktop/apps/pistudiodesktop/src-tauri/tauri.conf.json` (`plugins.updater.pubkey`)

## What to build
- `npx tauri signer generate --ci -w ~/.config/pi-studio-release/updater.key` (no password), mode 0600,
  directory 0700. Never print the private key; never write it inside the repository.
- `gh api` / `gh secret set --env desktop-release TAURI_SIGNING_PRIVATE_KEY < file`, after creating the
  environment with a deployment-branch policy allowing `main` only (custom branch policy).
- The public key into `tauri.conf.json`.
- A short "Updater key" paragraph in `desktop/docs/development.md` § Releasing: where the two copies
  are; the full runbook is sprint-134/task-003.

## Out of scope
Using the key in a workflow (sprint 134).

## Acceptance criteria
- [ ] `gh api repos/:owner/:repo/environments/desktop-release` shows a branch policy of `main` only and
  the secret name (not its value).
- [ ] The local file exists with mode 0600; `git status` shows no key file.
- [ ] A test build signed with a throwaway key is NOT accepted by an app built with the real public key
  (or: `tauri signer sign` with the real key and verification with the committed public key succeed) —
  one quick check, recorded in the summary.

## Test / verification plan
- `stat -c %a ~/.config/pi-studio-release/updater.key` → 600
- `cd desktop && cargo xtask ci`

## Notes
The engineer backs up the local file. Losing it means both users reinstall by hand (spec, edge cases).
