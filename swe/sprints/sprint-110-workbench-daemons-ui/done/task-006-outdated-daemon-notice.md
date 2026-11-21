# Task 006 — Workbench: the outdated-daemon notice

- **Sprint:** sprint-110-workbench-daemons-ui
- **Status:** done
- **Type:** feature
- **Area:** packages/workbench (features/connection or features/daemons)
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-003

## Goal
When the host states a minimum daemon version and the connected daemon is older, or does not say, the workbench shows one non-blocking notice per connection naming both versions and how to update.

## Context / why
D5. An older daemon still connects and features stay gated by its feature flags, as today. The notice only explains why something may be missing.

## Scope references
- `swe/features/desktop-daemon-registry.md` § Public contract 4 (row "Outdated notice"), § Error handling ("the app is newer than the daemon"), § TODO(verify) (`minDaemonVersion` value)
- `swe/architecture/workbench-host-adapter.md` § Amendment (row `app.minDaemonVersion`)
- `packages/workbench/src/host/types.ts` (`AppIdentity.minDaemonVersion`: sprint-109/task-001)
- `packages/workbench/src/lib/connection/connection-store.ts` (`serverInfo`), `packages/protocol/src/messages.ts` (`server_info.version`, optional)
- `packages/ui-library` (`useToastStore`), `packages/workbench/src/shell/WorkspaceShell.tsx` (the toast viewport)

## What to build
- A pure function: given the minimum and the daemon's reported version (possibly absent), answer "no notice" or the notice's text. Versions compare as semantic versions, numerically per part; a version that cannot be parsed counts as absent.
- The text names both versions ("This daemon is 0.0.117; this app expects 0.0.119 or newer. Update it with `npm i -g @av-pi-studio/cli`, then restart the daemon."), or says the daemon did not report a version.
- A hook that shows it as a toast once per established connection: again after a reconnect to a daemon that is still old, never twice for the same connection.
- With `app.minDaemonVersion` absent (the web client) nothing runs.

## Out of scope
- Blocking a connection or hiding features by version.
- The value of the minimum: the desktop app sets it (sprint-109/task-002).

## Acceptance criteria
- [ ] Minimum `0.0.119`: daemon `0.0.118` and `0.0.9` give a notice; `0.0.119`, `0.0.120`, `0.1.0` and `1.0.0` give none.
- [ ] An absent or unparsable daemon version gives the "did not report a version" notice.
- [ ] With a fake connection: one connection shows one toast; a reconnect shows one more; a re-render shows none.
- [ ] Without `minDaemonVersion` no toast is ever added.
- [ ] `npm run build:workbench`, `npm run build:web-client` and the workbench's tests pass.

## Test / verification plan
- `npx vitest run packages/workbench/src/features`
- `npm run build:workbench && npm run build:web-client`
- `npx oxfmt <changed files>`; `npm run lint`
- Seen in the desktop webview against an older daemon in task-007.

## Notes
- Depends on task-003 only because both mount something in `shell/WorkspaceShell.tsx`.
- Comparing `0.0.9` with `0.0.119` as text gives the wrong answer; that case is in the tests on purpose.
