# Task 001 — Relay control protocol module — Summary

- **Sprint:** sprints/sprint-099-relay-protocol-primitives
- **Completed:** 2026-11-15
- **Status:** done

## What was implemented
`packages/relay/src/control.ts`: six control frame types, `encodeControlFrame`, `parseFirstFrame` (never throws; invalid/legacy/three opening frames), `parseRelayFrame`, `isValidSessionId`/`isValidConnectionId`, `RELAY_CLOSE` (4100–4109, 4200; keyed `UPPER_SNAKE` → `{code, reason}`), `isForwardableCloseCode`, `RELAY_DEFAULTS` (camelCase keys with unit suffixes, e.g. `identifyTimeoutMs`, `flowHighWaterBytes`, `backoffJitter`, `replacedWaitMs`), `newConnectionId`. Only dependency: `tweetnacl`.

## Files created / changed
| File | Change |
|------|--------|
| `packages/relay/src/control.ts` | created |
| `packages/relay/src/control.test.ts` | created (8 tests) |
| `packages/relay/src/index.ts` | export added |
| `packages/relay/AGENTS.md`, `README.md` | module documented |

## How it satisfies the scope
relay-protocol.md § 1–3. Deviation: constant key names chosen by the implementer (spec table names none).

## Build & test results
```
$ npx vitest run packages/relay/src/control.test.ts   -> 8 passed
$ npm run build:relay                                 -> success
$ npx oxfmt / oxlint on changed files                 -> clean
```

## Acceptance criteria
- [x] All six criteria (round-trip, invalid/legacy parsing, RELAY_CLOSE parity, forwardable codes, RELAY_DEFAULTS, export/browser-safe imports) — verified by control.test.ts

## Follow-ups / TODO(verify)
- Browser-safety checked by import inspection, not in a browser.
