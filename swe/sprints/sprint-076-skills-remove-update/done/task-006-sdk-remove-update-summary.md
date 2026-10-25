# Task 006 — Client SDK: `removeSkill`, `updateAllSkills` — Summary

- **Sprint:** sprint-076-skills-remove-update
- **Completed:** 2026-10-25
- **Status:** done

## What was done

Added two facade methods to `PiStudioClient` mirroring sprint-075's `listSkills`/`setSkillEnabled`
pattern, each using `DaemonClient.request()`'s third `timeoutMs` argument (the `COMPACT_TIMEOUT_MS`
precedent) instead of the client's 30 s default:

- `removeSkill({path} | {packageSource})` → `skills_remove_request`, resolves
  `Promise<SkillsRemoveResponse>`. The TS parameter type enforces the wire schema's xor (`path` XOR
  `packageSource`) at compile time. Uses the new `REMOVE_SKILL_TIMEOUT_MS = 660_000` ms.
- `updateAllSkills()` → `skills_update_all_request` (empty payload), resolves
  `Promise<SkillsUpdateAllResponse>` (`{ok, results: ItemResult[], skills, packages}`). Uses the new
  `UPDATE_ALL_SKILLS_TIMEOUT_MS = 1_300_000` ms.

Both are domain-failure-returns-not-throws, same as `setSkillEnabled`/`listSkills` — no new error
class was needed since `skills_remove_response`/`skills_update_all_response` already carry
`ok`/`error` in-payload.

Timeouts match `swe/architecture/pi-resource-management.md` § Timeouts: daemon per-spawn bound is
600 s; SDK timeout is set above that (660 s for one spawn, 1 300 s for the two sequential spawns
`updateAllSkills` triggers daemon-side).

Extended `test-support/scripted-daemon.ts` with `skills_remove_request`/`skills_update_all_request`
handlers (previously fell through to the generic default-echo branch, which doesn't shape a
protocol-correct response) so `pistudio-client.test.ts` can exercise both methods against the fake
transport.

## Files changed

| File | Change |
|---|---|
| `packages/client/src/pistudio-client.ts` | Added `REMOVE_SKILL_TIMEOUT_MS`, `UPDATE_ALL_SKILLS_TIMEOUT_MS` constants; `removeSkill()`, `updateAllSkills()` methods; imported `SkillsRemoveResponse`, `SkillsUpdateAllResponse` types |
| `packages/client/src/pistudio-client.test.ts` | Added 3 tests: `removeSkill` with `path`, `removeSkill` with `packageSource`, `updateAllSkills` — each asserting payload + per-call `daemon.request` timeout argument |
| `packages/client/src/test-support/scripted-daemon.ts` | Added `skills_remove_request`/`skills_update_all_request` scripted response handlers |
| `packages/client/AGENTS.md` | Documented the two new methods in the `PiStudioClient` methods table; added a paragraph (next to the `compact()`/`COMPACT_TIMEOUT_MS` note) explaining the new timeout constants |

## Build & test results

```
$ npm run build:client
> tsc -b packages/client
(no output — clean)

$ npm run typecheck
> tsc -b
(no output — clean)

$ npx vitest run packages/client
 Test Files  8 passed (8)
      Tests  172 passed (172)
   Duration  1.44s

$ npx oxlint packages/client/src/pistudio-client.ts packages/client/src/pistudio-client.test.ts packages/client/src/test-support/scripted-daemon.ts
(no output — clean, no new warnings)
```

## Acceptance criteria

- [x] Requests carry the right payload and per-call timeout (fake transport) — verified via
      `fake.sent` payload assertions and `vi.spyOn(daemon, "request")` timeout-argument assertions
      in the three new tests.

## Follow-ups

None — install methods are explicitly out of scope (sprint 077).
