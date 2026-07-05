# Task 002 — Onboarding & device-pairing screens — Summary

- **Sprint:** sprint-013-app-navigation-screens
- **Completed:** 2026-07-05
- **Status:** done

## What was implemented

Implemented welcome/onboarding action selection, desktop local-daemon action flow, pairing offer
fragment decoding/validation, offer import/probe/upsert routing, and pair-scan platform availability.

## Files created / changed

| File | Change |
|------|--------|
| `packages/app/src/onboarding/welcome.ts` | created welcome action model, online-host auto redirect, desktop `useThisComputer` flow |
| `packages/app/src/onboarding/pairing.ts` | created `PairingOfferSchema`, offer extraction/decode, import/probe/upsert flow, pair-scan availability |
| `packages/app/src/onboarding/index.ts` | created onboarding barrel export |
| `packages/app/src/onboarding/onboarding.test.ts` | added 14 tests |
| `packages/app/src/index.ts` | exports onboarding module |

## How it satisfies the scope

- Platform-dependent welcome actions are modeled: web (`direct`, `paste`), native (`scan QR`, `direct`,
  `paste`), desktop (`Use this computer`, `direct`, `paste`).
- Welcome auto-redirect picks the earliest online host and returns its `/h/{serverId}` route.
- Desktop `Use this computer` calls `setDaemonMode("embedded")`, starts the local daemon immediately,
  and routes to the returned host root.
- Pairing flow consumes a `#offer=` fragment, validates the relay offer contract, probes the daemon,
  upserts a relay host profile, then routes by source (`onboarding` → host root, `settings` → host
  connections settings).
- Web/desktop pair-scan is unsupported; native uses the camera path.

## Build & test results

```
$ npx vitest run packages/app/src/onboarding/onboarding.test.ts
 ✓ packages/app/src/onboarding/onboarding.test.ts (14 tests) 4ms

$ npm --workspace @av-pi-studio/app run typecheck
 success
```

## Acceptance criteria

- [x] Welcome shows right actions per platform, including desktop's primary “Use this computer”.
- [x] Desktop “Use this computer” switches to embedded mode, starts local daemon, and routes to host root.
- [x] Valid offer probes, upserts, and routes by source; unsupported web pair-scan path is modeled.
- [x] Deep-link `#offer=` extraction works for app-wide import.

## Follow-ups / TODO(verify)

- Exact upstream `offer` fragment encoding is TODO(verify); implementation accepts URL-encoded JSON and
  base64url JSON to keep tests deterministic.
- Camera permission UI and QR scanner rendering require the native runtime; this task provides the flow
  contracts for that screen.
