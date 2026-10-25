# Task 001 — Protocol: `skills_list` / `skills_set_enabled`, `skills_changed` push, `skills` flag

- **Sprint:** sprint-075-skills-list-toggle
- **Completed:** 2026-10-25
- **Status:** done

## What was implemented

Added the `skills_*` wire family from `swe/architecture/pi-resource-management.md` § Wire family
`skills_*` to `packages/protocol`, scoped to sprint-075 slice 1 (list + toggle only):

- `skillInfoSchema` / `SkillInfo` — one resolved Agent Skill, exactly the spec's fields
  (`name`, `description?`, `path`, `enabled`, `origin`, `originLabel`, `packageSource?`,
  `shadowedBy?`, `symlinkTarget?`, `provenance?: {source, sourceUrl?, installedAt?}`,
  `disableModelInvocation?`, `warnings?: string[]`, `removable`). `origin` is `z.string()` with
  the four documented values (`agent_dir`/`agents_dir`/`package`/`settings_path`) in a doc comment
  only — open string on the wire.
- `piPackageInfoSchema` / `PiPackageInfo` — `source`, `kind: "npm"|"git"|"local"`, `identity`,
  `pinned`, `curated`, `filtered`, `skillCount`.
- `skillsListRequestSchema` / `skillsListResponseSchema` — response
  `{ok, error?, message?, skills: SkillInfo[], packages: PiPackageInfo[]}`, flat top-level fields
  (no `payload` wrapper — mirrors `extension_packs_*`'s domain-error idiom, never `rpc_error`).
- `skillsSetEnabledRequestSchema` (`path`, `enabled`, both required) /
  `skillsSetEnabledResponseSchema` (same shape as the list response).
- `skillsChangedSchema` — `{type:"skills_changed", reason}`, `reason` a plain string
  (`"mutation"|"external"` documented, not an enum), broadcast with no `requestId`, mirroring
  `agent_timeline_reset`'s open-string-`reason` idiom.
- All five schemas registered in `sessionMessageSchema`'s discriminated union and exported.
- `SERVER_FEATURES.skills` + `SERVER_FEATURE_COMPAT.skills` added following the
  `compactionEvents` pattern.
- `packages/protocol/AGENTS.md` updated: new family documented in the `messages.ts` exports
  table, `SERVER_FEATURES` line updated.

Out of scope (per task): preview/install/remove/update_all schemas (sprints 076–077), any
producer or consumer.

## Files created/changed

| File | Change |
|---|---|
| `packages/protocol/src/messages.ts` | New `skills_*` schemas/types; union registration |
| `packages/protocol/src/client-capabilities.ts` | `SERVER_FEATURES.skills` + COMPAT entry |
| `packages/protocol/src/client-capabilities.test.ts` | Updated `SERVER_FEATURES` key-list expectation |
| `packages/protocol/src/session-messages.test.ts` | New imports + `describe("skills (sprint-075/task-001)", …)` block (9 tests) |
| `packages/protocol/AGENTS.md` | Documented the new family + updated `SERVER_FEATURES` line |

## How it satisfies the scope

- Shapes match the spec's `SkillInfo`/`PiPackageInfo` blocks exactly, field-for-field.
- `.passthrough()` on every object (including the nested `provenance` object) so unknown future
  fields survive a round-trip — verified by a dedicated passthrough test per schema.
- `origin`/`reason`/`error` all stay `z.string()` (never a Zod enum) so new values from a future
  Pi/daemon still parse on an older client — verified by "unknown origin string" and "unknown
  reason string" tests.
- Registered in `sessionMessageSchema`'s discriminated union exactly like `viewer_settings_*`/
  `agent_ui_*` (a real durable multi-client RPC family, not a passthrough push).
- `SERVER_FEATURES.skills` + COMPAT tag added following the existing `compactionEvents` pattern.

## Build & test results

```
$ npx vitest run packages/protocol
 Test Files  10 passed (10)
      Tests  127 passed (127)

$ npm run build:protocol
> tsc -b packages/protocol
(clean, no output)
```

Also ran `npx oxfmt packages/protocol/src/messages.ts packages/protocol/src/client-capabilities.ts
packages/protocol/src/client-capabilities.test.ts packages/protocol/src/session-messages.test.ts`
(no diffs beyond the authored edits) and `npx oxlint` on the same four files (zero warnings).

## Acceptance criteria

- [x] A list response with every `SkillInfo` field parses; one with an unknown `origin` string
      also parses — `skillInfoSchema parses every documented field…` and
      `…accepts an unknown origin string (append-only)` tests.
- [x] A `set_enabled` request without `path` or `enabled` is rejected —
      `a set_enabled request without path or enabled is rejected` test (three sub-cases: neither,
      path-only, enabled-only).
- [x] `skills_changed` with an unknown `reason` parses —
      `skills_changed with an unknown reason string parses (append-only)` test.
- [x] `SERVER_FEATURES.skills` exists with a COMPAT tag; existing capability tests pass —
      `client-capabilities.test.ts` updated and green (`annotates every server feature with a
      COMPAT tag` iterates all keys including `skills`).

## Follow-ups/TODO(verify)

None. Preview/install/remove/update_all schemas and any daemon/client producer or consumer are
explicitly out of scope for this task (sprints 076–077 and later tasks in this sprint).
