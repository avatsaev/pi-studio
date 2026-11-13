# Task 002 — Apply the deep link after session restore, and on `hashchange` — Summary

- **Sprint:** sprints/sprint-082-agent-deep-link
- **Completed:** 2026-11-13
- **Status:** done

## What was implemented
`applyAgentDeepLink(deps)` (pure, injected effects) in `lib/agent-deep-link.ts`; `applyPendingAgentDeepLink()` wires real stores (activate + setCwd + `openChatTab`, warning toast `Agent not found: <id>`, `history.replaceState(stripAgentParam)`); `useAgentDeepLinkBoot` (mount parse + `hashchange`, applies at once when status open && restored); `useSessionRestore` marks `restored` and applies after `runSessionRestore` settles; mounted in `app.tsx` after `useConnectionBoot`. `restoredRef` never resets within a page, so `restored` stays true and restore never re-runs on reconnect; a consumed target cannot reapply.

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/src/lib/agent-deep-link.ts` | modified (apply) |
| `packages/web-client/src/features/sessions/apply-agent-deep-link.ts` | created |
| `packages/web-client/src/features/sessions/apply-agent-deep-link.test.ts` | added tests |
| `packages/web-client/src/hooks/use-agent-deep-link-boot.ts` | created |
| `packages/web-client/src/hooks/use-session-restore.ts` | modified |
| `packages/web-client/src/app.tsx` | modified |

## Build & test results
```
$ npx vitest run packages/web-client/src   # 116 files, 1518 passed
$ npm run build:web-client                 # success
$ npx oxfmt / npx oxlint <files>           # clean
```

## Acceptance criteria
- [x] Known agent selected, no toast, URL cleaned (test)
- [x] Unknown: one toast call, no selection change (test)
- [x] No duplicate tab (test)
- [x] Consumed never re-applied; unconnected stays pending (tests)
- [x] Layout: after hydration settles the deep-link tab is the active tab (test; apply runs after restore's `markHydrationSource`, so the restore guard is no longer active)
- [x] `useConnectionBoot` untouched, deep link never connects (no connect call in new code)

## Follow-ups / TODO(verify)
- Toast rendering and URL cleanup in a real browser: task-003.
