# Task 004 — `PiStudioClient` facade: `listExtensionPacks` / `setExtensionPacks`

- **Sprint:** sprint-057-extensions-cli-rpc
- **Status:** done
- **Type:** feature
- **Area:** packages/client
- **Priority:** P2
- **Estimated size:** XS
- **Depends on:** task-001

## Goal

Expose the two RPCs as typed SDK methods so browser/native clients never hand-roll the envelope.

## Context / why

`PiStudioClient` is the supported surface for every non-CLI client; raw `WebSocket` use outside the SDK
is forbidden by house rule. A future settings UI (a picker for packs, a status list, a "retry now"
button) consumes exactly these two methods, so they land now while the contract is fresh — this is the
cheapest task in the sprint and unblocks UI work independently of the CLI.

`setExtensionPacks` needs the same long-timeout consideration as the CLI: the response arrives only
after the triggered sync completes, which can exceed the default 30 s `rpcTimeoutMs` on a first run.
The SDK must let a caller pass a timeout rather than hard-coding one, since a UI may prefer to show
progress and give up sooner than a provisioning script would.

## Scope references

- `swe/features/preinstalled-extensions.md` § RPC surface
- `packages/protocol/src/messages.ts` — the pairs and payload types from task 001
- `packages/client/src/pistudio-client.ts` — existing facade method style (thin `request` wrappers,
  e.g. `listAgents`, `listProviders`, `chatCreate`)
- `packages/client/src/daemon-client.ts:186-195` — `request<T>(type, params, timeoutMs?)`, where
  `timeoutMs ?? this.rpcTimeoutMs` applies
- Modify: `packages/client/src/pistudio-client.ts` (+ `pistudio-client.test.ts`)

## What to build

```ts
listExtensionPacks(): Promise<ExtensionPacksListResponse>;
/** Change the selection and sync. */
setExtensionPacks(packs: string[], opts?: { timeoutMs?: number }): Promise<ExtensionPacksSetResponse>;
/** Sync now without changing the selection (sends the request with no `packs` — the ungated manual path). */
syncExtensionPacks(opts?: { timeoutMs?: number }): Promise<ExtensionPacksSetResponse>;
```

Thin wrappers over `this.client.request(...)`, matching the surrounding methods exactly — no retry
logic, no caching, no client-side validation of slugs (the daemon owns the catalog and answers
`ok: false` for unknown ones; duplicating the list in the client would go stale the moment a pack is
added).

`setExtensionPacks` forwards `opts.timeoutMs` to `request`'s third parameter and documents in a
JSDoc line that the call resolves only after the daemon's sync completes, so callers doing a
first-run install should pass a generous value.

## Out of scope

- Handlers (task 003), CLI (task 005), docs (task 006).
- Any UI. A settings picker is a later sprint.
- Caching, optimistic updates, or auto-retry.

## Acceptance criteria

- [ ] `listExtensionPacks()` sends `extension_packs_list_request` with `{}` and returns the parsed
      response payload unchanged.
- [ ] `setExtensionPacks(["swe"])` sends `extension_packs_set_request` with `{ packs: ["swe"] }`.
- [ ] `syncExtensionPacks()` sends `extension_packs_set_request` **with no `packs` key at all** (not
      `packs: []`, which would mean "deselect everything") — the manual-sync contract from task 001.
- [ ] `opts.timeoutMs` reaches `request`'s third parameter; omitting it leaves the client default in
      force (asserted on a fake transport, not by wall-clock waiting).
- [ ] An `ok: false` response is returned to the caller as data — **not** thrown — so a UI can render
      the `error` string.
- [ ] All three methods are exported on the public surface and typed from `@av-pi-studio/protocol` (no
      locally redeclared payload shapes).

## Test / verification plan

- Build: `npm run build:client` then `npm run build` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npx oxlint <changed files>`, `npx oxfmt --check <changed files>` clean.
- Tests: extend `packages/client/src/pistudio-client.test.ts` with the existing fake-transport helper;
  run `npx vitest run packages/client`.

## Notes

- Keep both methods adjacent to the other daemon-scoped facade methods, not with agent/session ones —
  they are host-level configuration, not per-session operations.
- No capability gate inside the SDK: callers check `serverFeatures.extensionPacks` from the `status`
  frame, matching how every other optional feature is handled.
