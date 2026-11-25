# Task 004 — Remove `pi-studio ui`

- **Sprint:** sprints/sprint-146-close-the-door
- **Status:** done
- **Type:** chore
- **Area:** packages/cli
- **Priority:** P2
- **Estimated size:** XS
- **Depends on:** none

## Goal
The CLI no longer serves the web app locally.

## Context / why
`pi-studio ui` serves the SPA next to a local daemon and connects it directly, which Lite no longer
does (owner decision 2026-11-24). Removing the CLI's dependency on `web-client` and the web app in the
single binary follows in sprint-148/task-003.

## Scope references
- `docs/daemon-audit-handoff.md` § Decisions → Web client as "Lite", § 11.1, § Milestones (M1)
- `packages/cli/src/ui-commands.ts`, `packages/cli/src/web-server.ts` and their tests
- `packages/cli/src/program.ts` (`registerUiCommands`)

## What to build
Delete the command, its server and their tests; remove the registration. Update `packages/cli/README.md`,
`packages/cli/AGENTS.md`, the root `README.md`/`AGENTS.md` mentions and the fern CLI page.

## Out of scope
The `web-client` dependency in `packages/cli/package.json` and `scripts/build-binary.mjs`'s web copy
(sprint-148/task-003).

## Acceptance criteria
- [ ] `pi-studio ui` is an unknown command; no file under `packages/cli/src` references `web-server`.

## Test / verification plan
- `npx vitest run packages/cli/src`
- `npm run build:cli`
