# Task 006 — Client SDK: `previewSkillSource`, `installSkills` — Summary

- **Sprint:** sprint-077-skills-install
- **Completed:** 2026-10-25
- **Status:** done

## What was done

Added the install-dialog facade surface to `PiStudioClient` in `packages/client`:

- `previewSkillSource(source: string): Promise<SkillsPreviewResponse>` — sends
  `skills_preview_request` with `PREVIEW_SKILL_SOURCE_TIMEOUT_MS` (150 000 ms), named/exported next
  to the sprint-076 skill timeout constants in `pistudio-client.ts`. The daemon bounds its own
  clone/fetch spawn at 120 s (`swe/architecture/pi-resource-management.md` § Timeouts), so 150 s
  comfortably covers it.
- `installSkills({source, skills?, replace?}): Promise<SkillsInstallResponse>` — sends
  `skills_install_request` with `INSTALL_SKILLS_TIMEOUT_MS` (660 000 ms), matching the daemon's
  600 s spawn bound plus margin (same idiom as `REMOVE_SKILL_TIMEOUT_MS`).
- Re-exported `detectSkillSource` (the pure npm/git/skills-repo/local-path classifier) from
  `pistudio-client.ts`, sourced from `@av-pi-studio/protocol`'s `source-detect.ts`
  (sprint-077/task-002), so the web client's install dialog can classify a pasted source string
  client-side before calling `previewSkillSource()`. The daemon still re-runs detection
  authoritatively — this is a UX convenience only.
- Extended the shared scripted-daemon test harness (`test-support/scripted-daemon.ts`) with
  `skills_preview_request`/`skills_install_request` fake replies.
- Added regression tests in `pistudio-client.test.ts` covering request payload/timeout for both
  new methods (including the optional-field-omitted case for `installSkills`) and the
  `detectSkillSource` re-export.
- Updated `packages/client/AGENTS.md`: new rows in the `PiStudioClient` methods table and a
  rationale paragraph (mirroring the sprint-076 `removeSkill`/`updateAllSkills` paragraph)
  explaining the two new timeouts and the `detectSkillSource` re-export.

No UI work (out of scope per task file — consumed by a later web-client slice).

## Files changed

| File | Change |
| --- | --- |
| `packages/client/src/pistudio-client.ts` | Added `PREVIEW_SKILL_SOURCE_TIMEOUT_MS`, `INSTALL_SKILLS_TIMEOUT_MS` constants; `previewSkillSource()`, `installSkills()` methods; re-exported `detectSkillSource` |
| `packages/client/src/pistudio-client.test.ts` | New tests for `previewSkillSource`, `installSkills` (incl. optional-field omission), `detectSkillSource` re-export |
| `packages/client/src/test-support/scripted-daemon.ts` | Added `skills_preview_request`/`skills_install_request` fake reply cases |
| `packages/client/AGENTS.md` | Documented the two new facade methods + timeout/re-export rationale |

## Build & test results

```
$ npx oxfmt packages/client/src/pistudio-client.ts packages/client/src/pistudio-client.test.ts packages/client/src/test-support/scripted-daemon.ts
Finished in 96ms on 3 files using 32 threads.

$ npx vitest run packages/client
 Test Files  8 passed (8)
      Tests  176 passed (176)
   Duration  1.46s

$ npm run build:client
> build:client
> tsc -b packages/client
(no output — clean build)
```

## Acceptance criteria checked

- [x] Requests carry the right payload and timeout (fake transport) — verified by
      `toHaveBeenLastCalledWith` assertions against `daemon.request` spies for both methods,
      covering `source`, `skills`, `replace`, and each timeout constant; plus a dedicated test for
      the optional-field-omitted install payload.

## Follow-ups

None — the web client install-dialog UI consuming these methods is a separate, not-yet-scheduled
slice (out of scope per this task's "Out of scope: UI").
