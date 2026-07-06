# Task 002 — Wire provider-usage UI to live data

- **Sprint:** sprint-031-provider-usage-setup-backend
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-001; sprint 025 (composer-full), sprint 019 (settings screen)

## Goal
Point the existing `use-usage.ts` hook and provider-usage UI (settings section + composer-footer
widget) at the real `provider_usage_list` RPC from task-001, replacing the mock/stub response.

## Scope references
- `clean-room-scope/features/provider-usage.md`
- `clean-room-scope/features/composer-ui.md` § footer usage widget
- `clean-room-scope/features/app-navigation-screens.md` § settings / provider usage
- Reference (Paseo): `provider-usage/settings-section.tsx`, `balance-bar.tsx`, `window-bar.tsx`, `tooltip-section.tsx`

## What to build
- Update `use-usage.ts` (React Query) to call the new RPC; keep the mock fallback for daemons
  without the capability flag.
- Provider Usage settings section: balance bar + usage windows + per-provider list/cards.
- Composer-footer usage widget showing current-provider balance/window with tooltip detail.
- Loading/empty/error states via shared primitives; poll/refresh on an interval.

## Acceptance criteria
- [ ] Settings → Provider Usage shows live balances/windows from the daemon.
- [ ] Composer footer shows the active provider's usage; hides gracefully when unsupported.
- [ ] Data refreshes and reflects capability-flag absence without errors.

## Test / verification plan
- Unit: hook maps RPC response → view model; capability-absent fallback.
- Component: mock RPC → verify balance/window rendering; tooltip content.
- `npx vitest run`; `npm run build:web` succeeds.
