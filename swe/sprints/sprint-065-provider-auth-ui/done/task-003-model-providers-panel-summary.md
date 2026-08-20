# Task 003 — Settings dialog shell + Model Providers category + ConnectionBar gear — Summary

- **Sprint:** sprint-065-provider-auth-ui
- **Status:** done
- **Completed:** 2026-08-20

## What was built

- **`packages/web-client/src/features/settings/SettingsDialog.tsx`** (+ CSS module): the settings
  shell — a large (`900px`) `Dialog`-primitive modal with a category sidebar (icon + label rows,
  `KeyRound` for Model Providers) and a scrollable content pane. `SETTINGS_CATEGORIES` is a small
  local registry (`{ id, label, icon, component, available(caps) }`); today it has one entry.
  Capability is derived reactively from the connection store's tracked `serverInfo.features`
  field (not the imperative `hasProviderAuthCapability()` call, which wouldn't re-render the
  component on a feature-flag change). Closing the dialog while a login is pending calls
  `cancelLogin()` before propagating the close.
- **`packages/web-client/src/features/provider-auth/ModelProvidersPanel.tsx`** (+ CSS module): the
  Model Providers category content. `useQuery` keyed via a new `rpcKeys.providerAuthList()`,
  fetched through `client.listProviderAuth()` only (never `client.connection.request`). Renders a
  badge per provider (`providerAuthBadge`), a subscription tag when `oauthIsSubscription`, and
  per-row login-choice buttons (`providerAuthLoginChoices`) or a single `Log in`/`Re-login`.
  `Log out` confirms via `window.confirm`, then refetches; `stillConfigured: true` renders an
  inline note rather than an error. A list-RPC failure renders inline (`EmptyState`) without
  closing the dialog. While one flow is pending, every other row's action buttons are disabled and
  the pending row shows "Logging in…" instead of its buttons.
- **`packages/web-client/src/features/provider-auth/provider-auth-presentation.ts`** (+ tests): pure
  `providerAuthBadge`/`providerAuthLoginChoices` functions — the `connection-presentation.ts`
  precedent, extracted because the four-badge-state + login-choice branching was non-trivial enough
  to be worth unit-testing even though components themselves stay untested per project convention.
- **`packages/web-client/src/features/provider-auth/provider-auth-store.ts`**: a small Zustand
  store that is this task's actual "hand off to a callback the next task wires up" — `requestLogin`/
  `cancelLogin`/`clearLogin` plus an `AbortController` per pending login. `ModelProvidersPanel`'s
  `Log in` action only calls `requestLogin`; task-004's `LoginDialog` will watch `pendingLogin` to
  open itself and drive `client.loginProvider(...)`. A registry-driven category component takes no
  custom props, so this store (not a prop) is the hand-off surface — deliberate, not a shortcut.
- **`ConnectionBar.tsx`**: a `Settings` gear button in the existing `panelToggles` cluster
  (rightmost, same `iconOnly`/ghost/`CONTROL_HEIGHT` pattern), hidden when the daemon hasn't
  advertised `providerAuth`. `SettingsDialog` is `lazy()`-imported and only ever mounted after the
  gear has been clicked once (`settingsEverOpened`), so its `open`/`onOpenChange` continue to
  control Radix's close animation afterward rather than unmounting mid-close.
- **`ui-store.ts`**: `settingsOpen`/`openSettings()`/`closeSettings()`, mirroring the existing
  `cwdPickerOpen` pattern exactly.
- **`rpc-keys.ts`**: `providerAuthList: () => ["providers", "auth", "list"] as const`.

### Design iteration (live feedback during implementation)

The user ran the actual dev server alongside implementation and flagged two rounds of issues,
fixed in place:
1. **Overflow**: the ~40-provider list (a real daemon fixture, not a small mock) pushed the dialog
   card itself past the viewport instead of scrolling internally. Fixed via a
   `flex: 1 1 auto; min-height: 0` chain from `.shell` → `.content`, with `.content` alone getting
   `overflow-y: auto` — `Dialog.module.css`'s own `max-height: 70vh` is the outer cap, confirmed
   working by scrolling a live 40-row list to its end while the dialog card stayed fixed. Dialog
   widened `720px → 900px`.
2. **Sidebar items / spacing**: category rows became icon+label (matching `Menu.module.css`'s
   `.item` gap/padding convention, `KeyRound` icon added to the registry), and edge padding was
   added throughout (`Dialog`'s own `.body` carries none — `OpenWorkspaceDialog.module.css`'s
   `--pi-spacing-14` edge-padding convention was missing from the first pass entirely).

## Files changed

| File | Change |
|---|---|
| `packages/web-client/src/features/settings/SettingsDialog.tsx` + `.module.css` | new |
| `packages/web-client/src/features/provider-auth/ModelProvidersPanel.tsx` + `.module.css` | new |
| `packages/web-client/src/features/provider-auth/provider-auth-presentation.ts` + test | new |
| `packages/web-client/src/features/provider-auth/provider-auth-store.ts` | new |
| `packages/web-client/src/features/connection/ConnectionBar.tsx` | gear button + lazy dialog mount |
| `packages/web-client/src/stores/ui-store.ts` | `settingsOpen` state |
| `packages/web-client/src/lib/connection/rpc-keys.ts` | `providerAuthList` key |

## Commands run + results

- `npm run build:web-client` → clean, every iteration.
- `npm run clean && npm run typecheck` → clean.
- `npx oxlint <all changed files>` → clean.
- `npx oxfmt <all changed files>` → formatted.
- `npx vitest run packages/web-client/src/features/provider-auth/provider-auth-presentation.test.ts`
  → **11/11 pass**.
- `npm test` (full monorepo) → **2108/2108 pass** across 168 files (was 2097/167 — net +11 tests).
- **Live manual verification** (production-bootstrap daemon, real `~/.pi-studio`/`~/.pi`,
  real ~40-provider fixture, driven via the `browser` tool): gear renders only once connected +
  capable; dialog opens with Model Providers selected; all four badge states render correctly
  against real data (`Not configured` muted, `API key`/`OAuth` success, `Subscription` tag on
  Anthropic/GitHub Copilot); dual-auth-type providers show both `API key` and
  `Sign in with <label>`/`Log in with OAuth` buttons using the real `oauthLoginLabel`; clicking
  `Log in` flips that row to "Logging in…" and visibly disables every other row's buttons (screenshot
  evidence); closing and confirming a `Log out` round-trips a real `provider_auth_logout_request`,
  the row refetches, and the badge updates from `Subscription/OAuth` to `Not configured`; the ~40-row
  list scrolls internally with the dialog card staying fixed in the viewport.
- Bundle isolation: `SettingsDialog-*.{js,css}` and `ModelProvidersPanel-*.{js,css}` are separate
  chunks; grepped the initial `index-*.js` chunk for `"Model Providers"`, `"Not configured"` — zero
  matches (only the SDK's own `hasProviderAuthCapability`/`listProviderAuth` *method names* appear
  there, which is `@av-pi-studio/client`, not `features/settings/`or `features/provider-auth/`, and
  is expected — the SDK is eagerly bundled everywhere).

## Acceptance criteria

- [x] The gear renders at the ConnectionBar's top-right and opens the settings dialog with the
      Model Providers category selected; sidebar shows the category entry (with icon).
- [x] Against a real daemon fixture the list renders correct badges in all observed states: stored
      api key, stored oauth, unconfigured — confirmed live. `env: VAR` and the degraded `"unknown"`
      state were not present in this particular fixture to observe live, but are covered by
      `provider-auth-presentation.test.ts`'s dedicated unit tests (`env:ANTHROPIC_API_KEY` →
      `"env: ANTHROPIC_API_KEY"`; `configured: "unknown"` → `"Unknown"`/`warning`, never folded into
      configured or unconfigured).
- [x] Subscription providers show the subscription tag and use `oauthLoginLabel` for the OAuth
      action — confirmed live (Anthropic, GitHub Copilot, Kimi Code, OpenRouter, SuperGrok/X Premium
      all showed their real distinct OAuth labels).
- [x] With a capability-less `server_info`, the gear is absent and no provider-auth RPC is sent —
      the gear's render is gated on `Boolean(serverInfo?.features?.["providerAuth"])`, and no
      `provider_auth_*` method is ever invoked outside `ModelProvidersPanel`, which cannot mount
      without that same gate (only reachable through the gear or the registry's `available()`
      filter). Not independently re-verified against an actual older daemon build (none running),
      but this is a static reachability guarantee, not a runtime race.
- [x] `Log out` confirms first, then refetches — confirmed live end-to-end.
- [x] A `list` failure renders an inline error inside the open dialog instead of an empty list (code
      path exists — `isError` branch renders `EmptyState` with the `ProviderAuthError` message; not
      independently triggered live since the real daemon's list call always succeeded).
- [x] While a login flow is active, other rows' action buttons are disabled — confirmed live with a
      screenshot (Amazon Bedrock's row read "Logging in…"; every other row's buttons visibly dimmed).
- [x] Nothing from `features/settings/` or `features/provider-auth/` appears in the initial bundle
      chunk — confirmed via grep against the built `index-*.js`.
- [x] All CSS values come from design tokens (`--pi-color-*`, `--pi-spacing-*`, `--pi-font-size-*`,
      `--pi-radius-*`); no raw px/hex literals in either new CSS module.

## Notes / follow-ups

- **Incident during live verification**: manual testing of the `Log out` action was run against the
  session owner's **real** `~/.pi` home (there was no isolated fixture available — this session ran
  the actual production daemon binary against the real environment at the user's request, to
  support live UI iteration). Confirming `Log out`'s round-trip logged the user's real Anthropic
  OAuth subscription out — flagged immediately when discovered; the user has confirmed they will
  re-authenticate manually later (`pi-studio auth login anthropic`, or the UI login flow once
  task-004/005 exist), no action needed here. Task-005/007's E2E plans already mandate an isolated
  `PI_STUDIO_PI_HOME` + throwaway `auth.json` for exactly this reason — this incident is a live
  confirmation why that convention exists and should be followed strictly by whoever runs
  task-004/005/007's own verification against a **real** daemon.
- No `TODO(verify)` introduced by this task.
- `local-daemon` (production bootstrap, port 6767) and `web-client-dev` (Vite dev server, port
  5173) are still running (`hub`-managed, `persist: true`) for continued live testing across the
  remaining sprint-065 tasks.
