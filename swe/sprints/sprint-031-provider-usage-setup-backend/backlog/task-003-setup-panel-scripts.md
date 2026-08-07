# Task 003 — Setup panel & workspace scripts surface

- **Sprint:** sprint-031-provider-usage-setup-backend
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** sprint 009 (service proxy), sprint 003 (per-project config), sprint 016 (panels)

## Goal
Surface workspace setup/bootstrap scripts (and their count / availability) so the workspace header
fields `scriptsCount` and `setupAvailable` — hardcoded to `0`/`false` in `LiveWorkspacePage.tsx` —
become live, and add the setup panel present in the reference app.

## Scope references
- `swe/features/service-proxy.md` (workspace scripts)
- `swe/features/feature-panels-ui.md`
- `swe/architecture/config.md` (per-project `pi-studio.json` scripts)
- Reference (Paseo): `packages/app/src/panels/setup-panel.tsx`

## What to build
- **Data**: expose per-project setup/scripts config (from `pi-studio.json` / service-proxy) over an
  RPC or existing project projection so the client can read scripts + setup availability.
- **Setup panel**: a workspace panel listing available scripts, run buttons (wired to terminal /
  proxy), and setup status; register as a pane kind in the panel registry.
- Provide the derived `scriptsCount` / `setupAvailable` values consumed by sprint 030 task-005.

## Acceptance criteria
- [ ] Client can read a workspace's scripts + setup availability from live daemon data.
- [ ] Setup panel lists scripts and can launch them.
- [ ] `scriptsCount` / `setupAvailable` are available for the workspace header (feeds s030/t005).

## Test / verification plan
- Unit: scripts projection parsing from project config.
- Component: mock scripts → verify panel renders + run action calls terminal/proxy.
- `npx vitest run`; `npm run build` + `npm run build:web` succeed.
