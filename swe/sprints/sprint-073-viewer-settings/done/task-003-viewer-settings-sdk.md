# Task 003 — `PiStudioClient` viewer-settings facade

- **Sprint:** sprint-073-viewer-settings
- **Status:** done
- **Type:** feature
- **Area:** packages/client
- **Priority:** P1
- **Estimated size:** XS
- **Depends on:** task-001

## Goal

Four `PiStudioClient` methods — `getViewerSettings`, `setViewerSettings`, `onViewerSettingsUpdate`,
`hasViewerSettingsCapability` — so no consumer has to hand-assemble `viewer_settings_*` frames.

## Context / why

Every other RPC family in this repo is reached through the facade, and the web client's store
(task-004) is written against `PiStudioClient`, not `DaemonClient`. Without these methods the store
would reach past the SDK into the transport, which is exactly the coupling the facade exists to
prevent.

No `DaemonClient` change is needed: `request()`, `onSessionMessage()` and `hasFeature()` are already
the three seams required (the same conclusion sprint-065 reached for `provider_auth_*`).

## Scope references

- `docs/MOLVIEWER_DECOUPLING.md` § 4.4 contribution table, `packages/client` row (:404)
- `packages/client/src/pistudio-client.ts` — `listProviderAuth()` (:564-573) for a
  request/response pair, `hasProviderAuthCapability()` (:558-561) for the capability check,
  `onAgentUpdate()` (:539-544) for a plain type-string push subscription
- `packages/client/src/daemon-client.ts:133-136` (`hasFeature`), `:247-250` (`onSessionMessage`)
- `packages/client/src/test-support/scripted-daemon.ts` — `makeFacade()` / `fake.sent` / `fake.push`
- `packages/client/AGENTS.md:191-210` — the `### Methods` table

## What to build

Modify `packages/client/src/pistudio-client.ts` only (no new file — the family is four methods).

```ts
/** True iff the daemon advertised the `viewerSettings` capability in `server_info.features`. */
hasViewerSettingsCapability(): boolean;

getViewerSettings(): Promise<ViewerSettings>;
setViewerSettings(patch: ViewerSettingsPatch): Promise<ViewerSettings>;
onViewerSettingsUpdate(handler: (settings: ViewerSettings) => void): () => void;
```

- `get`/`set` call `this.daemon.request<ViewerSettingsGetResponse["payload"]>(...)` and return
  `payload.settings` — the caller wants the document, not an envelope.
- `onViewerSettingsUpdate` filters `msg.type === "viewer_settings_update"` inside
  `this.daemon.onSessionMessage(...)` and returns its unsubscribe closure directly (no wrapping).
- Import the payload/document types from `@av-pi-studio/protocol` into the existing
  `import type { … }` block, alphabetically.
- Both methods are placed next to the provider-auth group so the file's family grouping holds.

Modify `packages/client/AGENTS.md`: add the four rows to the `### Methods` table (:191-210), in the
table's existing `| method | return | description |` shape. Note on the capability row that a
`false` result means "treat every viewer as enabled", not "no viewers" — the degrade direction is
the load-bearing part and a reader of the table should not have to infer it.

## Out of scope

- Any store, caching, or reconnect rehydration logic — the store (task-004) owns all of that. These
  four methods are stateless pass-throughs by design.
- Retry/backoff on a rejected `set`; the optimistic-rollback decision lives in the store.

## Acceptance criteria

- [ ] `getViewerSettings()` issues exactly one `viewer_settings_get_request` and resolves to the
      response's `settings` document.
- [ ] `setViewerSettings(patch)` issues `viewer_settings_set_request` carrying that patch verbatim
      and resolves to the effective document from the response.
- [ ] `onViewerSettingsUpdate(cb)` fires `cb` for a pushed `viewer_settings_update` and does not
      fire for any other pushed session message; its returned function unsubscribes.
- [ ] `hasViewerSettingsCapability()` is `true` only when the fake daemon advertises the flag.
- [ ] `packages/client/AGENTS.md`'s Methods table lists all four.

## Test / verification plan

- Tests: add a `describe("PiStudioClient — viewer settings (sprint-073)")` block to
  `packages/client/src/pistudio-client.test.ts`, using `makeFacade()` and asserting via
  `fake.sent.find((m) => m.type === "viewer_settings_get_request")` and `fake.push({ type:
  "viewer_settings_update", settings })` — same idioms as the provider-auth block at :353+.
  Include the negative push case (an unrelated message does not invoke the handler) and the
  unsubscribe case.
- Run: `npx vitest run packages/client` — all pass.
- Typecheck: `npm run typecheck` succeeds.
