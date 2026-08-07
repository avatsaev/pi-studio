# Task 002 — Capability flags + compatibility gating — Summary

- **Sprint:** sprint-002-protocol
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
Created `packages/protocol/src/client-capabilities.ts` defining both directions of the per-feature
compatibility layer plus the serialization-time gating helper:
- `CLIENT_CAPS` (client→daemon, advertised in `hello.capabilities`): `custom_mode_icons`,
  `reasoning_merge_enum`, `terminal_reflowable_snapshot`.
- `SERVER_FEATURES` (daemon→client, `server_info.features.*`): `providersSnapshot`,
  `checkoutGithubSetAutoMerge`, `daemonStatusRpc`, `terminal-restore-modes`, `rewind`,
  `checkoutRefresh`.
- `SERVER_FEATURE_COMPAT`: a `COMPAT(...)` annotation per feature flag (name + addedIn + removeBy
  placeholder) using the shared `COMPAT` helper, plus grep-able `// COMPAT(name)` comments.
- `supports(caps, flag)`: models daemon `session.supports(...)`; returns true only for advertised
  flags. Accepts record, array, and `Set` capability forms.

## Files created / changed
| File | Change |
|------|--------|
| `packages/protocol/src/client-capabilities.ts` | created |
| `packages/protocol/src/index.ts` | modified — re-exports capabilities |
| `packages/protocol/src/client-capabilities.test.ts` | added — 6 tests |

## How it satisfies the scope
- **websocket-protocol.md § Capability flags / Compatibility rules:** both flag sets reproduced with
  the documented names; gating helper enforces "new wire enum values gated via `session.supports`."
- **MAIN-SCOPE §9 (Feature compatibility):** features advertised in `server_info.features.*`; each
  carries a `COMPAT(name)` tag with version + removal date.

## Build & test results
```
$ npm run build:protocol      → exit 0 (no type errors)
$ npx vitest run packages/protocol/src/client-capabilities.test.ts
 ✓ client-capabilities.test.ts (6 tests)
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

## Acceptance criteria
- [x] `CLIENT_CAPS` and `features` flag sets are exported and typed (`ClientCapability`,
      `ServerFeature` union types).
- [x] `supports(caps, flag)` returns true only for advertised flags (record/array/Set + empty/undefined).
- [x] Each feature flag carries a `COMPAT(...)` annotation (verified for all 6 keys).

## Follow-ups / TODO(verify)
- `COMPAT` removal dates are `"TBD"` placeholders and floor versions are `0.0.0`; confirm against the
  live `ServerInfoStatusPayloadSchema` / `CLIENT_CAPS`.
- Wiring `supports()` into the daemon session is sprint-004 (out of scope here).
