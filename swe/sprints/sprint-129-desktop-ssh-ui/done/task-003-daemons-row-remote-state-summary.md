# Task 003 — Daemons row and switcher: the SSH entry's state, Start, not installed, and opening by itself — Summary

- **Sprint:** sprint-129-desktop-ssh-ui
- **Completed:** 2026-11-22
- **Status:** done (orchestrator)

## What was implemented
- `remoteStateView` beside `localStateView`: `stopped` offers Start; `failed` Start and Retry; `not_installed`, `cli_outdated` and `unknown` Retry (`remote.refresh`); `checking`/`starting`/`running` nothing. An SSH row's address is `user@host:port`.
- `not_installed`: "pi-studio is not installed on this host", the command `npm install -g @av-pi-studio/cli` and a Copy button through `getHost().clipboard` (a refused copy shows the "unexpected" banner); `cli_outdated` shows the installed version and names the minimum (`MIN_REMOTE_CLI_VERSION` = 0.0.127, hard-coded from the spec: can drift from the Rust constant).
- `daemon-lifecycle.ts` opens the screen when the current SSH entry's state becomes `stopped`, `not_installed`, `cli_outdated` or `failed` (also on mount); the switcher shows the remote state for the current SSH entry unless `running`/`unknown`; its Retry reuses `connectCurrent`.

## Files changed
`packages/workbench/src/features/daemons/{daemon-presentation.ts,daemons-screen-view.ts,daemons-screen-actions.ts,daemon-lifecycle.ts,DaemonsScreen.tsx,DaemonsScreen.module.css}` + tests, `packages/workbench/src/features/connection/daemon-switcher-presentation.ts` + test

## Build & test results
```
npx vitest run daemons + connection -> 11 files, 242 passed; tsc --noEmit clean; oxlint and oxfmt clean on changed files; npm run build:workbench built
```

## Acceptance criteria
- [x] Pure tests for each state's view and action, `runRemoteAction`, `copyCommand`, the auto-open rule and the switcher.

## Follow-ups
- The doc comment on `address` in `daemons-screen-view.ts` still says "a direct entry's address" (fix in 130/t002 sweep).
- `MIN_REMOTE_CLI_VERSION` duplicates the Rust constant.
