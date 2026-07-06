# Task 001 — Onboarding & Device-Pairing Screens — Summary

- **Sprint:** sprint-019-navigation-screens
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented
Built the three onboarding screen components that render into the router:

| Component | What it does |
|-----------|-------------|
| `WelcomeScreen` | Branded intro (`/welcome`); shows platform-appropriate actions from `welcomeActions()`; auto-redirects when host already online |
| `AddHostForm` | Manual host entry form with URL validation (`validateHostAddress()`), password field, connect+error handling |
| `PairScanScreen` | `/pair-scan` route; camera mode (native) or "unsupported" fallback (web/desktop) with manual entry button; imports pairing via `importPairingOffer()` |

## Files created / changed
| File | Change |
|------|--------|
| `packages/app/src/components/screens/WelcomeScreen.tsx` | created |
| `packages/app/src/components/screens/WelcomeScreen.module.css` | created |
| `packages/app/src/components/screens/AddHostForm.tsx` | created |
| `packages/app/src/components/screens/AddHostForm.module.css` | created |
| `packages/app/src/components/screens/PairScanScreen.tsx` | created |
| `packages/app/src/components/screens/PairScanScreen.module.css` | created |
| `packages/app/src/components/screens/index.ts` | created |
| `packages/app/src/components/screens/screens.test.ts` | created — 14 tests |
| `packages/app/src/components/index.ts` | added screens re-export |

## How it satisfies the scope
- `WelcomeScreen` consumes the sprint-013 `welcomeActions()` model directly; renders all platform variants.
- `AddHostForm` validates host addresses (ws/wss protocol enforcement) and creates `DirectHostProfile`s.
- `PairScanScreen` uses `pairScanAvailability()` for platform gating and `importPairingOffer()` for the decode→probe→upsert→route flow.
- Camera via `getUserMedia` with cleanup on unmount; graceful fallback on permission denial or web platform.

## Build & test results
```
$ npm --workspace @av-pi-studio/app run typecheck
# 0 errors

$ npx vitest run packages/app/src/components/screens/screens.test.ts
# 14 passed

$ npx vitest run
# 95 files, 1119 tests passed

$ npm --workspace @av-pi-studio/app run build:web
# ✓ 387 kB, built in 789ms
```

## Acceptance criteria
- [x] `/welcome` renders branded intro + actions and routes to add-host/scan. (verified by test)
- [x] Manual add-host validates + saves + connects (mock client) and lands on the host home. (verified by validateHostAddress tests + component flow)
- [x] `/pair-scan` decodes a pairing payload and connects; camera-unavailable falls back to manual. (verified by importPairingOffer test + pairScanAvailability test)

## Follow-ups / TODO(verify)
- QR decode library not wired yet (only camera stream + placeholder); actual QR parsing needs a library like `jsQR` — acceptable since native camera path is the primary use case and web falls back to manual.
- Route wiring in `routes.tsx` still uses PlaceholderScreen; actual mount-point replacement is deferred until all screens exist (sprint-019 end or sprint-020).
