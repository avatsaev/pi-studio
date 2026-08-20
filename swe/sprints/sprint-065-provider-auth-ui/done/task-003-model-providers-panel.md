# Task 003 — Settings dialog shell + Model Providers category + ConnectionBar gear

- **Sprint:** sprint-065-provider-auth-ui
- **Status:** done
- **Type:** feature
- **Area:** web-client / features/settings, features/provider-auth
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal
Give the browser a settings surface and its first category: a gear icon at the **top-right of the
ConnectionBar** opening a large `SettingsDialog` (category sidebar + content pane), whose only
category today — **Model Providers** — lists providers with accurate auth badges and a
`Log in` / `Re-login` / `Log out` action per row.

## Context / why
There is no way to see provider auth state in the browser today, and — verified while planning —
**web-client has no settings screen and no router at all**: `routes/WorkspacePage.tsx` is a single
shell (ConnectionBar / SessionList / TabPanelHost / RightSidebar / StatusBar), and the only
settings-like state, `theme/appearance-store.ts`, has no panel of its own.
`app-navigation-screens.md`'s `/settings/hosts/[serverId]/providers` route is spec-only.

Rather than a one-off provider modal that would need migrating later, this ships the **settings
dialog shell itself** (user direction, 2026-08-20): a `Dialog`-primitive modal sized large, with a
thin category sidebar and a content pane, categories declared in a small local registry array.
That is barely more work than a bare modal — no router, still one lazy chunk — and it *is* the
settings IA: future categories (Appearance is the obvious next) add a registry entry, not a new
surface, and `app-navigation-screens.md`'s settings route renders these same category panels when
that scope lands. Building any category beyond Model Providers is explicitly not this task's job.

**Entry placement:** ConnectionBar's right edge already ends in the `panelToggles` cluster of
`iconOnly`/ghost `Button`s at `CONTROL_HEIGHT`. The gear (lucide `Settings`) is the rightmost
control, same pattern. **Gating:** while Model Providers is the only registered category, the gear
itself is hidden when `hasProviderAuthCapability()` is false — an empty settings dialog is worse
than no gear, and capability-absent ⇒ surface-absent is the established pattern. Once a
capability-independent category ships, the gear becomes unconditional and only this category hides.

## Scope references
- `swe/features/provider-auth-ui.md` § Web UI surface (settings shell + category rows), § Behavior
  & Algorithms (fetch/refetch rules), § Error Handling & Edge Cases, and the refined TODO on panel
  placement
- `packages/web-client/src/components/primitives/Dialog.tsx` (`Dialog`, `DialogClose`)
- `packages/web-client/src/features/workspace-picker/OpenWorkspaceDialog.tsx` (modal precedent:
  trigger, state ownership, close behavior)
- `packages/web-client/src/features/connection/ConnectionBar.tsx` (gear placement: the
  `panelToggles` cluster, `CONTROL_HEIGHT`/ghost/`iconOnly` conventions)
- `packages/web-client/src/lib/connection/rpc-keys.ts` (query key for the provider list)
- `packages/web-client/src/components/primitives/EmptyState.tsx` (loading/error/empty states)
- `packages/web-client/src/features/workspace/panel-registry.ts`,
  `packages/web-client/src/features/files/viewer-registry.ts` (the
  `lazy(() => import(…).then(m => ({ default: m.X })))` code-split pattern)

## What to build
- `packages/web-client/src/features/settings/SettingsDialog.tsx` (+ CSS module): the shell — a
  large `Dialog`-primitive modal, category sidebar (left) + content pane (right), categories from a
  small local registry array `{ id, label, component, available(caps) }`. One entry today: Model
  Providers. The sidebar renders even with one entry (it is the IA, not decoration).
- `packages/web-client/src/features/provider-auth/ModelProvidersPanel.tsx` (+ CSS module): the
  category content — lists `listProviderAuth()` results: display name, a configured badge
  (`api key` / `oauth` / `env: VAR` / `not configured`), a subscription tag when
  `oauthIsSubscription`, and per-row actions. `configured: "unknown"` renders as its own muted
  badge, never as configured or unconfigured.
- Data: a TanStack Query keyed through `rpc-keys.ts`, fetched on category open; invalidated after a
  successful login (task-004) and after logout. No store, no cache layer — auth state is
  rare-change, low-volume.
- Actions per row: `Log in` (or `Re-login` when configured) choosing the auth type — one method
  available goes straight through, both available offers the choice, using
  `oauthLoginLabel` as the OAuth option's label; `Log out` behind a confirm step carrying a passive
  caution line that running agents keep working until their current credential use fails.
- Logout reports `stillConfigured` when an ambient env-var credential survives removal — surface that
  as a distinct row state, not as a failed logout.
- Entry point: the gear `Button` at the ConnectionBar's top-right (rightmost, after the panel
  toggles, same `iconOnly`/ghost/`CONTROL_HEIGHT` pattern). Hidden when
  `hasProviderAuthCapability()` is false — and in that state **zero** provider-auth RPCs are issued.
- The whole settings chunk (shell + panel) is lazy-mounted via the established registry pattern;
  nothing settings- or provider-auth-related ships in the initial chunk.
- Closing the settings dialog while a login flow is active cancels the flow (same abort path
  task-004 wires for the login dialog's own Cancel/Esc).
- Inline error region on a failed `list`/`logout` (e.g. `provider_auth_unavailable`) — the dialog
  stays open and usable, one provider's failure never blanks the list.
- All server access goes through the task-001 SDK methods. Do not call `client.connection.request`
  for this family.

## Out of scope
- The login dialog itself and any flow-event rendering (tasks 004–005) — this task's `Log in` button
  hands off to a callback the next task wires up.
- The onboarding nudge (task-006).
- Any second settings category (Appearance etc.), settings routes, or navigation changes — the
  shell's registry makes them possible; building them is other scopes' work.

## Acceptance criteria
- [ ] The gear renders at the ConnectionBar's top-right and opens the settings dialog with the
      Model Providers category selected; sidebar shows the category entry.
- [ ] Against a daemon fixture the list renders correct badges in all four states: stored api key,
      stored oauth, env-sourced (`env: ANTHROPIC_API_KEY`), unconfigured — plus the `"unknown"`
      degraded state.
- [ ] Subscription providers show the subscription tag and use `oauthLoginLabel` for the OAuth action.
- [ ] With a capability-less `server_info`, the gear is absent and no provider-auth RPC is sent
      (network/RPC assertion, not just a hidden element).
- [ ] `Log out` confirms first, then refetches; an ambient env credential surfaces as
      `stillConfigured` rather than an error.
- [ ] A `list` failure renders an inline error inside the open dialog instead of an empty list.
- [ ] While a login flow is active, other rows' action buttons are disabled (matches the SDK's
      one-flow-per-client rule so the user cannot trigger a local rejection).
- [ ] Nothing from `features/settings/` or `features/provider-auth/` appears in the initial bundle
      chunk.
- [ ] All CSS values come from design tokens (`--pi-color-*`, `--pi-spacing-*`, `--pi-font-size-*`);
      no raw px/hex literals.

## Test / verification plan
- Manual (real browser, production-bootstrap daemon — the dev daemon deliberately omits this RPC
  family): open the dialog against a `~/.pi` with a stored key, an env-var-only provider, and an
  unconfigured provider; confirm badges, logout + confirm, and the capability-off case (no gear)
  against an older daemon build.
- Bundle: `npm run build:web-client`, then confirm the settings/provider-auth modules land in their
  own chunk.
- Typecheck/lint/format: `npm run typecheck`, `npm run lint`, `npx oxfmt <changed files>`.
- No jsdom/component tests — per project convention components stay thin and are verified in a real
  browser; testable logic belongs in task-002's reducer.

## Notes
`configured` is `boolean | "unknown"` on the wire because the daemon bounds a hanging `checkAuth()`
at 3 s (sprint-054 hit real hangs). Rendering `"unknown"` as "not configured" would invite a user to
re-login over a working credential — keep it visibly distinct.
