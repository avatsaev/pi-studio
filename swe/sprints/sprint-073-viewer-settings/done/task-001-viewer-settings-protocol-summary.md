# Task 001 — `viewer_settings_*` wire schemas + `viewerSettings` feature flag — Summary

- **Sprint:** sprint-073-viewer-settings
- **Completed:** 2026-09-10
- **Status:** done

## What was implemented

Five `viewer_settings_*` JSON wire schemas (`viewer_settings_get_{request,response}`,
`viewer_settings_set_{request,response}`, `viewer_settings_update`) plus two shared shapes
(`viewerSettingsEntrySchema`, `viewerSettingsSchema`) and a `viewerSettingsPatchEntrySchema` for
the set-request's partial-update body. All are `.passthrough()`, each exports a `z.infer` type,
and all five messages are members of `sessionMessageSchema`'s discriminated union (the
`provider_auth_*` posture, not the passthrough-fallback posture `checkout_status_update` /
`file_changed` / `provider_auth_flow_event` use) — because `viewer_settings_update` carries the
same durable multi-client document the RPCs do and every client parses it on a hot path (the
tab-layout replay gate).

Added the `viewerSettings` server feature flag to `SERVER_FEATURES` (alphabetically after
`thinkingLevels`) with a matching `SERVER_FEATURE_COMPAT` entry.

The daemon has zero plugin knowledge baked into the schema: `viewers` is an open
`z.record(z.string(), …)` (no id enum, ever), and `config` is `z.record(z.string(), z.unknown())`
— an opaque blob, same posture as `agent_ui_request`'s `payload`.

## Files created / changed

| File | Change |
|------|--------|
| `packages/protocol/src/messages.ts` | added the viewer-settings block (7 schemas/types) after the `provider_auth_*` family; added 5 entries to `sessionMessageSchema`'s union |
| `packages/protocol/src/client-capabilities.ts` | added `viewerSettings` to `SERVER_FEATURES` + `SERVER_FEATURE_COMPAT` |
| `packages/protocol/src/session-messages.test.ts` | added imports; added `describe("viewer settings (sprint-073)", …)` — union membership, schema defaults, entry/patch-entry field requiredness, unknown-viewer-id parse, passthrough round-trip |
| `packages/protocol/src/client-capabilities.test.ts` | inserted `"viewerSettings"` into the sorted `SERVER_FEATURES` key literal |
| `packages/protocol/AGENTS.md` | added 4 export-table rows (next to the `provider_auth_*` rows), a note distinguishing `viewer_settings_update` (real union member) from the passthrough-push family, and `viewerSettings` in the `SERVER_FEATURES` doc row |

## How it satisfies the scope

Maps directly to `docs/MOLVIEWER_DECOUPLING.md` § 4.4 (wire shapes) and the task's own "What to
build" section — every named schema exists with the exact field set specified, `patch` entries are
their own schema with both fields optional (not a reuse of `viewerSettingsEntrySchema`, whose
`enabled` is required), and `viewers`/`config` are open/opaque with no enum or interpretation. No
deviations.

## Build & test results

```
$ npm run build:protocol
> tsc -b packages/protocol
(success, no output)

$ npm run typecheck
> tsc -b
(success, no output)

$ npx oxlint packages/protocol/src/messages.ts packages/protocol/src/client-capabilities.ts \
    packages/protocol/src/session-messages.test.ts packages/protocol/src/client-capabilities.test.ts
(no output — 0 warnings/errors)

$ npx oxfmt --check <same 4 files>
All matched files use the correct format.

$ npx vitest run packages/protocol
 Test Files  10 passed (10)
      Tests  116 passed (116)
```

## Acceptance criteria

- [x] All five schemas exist, are `.passthrough()`, export `z.infer` types, and are members of
      `sessionMessageSchema` (verified by "all five request/response/push messages parse through
      the session-message union" test).
- [x] A `patch` entry with only `config` and no `enabled` parses; so does one with only `enabled`
      (verified by "a patch entry with only config and no enabled parses, and vice versa").
- [x] A settings document containing an unknown viewer id (`"totally-unknown-viewer"`) parses
      (verified by "viewerSettingsSchema defaults version/viewers and accepts an unknown viewer id").
- [x] An unknown extra field on any of the five messages survives a parse round-trip (verified by
      "unknown extra fields survive a parse round-trip on every new schema (passthrough)").
- [x] `viewerSettings` is in `SERVER_FEATURES` and has a `SERVER_FEATURE_COMPAT` entry whose `name`
      equals the key (verified by existing generic "annotates every server feature with a COMPAT
      tag" test, which iterates all `SERVER_FEATURES` keys including the new one, plus the updated
      "exports SERVER_FEATURES keys" sorted-literal test).
- [x] `packages/protocol/AGENTS.md` documents the five schemas + the flag, and records that the
      push is deliberately a union member (verified by direct read of the updated file).

## Follow-ups / TODO(verify)

- None. Server handlers/persistence (task-002), SDK methods (task-003), stores/UI (tasks 004-006),
  and the root `AGENTS.md` § Protocol overview entry (task-007) are explicitly out of scope here
  per the task file.
