# Task 001 — Protocol: `extension_packs_list`/`_set` pairs + `extensionPacks` server feature

- **Sprint:** sprint-057-extensions-cli-rpc
- **Status:** done
- **Type:** feature
- **Area:** packages/protocol
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal

Add the two flat snake_case request/response pairs and the `extensionPacks` server-feature flag, so a
client can read curated-pack state and change the selection over the wire.

## Context / why

Sprint 056 shipped the engine with no wire surface: selection and the kill switch are reachable only
through `config.json` and two env vars. This task is the contract everything else in the sprint
consumes — handlers (task 003), the SDK facade (task 004), the CLI (task 005).

Three shape decisions were settled during spec review and must not be re-litigated here:

- **`lastSync` on the list response is a summary, not a report.** Only `{ at, outcome }` is persisted
  (`extensions-state.json`), so promising a full `SyncReport` there would be a lie after any daemon
  restart. The full report exists only as the return value of the sync a request triggered.
- **`packs` on the set request is optional, and its absence is the manual-sync trigger.** Present ⇒
  change the selection and sync. Absent ⇒ change nothing, run an **ungated** manual sync. This is what
  carries `pi-studio extensions sync`, which the spec guarantees keeps working with `autoSync: false`
  — without it, that command would have no RPC to ride on, and routing it through a selection-setting
  request would both rewrite `config.json` pointlessly and hit the `autoSync`-gated path.
- **`report` is optional and `ok`/`error` are domain fields.** A rejected slug answers `ok: false` +
  `error` with no `report`; `rpc_error` carries only transport-level codes, so a handler cannot express
  a domain failure through it.

There is no push/broadcast type in v1: sync is request-triggered and the response carries the result.
If live progress is ever wanted, the per-session `send()` family pattern of `checkout_status_update`
is the precedent to copy — not a new mechanism.

## Scope references

- `swe/features/preinstalled-extensions.md` § RPC surface (the table, `PackInfo`, `EntryInfo`,
  `SyncReport`, the `outcome` derivation, the no-push decision)
- `swe/architecture/websocket-protocol.md` — append-only rules, flat snake_case convention
- `packages/protocol/src/messages.ts` — the discriminated union and existing `*_request`/`*_response`
  pair style
- `packages/protocol/src/client-capabilities.ts:39-77` — `SERVER_FEATURES` + `SERVER_FEATURE_COMPAT`
  (six keys today; sprint-055/task-001 adds `providerAuth`, so expect seven when this lands)
- `packages/server/src/extensions/sync-planner.ts` — `EntryStatus`, the six values this mirrors
  (sprint-056/task-004)
- `packages/server/src/extensions/sync-executor.ts` — `SyncReport`, `ExtensionFailureReason`
  (sprint-056/task-005)
- Modify: `packages/protocol/src/messages.ts`, `packages/protocol/src/client-capabilities.ts` (+ their
  tests)

## What to build

**1. Two message pairs** in `messages.ts`, in the discriminated union, all new fields optional per
append-only rules:

| RPC | Request | Response payload |
|---|---|---|
| `extension_packs_list_request` → `extension_packs_list_response` | `{}` | `{ autoSync: boolean; selected: string[]; packs: PackInfo[]; lastSync?: { at: string; outcome: SyncOutcome } }` |
| `extension_packs_set_request` → `extension_packs_set_response` | `{ packs?: string[] }` | list-response fields **plus** `ok: boolean`, `error?: string`, `report?: SyncReport` |

```ts
type SyncOutcome = "ok" | "noop" | "partial" | "failed" | "skipped";
type EntryStatus  = "installed" | "pending" | "failed" | "user_removed" | "user_modified" | "deprecated";

interface PackInfo  { id: string; title: string; description: string; packages: EntryInfo[] }
interface EntryInfo {
  source: string; identity: string; addedIn: string;
  deprecated?: boolean; status: EntryStatus;
  lastError?: { at: string; attempts: number; reason: string; message: string };
}
interface SyncReport {
  at: string; outcome: SyncOutcome; installed: string[];
  failures: { identity: string; source: string; pack: string; reason: string; message: string }[];
}
```

`reason` is a plain `string` on the wire, **not** a narrowed enum: `ExtensionFailureReason` is a
best-effort classification the daemon may extend, and narrowing it would violate the append-only rule
the first time a value is added. Document that in the schema comment.

**2. `extensionPacks` in `SERVER_FEATURES`** + its `SERVER_FEATURE_COMPAT` entry, following the exact
style of the existing six. A client that does not see the flag must show "update the host" rather than
attempt a degraded path.

**3. Validation errors are domain payloads, not `rpc_error`.** An unknown pack slug in
`extension_packs_set_request` is a domain failure, and a handler cannot choose an `rpc_error` code
(that schema carries only a transport-level `code`/`message`/`error` — verified at
`packages/protocol/src/messages.ts:824-828`). So the set response carries `ok: boolean` +
optional `error: string`, mirroring `file_watch_subscribe_response` (`ok: false, error:
"too_many_watches"` at `packages/server/src/files/file-watch-rpc.ts:58-59`). `report` is optional
for the same reason: a rejected request ran no sync.

## Out of scope

- Handlers, config persistence, SDK, CLI (tasks 002–005).
- Any push/broadcast message type.
- Narrowing or renaming anything already in the union.

## Acceptance criteria

- [ ] Both pairs parse through the session-message union with realistic payloads, including a
      `lastSync`-absent list response and a `report`-bearing set response.
- [ ] `lastSync` accepts exactly `{ at, outcome }` and **rejects nothing extra** (passthrough), but is
      typed as the summary — no `installed`/`failures` fields on it.
- [ ] An `EntryInfo` with an unknown future `status` string and a `SyncReport.failures[].reason` with
      an unknown value both still parse (forward compat proven, not assumed).
- [ ] `extension_packs_set_request` validates **with** `packs` (selection change) and **without** it
      (manual-sync trigger) — the optional field is what carries `pi-studio extensions sync`.
- [ ] `extension_packs_set_response` carries `ok: false` + `error` for a rejected slug and validates
      **without** `report` in that case; an `ok: true` response validates with `report` present.
- [ ] `SERVER_FEATURES` gains `extensionPacks`; `client-capabilities.test.ts`'s exact-key-list
      assertion is updated; every feature still has a `COMPAT` tag (the existing invariant test
      passes untouched).
- [ ] No existing message type, field, or enum value is removed, renamed, or narrowed.

## Test / verification plan

- Build: `npm run build:protocol` then `npm run build` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npx oxlint <changed files>`, `npx oxfmt --check <changed files>` clean.
- Tests: extend `packages/protocol/src/session-messages.test.ts` and
  `packages/protocol/src/client-capabilities.test.ts`; run `npx vitest run packages/protocol`.

## Notes

- Keep `EntryStatus` structurally identical to sprint-056's planner type but **declared here** — the
  protocol package must keep zero workspace imports (root invariant 2). The duplication is
  intentional; task 003 maps between them.
- The six statuses are the full set after review removed `source_changed`; do not reintroduce it.
- `packages/protocol/AGENTS.md` is updated in task 006's docs sweep, not here.
