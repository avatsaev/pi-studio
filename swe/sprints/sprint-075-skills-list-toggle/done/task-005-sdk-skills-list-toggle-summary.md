# Task 005 — Client SDK: `listSkills`, `setSkillEnabled`, `onSkillsChanged`, `hasSkillsCapability`

- **Sprint:** sprint-075-skills-list-toggle
- **Completed:** 2026-10-25
- **Status:** done

## What was implemented

Added the four `PiStudioClient` facade members for the `skills_*` wire family (task-001's protocol
types), following the `viewer_settings_*` methods pattern (`pistudio-client.ts:836-870`):

- `hasSkillsCapability(): boolean` → `this.daemon.hasFeature("skills")`.
- `listSkills(): Promise<SkillsListResponse>` → `skills_list_request` RPC, resolves the full typed
  response (`{ok, error?, message?, skills, packages}`) — domain `{ok:false}` returned, not thrown,
  matching `extension_packs_*`'s flat-field idiom (no `payload` wrapper, per the protocol schema).
- `setSkillEnabled(path, enabled): Promise<SkillsSetEnabledResponse>` → `skills_set_enabled_request`
  RPC, resolves the full post-mutation `{skills, packages}` document.
- `onSkillsChanged(handler): () => void` → subscribes via `daemon.onSessionMessage`, narrows on
  `msg.type === "skills_changed"` using `SessionMessage`'s own discriminated union (no inline
  cast needed — `skills_changed` is already a member of the union task-001 registered), returns the
  unsubscribe function.

Extended the scripted-daemon test harness (shared by `pistudio-client.test.ts` and
`agent-ui-controller.test.ts`) with `skills_list_request`/`skills_set_enabled_request` auto-reply
cases (flat fields, mirroring `extension_packs_*`/`viewer_settings_*` cases already there) so
`listSkills`/`setSkillEnabled` have something to resolve against in tests.

## Files created/changed

| File | Change |
|---|---|
| `packages/client/src/pistudio-client.ts` | New `SkillsListResponse`/`SkillsSetEnabledResponse` imports; `hasSkillsCapability`/`listSkills`/`setSkillEnabled`/`onSkillsChanged` methods on `PiStudioClient` |
| `packages/client/src/test-support/scripted-daemon.ts` | `skills_list_request`/`skills_set_enabled_request` scripted-reply cases |
| `packages/client/src/pistudio-client.test.ts` | New `describe("PiStudioClient — skills (sprint-075)", …)` block (4 tests) |
| `packages/client/AGENTS.md` | New facade-method rows in the `PiStudioClient` methods table |

## How it satisfies the scope

- All four methods match the task's signatures exactly and mirror the cited viewer-settings
  pattern: capability flag → `hasFeature`, request/response pair → typed `daemon.request`, push →
  `onSessionMessage` filter + unsubscribe.
- Domain failures surface as typed `{ok:false, error?}` data, never a thrown error — matches
  `listSkills`/`setSkillEnabled`'s doc comments and the protocol schema's domain-error idiom.
- `onSkillsChanged` uses the already-typed `SessionMessage` discriminated union for narrowing
  rather than an inline-cast, since `skillsChangedSchema` is registered in that union (task-001) —
  no unchecked `as` needed.
- Out of scope respected: no preview/install/remove/update_all methods added.

## Build & test results

```
$ npx vitest run packages/client
 Test Files  8 passed (8)
      Tests  169 passed (169)

$ npm run build:client
> tsc -b packages/client
(clean, no output)
```

Also ran `npx oxfmt packages/client/src/pistudio-client.ts packages/client/src/pistudio-client.test.ts
packages/client/src/test-support/scripted-daemon.ts` (no diffs beyond the authored edits) and
`npx oxlint` on the same three files (zero warnings).

## Acceptance criteria

- [x] Against a fake transport each method sends the right request type and resolves the typed
      response — `listSkills sends skills_list_request…` and `setSkillEnabled sends
      skills_set_enabled_request…` tests assert both the sent wire message (`fake.sent`) and the
      resolved typed payload.
- [x] `onSkillsChanged` fires on the push and stops after unsubscribe — `onSkillsChanged fires only
      for skills_changed pushes; unsubscribe stops delivery` test (also asserts it ignores an
      unrelated `agent_update` push first).

## Follow-ups/TODO(verify)

None. Preview/install/remove/update_all mutating methods are out of scope (sprints 076–077).
