# Task 001 — Pure deep-link helpers and the pending-target store — Summary

- **Sprint:** sprints/sprint-082-agent-deep-link
- **Completed:** 2026-11-13
- **Status:** done

## What was implemented
`parseAgentDeepLink`, `stripAgentParam` (pure), `useDeepLinkStore` (`pendingAgentId`, `restored`, `set`, `consume`, `markRestored`; memory only), and a pairing-coexistence test.

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/src/lib/agent-deep-link.ts` | created |
| `packages/web-client/src/lib/agent-deep-link.test.ts` | added tests |
| `packages/web-client/src/stores/deep-link-store.ts` | created |
| `packages/web-client/src/stores/deep-link-store.test.ts` | added tests |
| `packages/client/src/pairing.test.ts` | created (no pairing test file existed) |

## Build & test results
```
$ npx vitest run <3 test files>   # 3 files passed
$ npm run build:web-client        # success
$ npx oxfmt / npx oxlint <files>  # clean
```

## Acceptance criteria
- [x] Parse grammar incl. 256/257 caps (agent-deep-link.test.ts)
- [x] stripAgentParam cases (agent-deep-link.test.ts)
- [x] parsePairingUrl unaffected by `agent` (pairing.test.ts)
- [x] Store set/consume (deep-link-store.test.ts)

## Follow-ups / TODO(verify)
- None.
