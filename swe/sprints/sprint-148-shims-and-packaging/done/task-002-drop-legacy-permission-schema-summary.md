# Task 002 — Drop `legacyRespondToPermissionSchema` — Summary

- **Sprint:** sprints/sprint-148-shims-and-packaging
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
Deleted the schema and its entry in the session union (`packages/protocol/src/messages.ts`), its test in `session-messages.test.ts`, and its row in `packages/protocol/AGENTS.md`. No external fixture or desktop Rust model names the message, so no fixture procedure was needed.

## Build & test results
```
$ npx vitest run packages/protocol/src   -> 14 files, 339 passed
$ npm run build:protocol                 -> success
$ Wave gate (full tree, once, after tasks 001-003): `npm run build` exit 0; `npm run typecheck` exit 0; `npm run lint` exit 0 (existing warnings only); `npm test` 323 files, 4648 tests all passed; `oxfmt --check` on changed files clean; `node --test scripts/release/*-test.mjs scripts/build-binary.test.mjs scripts/binary-smoke.test.mjs` 22 passed.
```

## Acceptance criteria
- [x] No `legacyRespondToPermission` anywhere in `packages/` (grep)

## Follow-ups / TODO(verify)
- The other `agent_permission_*` / `agent.permission.respond.request` schemas stay (unread, answer `unknown_message_type`); not in this task.
