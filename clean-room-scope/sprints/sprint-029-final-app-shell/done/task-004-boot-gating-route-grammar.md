# Task 004 — Wire boot gating + route grammar into the router

## Why this task exists

Sprint 017 built `resolveBootRoute`/`StoreReadyLatch` (`runtime/boot-resolver.ts`)
and `route-grammar.ts` (`runtime/route-grammar.ts`), and a `BootGate` component
(`router/BootGate.tsx`) that consumes them — but nothing in `routes.tsx` or
`AppShell.tsx` actually renders `BootGate` today. Instead, `AppShell` does an
ad hoc `status === "connecting"` check with no onboarding/pairing redirect logic,
no "last workspace" restore, and no give-up-after-timeout handling.

## Reference

- `clean-room-scope/architecture/client-app-runtime.md` § Boot sequence
- `packages/app/src/runtime/boot-resolver.ts`, `route-grammar.ts`
- `packages/app/src/router/BootGate.tsx`
- Onboarding/pairing screens from sprint 019 (`WelcomeScreen`, `PairScanScreen`,
  `AddHostForm`) — currently also unused by the live router.

## Scope

1. Mount `BootGate` at the router root (wrapping `AppShell`'s children, or
   wrapping the whole router tree — pick whichever keeps `AppShell`'s own
   "connecting" splash from double-rendering; reconcile the two).
2. Wire the onboarding/pairing flow (`WelcomeScreen` → `PairScanScreen` →
   `AddHostForm`) as real routes for the "no daemon address configured" case,
   replacing whatever fallback currently exists (check `ConnectionProvider`'s
   `no-hosts` status handling).
3. Confirm `route-grammar.ts`'s route builders (`routes.*`) are used by
   `LeftSidebar`/navigation instead of raw string literals scattered across
   `AppShell.tsx`/`routes.tsx` (grep for hardcoded `"/workspace"` etc. and
   replace with `routes.workspace(...)` where such helpers exist).

## Out of scope

- None — this is the last task in the sprint. After this task, the app boot
  sequence should match `clean-room-scope/architecture/client-app-runtime.md`
  end to end: no configured host → welcome/pairing; configured but
  disconnected → connecting/reconnecting UI; connected → restore last
  workspace or land on Home.

## Acceptance

- Fresh browser profile (no daemon address in KV store) lands on the onboarding
  screen, not a raw connecting spinner.
- Configured + connected profile restores the last-visited workspace tab on
  reload.
- `npx tsc -b packages/app` clean; full `npm test` green.
- Full sprint 029 exit check: `npm run typecheck && npm test` clean across the
  whole monorepo; manual smoke test of create-session → send-message →
  see-response end to end in the browser (the flow the user was originally
  testing).
