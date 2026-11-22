# Task 003 — Daemons row and switcher: the SSH entry's state, Start, not installed, and opening by itself

- **Sprint:** sprint-129-desktop-ssh-ui
- **Status:** backlog
- **Type:** feature
- **Area:** packages/workbench/src/features/daemons (presentation, screen view, switcher)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal
An SSH entry's row shows its state with Start, Retry, and for a missing or old CLI the install command with Copy; the screen opens by itself as S8 says.

## Context / why
D22, S8, § 10.

## Scope references
- `swe/features/desktop-relay-ssh.md` § 10 (row, screen), D22, S8
- `daemon-presentation.ts`, `daemons-screen-view.ts`, `daemons-screen-actions.ts`, `daemon-switcher-presentation.ts`, `use-daemon-lifecycle.ts`

## What to build
- A `remoteStateView` beside `localStateView`; Start for `stopped`/`failed`; `not_installed`: the text, `npm install -g @av-pi-studio/cli` and Copy (through the host's clipboard or `navigator.clipboard`); `cli_outdated` with both versions; Retry → `remote.refresh`.
- The screen opens by itself when the current SSH entry's state becomes `stopped`, `not_installed`, `cli_outdated` or `failed`.
- `KIND_LABELS` and the switcher know `ssh`.

## Out of scope


## Acceptance criteria
- [ ] Pure tests for each state's view and action, and the auto-open rule.

## Test / verification plan
- `npx vitest run packages/workbench/src/features/daemons`

## Notes

