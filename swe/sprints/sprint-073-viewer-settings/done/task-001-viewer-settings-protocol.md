# Task 001 — `viewer_settings_*` wire schemas + `viewerSettings` feature flag

- **Sprint:** sprint-073-viewer-settings
- **Status:** done
- **Type:** feature
- **Area:** packages/protocol
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal

Add the five `viewer_settings_*` JSON wire schemas and the `viewerSettings` server feature flag, so
the daemon and every client have one shared, append-only contract for per-viewer enable/disable
state.

## Context / why

Molviewer is currently a hardcoded, unconditional part of the web client: a `.cif` file always opens
in a 3D viewer, and there is no way to turn that off. The decoupling plan makes viewers pluggable and
runtime-toggleable, and puts the toggle **on the daemon** rather than in `localStorage`, because a
phone over the relay and a desktop browser talking to the same daemon must not disagree about which
viewers exist.

This family is durable, multi-client state, so it gets **real `sessionMessageSchema` union members**
(the `provider_auth_*` posture), not the `sessionMessageBaseSchema` passthrough fallback used by
`checkout_status_update` / `file_changed` / `provider_auth_flow_event`. The push
(`viewer_settings_update`) is a union member too — unlike `provider_auth_flow_event` — because it
carries the same durable document the RPCs do, and every client parses it on a hot path.

The daemon has **zero plugin knowledge**: rows are keyed by whatever id a client sends, `config` is
an opaque blob, and an unknown id is a valid row. That posture has to be visible in the schema
(open `z.record`, no id enum, `z.unknown()` config values), not just in the server implementation.

## Scope references

- `docs/MOLVIEWER_DECOUPLING.md` § 4.4 (wire shapes at lines 409-417, rules at 419-438), § 5 Phase 0 step 0
- `swe/architecture/viewer-plugin-system.md` § Prerequisite (phase 1's enabled-filter consumes this)
- `packages/protocol/AGENTS.md` § How to add a new wire message type (line 256)
- `packages/protocol/src/messages.ts` — `agentSetThinkingRequestSchema` (:717) and
  `providerAuthListRequestSchema` (:1066) are the shape precedents; union starts at :1343
- `packages/protocol/src/client-capabilities.ts` — `SERVER_FEATURES` (:45-52), `SERVER_FEATURE_COMPAT` (:79-91)

## What to build

**Modify `packages/protocol/src/messages.ts`.** Two shared shapes plus five messages, each
`.passthrough()`, each followed immediately by its `export type X = z.infer<typeof xSchema>` per the
file's convention. Place the block near the `provider_auth_*` family (~:1060) so related families
stay adjacent.

```ts
viewerSettingsEntrySchema  = { enabled: boolean; config?: Record<string, unknown> }
viewerSettingsSchema       = { version: z.literal(1).default(1);
                               viewers: z.record(z.string(), viewerSettingsEntrySchema).default({}) }

viewer_settings_get_request   { requestId }
viewer_settings_get_response  { requestId, payload: { settings: ViewerSettings } }
viewer_settings_set_request   { requestId, patch: Record<string, { enabled?: boolean; config?: Record<string, unknown> }> }
viewer_settings_set_response  { requestId, payload: { settings: ViewerSettings } }   // effective document after merge
viewer_settings_update        { settings: ViewerSettings }                            // broadcast, no requestId
```

- `patch` entries have **both fields optional** — a config-only patch must not have to restate
  `enabled`, and vice versa. The patch entry schema is therefore its own const
  (`viewerSettingsPatchEntrySchema`), not a reuse of `viewerSettingsEntrySchema`.
- `config` is `z.record(z.string(), z.unknown()).optional()` — the protocol never interprets it,
  same posture as `agent_ui_request`'s `payload`.
- `viewers` is an open `z.record(z.string(), …)`: **no** enum of known viewer ids, ever.
- Add all five to the `sessionMessageSchema` discriminated union (:1343), keeping the family's
  entries contiguous.

**Modify `packages/protocol/src/client-capabilities.ts`.** Add `viewerSettings: "viewerSettings"` to
`SERVER_FEATURES` (alphabetically, after `thinkingLevels`) and a matching
`SERVER_FEATURE_COMPAT.viewerSettings = COMPAT({ name: "viewerSettings", addedIn: "0.0.0", removeBy: "TBD" })`
with the `// COMPAT(viewerSettings): …` comment line above it, matching the neighbours exactly.

**Modify `packages/protocol/AGENTS.md`.** Add the five schema/type rows to the `messages.ts` export
table (next to the `provider_auth_*` rows), and add `viewerSettings` wherever the flag list lives.
State in the row group that the push is a **union member, not a passthrough push**, and why (durable
multi-client document, hot parse path) — the file already carries the inverse note for
`provider_auth_flow_event` at :139-143, so the two conventions stay distinguishable.

## Out of scope

- Any server handler, persistence, or broadcast (task-002).
- Client SDK methods (task-003), stores or UI (tasks 004-006).
- Root `AGENTS.md` § Protocol overview entry — task-007 writes it once, with the whole family's
  behavior known.

## Acceptance criteria

- [ ] All five schemas exist, are `.passthrough()`, export `z.infer` types, and are members of
      `sessionMessageSchema`.
- [ ] A `patch` entry with only `config` and no `enabled` parses; so does one with only `enabled`.
- [ ] A settings document containing an unknown viewer id (`"totally-unknown-viewer"`) parses.
- [ ] An unknown extra field on any of the five messages survives a parse round-trip (append-only).
- [ ] `viewerSettings` is in `SERVER_FEATURES` and has a `SERVER_FEATURE_COMPAT` entry whose
      `name` equals the key.
- [ ] `packages/protocol/AGENTS.md` documents the five schemas + the flag, and records that the
      push is deliberately a union member.

## Test / verification plan

- Tests: extend `packages/protocol/src/session-messages.test.ts` —
  (a) a per-schema round-trip block for all five (mirroring the thinking-level block at :449-485),
  (b) entries in the union fixture map (:526-531 shape) so each type parses through
  `sessionMessageSchema`, (c) the optional-field and unknown-id cases from the acceptance criteria.
- Tests: `packages/protocol/src/client-capabilities.test.ts:20-34` — insert `viewerSettings` into the
  sorted key literal (after `thinkingLevels`). The COMPAT-tag loop at :36-41 needs no edit.
- Run: `npx vitest run packages/protocol` — all pass.
- Typecheck: `npm run build:protocol` (or `npm run typecheck`) succeeds.

## Notes

- `serverInfoPayloadSchema.features` is `z.record(z.string(), z.unknown())` (:67) — nothing to change
  there; flag names are enforced by the capabilities module and its test, not by that schema.
- Keep `version: z.literal(1)`, not `z.number()`. A future v2 document is a new literal in a union,
  which is what makes an old daemon's refusal to parse it explicit rather than silent.
