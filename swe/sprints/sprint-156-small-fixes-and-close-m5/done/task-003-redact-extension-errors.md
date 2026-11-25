# Task 003 — No credentials in extension error text

- **Sprint:** sprints/sprint-156-small-fixes-and-close-m5
- **Status:** done
- **Type:** bugfix
- **Area:** packages/server (extensions sync)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** sprint-153/task-004

## Goal
A failed extension install never stores, logs or sends a credential.

## Context / why
Section 7 of the audit, folded into M5 by the owner. `sync-executor.ts` keeps the last 2 KiB of raw
stderr as the failure message, stores it in `extensions-state.json` and sends it to clients as
`lastError`; the raw source is also logged and stored. A git URL with a token in it ends up in all
three. The skills path already redacts with `redactSource`. Also: stderr is collected without a cap,
and the code listens for `exit`, not `close`, so output can be cut short.

## Scope references
- `docs/daemon-audit-handoff.md` § 7 (first two bullets)
- `packages/server/src/extensions/sync-executor.ts` (`defaultInstallSpawn` :72-107, `recordFailure`
  :131-145, the failure branches :238-255), `sync-planner.ts` (:51, :61-70), `wire.ts` (:35)
- `packages/server/src/resources/spawn-runner.ts` (`redactSource` :81-84)
- `packages/server/src/extensions/sync-executor.test.ts`, `extensions-rpc.test.ts` (:150)

## What to build
- The failure message (the stderr tail and a thrown error's text) and the source are redacted before
  they are stored, logged or sent.
- Text already stored by an earlier version is redacted on its way to a client.
- stderr keeps only its tail while it is collected; the spawn resolves on `close`.

## Out of scope
The install queue's long waits.

## Acceptance criteria
- [ ] stderr containing `https://user:token@host/repo.git` and `?token=abc`: neither secret is in the
      state file, the log lines, or `lastError`.
- [ ] A state file written before this change, with a secret in it, never reaches a client unredacted.
- [ ] 10 MiB of stderr does not grow memory beyond the tail; the last line is not cut off.

## Test / verification plan
- `npx vitest run packages/server/src/extensions packages/server/src/resources`
- `npm run build:server`
