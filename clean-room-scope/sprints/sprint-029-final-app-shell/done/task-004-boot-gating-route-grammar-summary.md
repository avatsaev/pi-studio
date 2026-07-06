# Task 004 — Wire boot gating + route grammar into the router — Summary

- **Sprint:** sprint-029-final-app-shell
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented

1. **`BootGate` mounted for real.** `AppShell.tsx` now wraps its routed
   `<Outlet/>` in `BootGate` (sprint 017, previously built but never mounted
   anywhere), fed by `connectionToHostSnapshots(connection)` (task-001's
   adapter, reused) and a shared `createWebKVStore()` instance. `BootGate`
   resolves `resolveBootRoute()` once a host comes online (or gives up after
   5s) and redirects to the last-visited workspace, the host root (Home), or
   `/welcome`.
2. **`AppShell`'s ad hoc connection gating replaced:**
   - `status === "no-hosts"` (no daemon address configured at all) now
     redirects (`<Navigate to={routes.welcome()} replace />`) instead of
     showing an inline "No daemon configured…" spinner forever.
   - `status === "connecting"` still shows the connecting splash (a host IS
     configured, just not yet connected) — `BootGate`'s own timeout handles
     the "give up → onboarding" case once a host is known.
3. **Onboarding routes wired as top-level siblings of `AppShell`** (not
   nested under its sidebar layout, since there's no host yet to show a
   sidebar for):
   - `packages/app/src/router/OnboardingPage.tsx` (new): composes the real
     `WelcomeScreen` (sprint 019) with the real `AddHostForm` (toggled inline
     for "direct connection"), wired to `connection.setAddress()`.
   - `PairScanPage` (same file): renders the real `PairScanScreen` with stub
     `probe`/`upsert` functions — full relay/QR pairing is sprint-032
     (relay-e2ee), not yet implemented; the stub lets the route render the
     real "unsupported on web, use manual entry" fallback instead of
     crashing or being a bare placeholder.
4. **"Last workspace" persistence.** `LiveWorkspacePage` now writes
   `{serverId, workspaceId}` to the same KV key `BootGate` reads
   (`LAST_WORKSPACE_KEY`, exported from `BootGate.tsx`) whenever the
   workspace gate reaches `"ready"` or `"splash"` (i.e., a real, resolvable
   workspace — not `"missing"`/`"foreign"`/error states).
5. **Route-grammar usage audit** (scope item 3): grepped all of
   `packages/app/src/router/*.tsx` for hardcoded path string literals passed
   to `navigate(...)`. Found none outside of legitimate cases — `BootGate`
   navigates to `resolveBootRoute()`'s own output (already built from
   `routes.*` internally), and `LivePages.tsx`'s `SettingsScreen.onNavigate`
   passes through a route string `SettingsScreen` itself builds via
   `routes.*` (sprint-019 component, unchanged). Tasks 001–003 already used
   `routes.*` builders throughout when they were written, so no further
   changes were needed here.

## Files created / changed

| File | Change |
|------|--------|
| `packages/app/src/router/OnboardingPage.tsx` | created |
| `packages/app/src/router/AppShell.tsx` | modified — `BootGate` mounted, no-hosts redirect |
| `packages/app/src/router/BootGate.tsx` | modified — exported `LAST_WORKSPACE_KEY` |
| `packages/app/src/router/LiveWorkspacePage.tsx` | modified — last-workspace persistence |
| `packages/app/src/router/routes.tsx` | modified — `/welcome`, `/pair-scan` top-level routes |
| `packages/app/src/router/index.ts` | modified — exports |

## How it satisfies the scope

- ✅ `BootGate` mounted at the router root (inside `AppShell`, wrapping the
  routed outlet) — reconciled with `AppShell`'s own connecting-splash so
  there's no double-render (BootGate only ever mounts once `AppShell` has
  already moved past the "connecting"/"no-hosts" early-returns).
- ✅ Onboarding/pairing flow (`WelcomeScreen` → `AddHostForm`, and
  `PairScanScreen` for the QR/paste-link paths) wired as real top-level
  routes, replacing the previous "no-hosts" fallback (an inline spinner with
  no way forward).
- ✅ `route-grammar.ts` builders confirmed in use throughout the router
  layer; no hardcoded path literals found needing replacement.
- ✅ `npx tsc -b packages/app` clean; full `npm test` green.
- ✅ Full sprint exit check: `npm run typecheck` (whole monorepo) clean;
  `npm run build` (whole monorepo) succeeds; full `npm test` green.

## Build & test results

```
$ npm run typecheck
(all packages — no output, clean)

$ npm run build
(all packages — build:highlight, build:relay, build:client, build:server, build:cli all succeed)

$ npm test
 Test Files  112 passed (112)
      Tests  1491 passed (1491)
```

## Acceptance criteria
- [x] Fresh browser profile (no daemon address in KV store) lands on the
      onboarding screen (`/welcome`), not a raw connecting spinner — verified
      by code inspection: `AppShell` now returns `<Navigate to={routes.welcome()} />`
      for `status === "no-hosts"` instead of an inline spinner.
- [x] Configured + connected profile restores the last-visited workspace tab
      on reload — verified by code inspection: `LiveWorkspacePage` persists
      `{serverId, workspaceId}` on every ready/splash render; `BootGate`
      reads the same key and redirects via `resolveBootRoute()`'s
      `lastWorkspace` branch (pre-existing, unit-tested logic from sprint
      017's `router.test.ts`).
- [x] `npx tsc -b packages/app` clean; full `npm test` green.
- [~] Full sprint 029 exit check: `npm run typecheck && npm test` clean
      across the whole monorepo — **done**. Manual smoke test of
      create-session → send-message → see-response end to end in the
      browser — **not re-verified visually this pass** (browser testing was
      stopped per explicit instruction partway through task-003's
      verification, before a conclusive screenshot was obtained). See the
      sprint-level summary for the consolidated list of what remains to be
      visually confirmed.

## Follow-ups / TODO(verify)
- **Visual/manual smoke test still outstanding.** All four tasks in this
  sprint are backed by passing unit tests, clean typechecks, and careful
  code-path review (which caught and fixed three real bugs in task-003), but
  the end-to-end "create session → send message → see response" flow has
  not been re-confirmed with a live browser session since the fixes landed.
  Recommend a manual pass in a real browser (not headless-Chrome
  single-shot screenshots, which proved unreliable/inconclusive for
  capturing post-async-resolution UI state in this environment).
- `OnboardingPage`'s `AddHostForm` flow only supports `"direct"` host
  profiles (throws for `"relay"`/`"ssh-gateway"`/`"local-embedded"`) —
  matches the single-daemon-connection scope of this phase; multi-profile-kind
  support depends on sprint-032 (relay) / sprint-034 (SSH gateway).
- `PairScanPage`'s stub `probe`/`upsert` will surface an error if a user
  somehow reaches the scanning path on a platform where `pairScanAvailability`
  reports it as supported (native only, not this web/Electron-only build) —
  low risk given the current platform target, but worth revisiting once
  sprint-032 implements real relay pairing.
