# Task 007 — Workbench: `secretStore` in the registry view and the Daemons screen's line

- **Sprint:** sprint-113-desktop-secret-store
- **Status:** done
- **Type:** feature
- **Area:** packages/workbench, desktop/apps/pistudiodesktop/src/host
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal
When the desktop app keeps secrets in a file, the Daemons screen says so in one line.

## Context / why
P4: a person should know that their passwords are not in the keychain. The field is optional in the host contract, so the browser client and a host that does not send it are unchanged.

## Scope references
- `swe/features/desktop-transport-bridge.md` § 5 (the line), § 8 (the one workbench change)
- `swe/architecture/workbench-host-adapter.md` (the `daemons` member: amend it)
- `packages/workbench/src/host/types.ts` (`HostDaemons.snapshot()`)
- `packages/workbench/src/features/daemons/DaemonsScreen.tsx`, `daemons-screen-view.ts`, `daemons-store.ts`
- `desktop/apps/pistudiodesktop/src/host/daemons-view.ts` (the parser of the app's registry view)
- `packages/workbench/README.md`, `packages/workbench/AGENTS.md`

## What to build
- `HostDaemons.snapshot()` gains optional `secretStore?: "keychain" | "file"`.
- The Daemons screen shows one line when it is `file`: secrets are kept in a file only this user can read, because no keychain is available. Nothing when it is `keychain` or absent.
- The desktop host's parser reads the field from the app's view and ignores any other value.
- The host-adapter spec and the workbench's README and AGENTS describe the field.

## Out of scope
- Any Rust change (task-006 sends the field).
- A setting to change the backend.

## Acceptance criteria
- [ ] The screen's view model gives the line for `file` and none for `keychain` or an absent field (unit tests).
- [ ] The desktop parser accepts the three cases and drops an unknown value.
- [ ] The line uses the design system's tokens and rem units; no new token.
- [ ] The root gates pass: `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`; the desktop app's `npm run check`, `npm run lint`, `npm test` pass.

## Test / verification plan
- `npx vitest run packages/workbench/src/features/daemons`
- `npm run build:workbench`
- `(cd desktop/apps/pistudiodesktop && npm run check && npm run lint && npm test)`

## Notes
- This task changes `packages/workbench`, so merging it to `main` publishes an npm release like any workbench change.
- Hoist functions that capture nothing, per the repository's conventions.
