# Task 002 — New-agent provider/profile picker (replace hardcoded mock)

- **Sprint:** sprint-030-integration-gap-closure
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-001; sprint 005 (provider registry), sprint 013/019 (new-workspace screen)

## Goal
`packages/app/src/router/NewAgentPage.tsx` currently hardcodes `config: { provider: "mock", ... }`.
Wire real provider + profile selection from the daemon's provider registry/snapshot so users can
create agents against `pi` (and any `extends: "pi"` custom profiles), mirroring the reference app's
new-workspace provider chooser.

## Scope references
- `clean-room-scope/features/agent-providers.md` § registry / snapshot / profiles
- `clean-room-scope/features/app-navigation-screens.md` § new workspace
- `clean-room-scope/features/composer-ui.md` § create-agent preferences
- Reference (Paseo): `packages/app/src/screens/new-workspace-screen.tsx`, `docs/custom-providers.md`

## What to build
- A `useProviders()` hook (React Query) reading the daemon provider snapshot/registry RPC.
- Provider + profile select control in the new-agent / new-workspace flow (reuse `Select` primitive).
- Persist last-used provider/profile as a create-agent preference (existing composer prefs store).
- Pass the chosen `provider`/`profile` (and model where applicable) into the create-agent config
  instead of the hardcoded `"mock"`. Keep `mock` selectable for smoke testing.
- Sensible default when only one provider is configured.

## Acceptance criteria
- [ ] Creating an agent uses the selected provider/profile, not a hardcoded value.
- [ ] Provider list is populated from live daemon data; `mock` still available.
- [ ] Last-used provider/profile is remembered across sessions.
- [ ] `pi` and a custom `extends: "pi"` profile both selectable when configured.

## Test / verification plan
- Unit: preference persistence; default-provider selection logic.
- Component: mock provider snapshot → verify options; select → verify create config payload.
- `npx vitest run`; `npm run build:web` succeeds.
