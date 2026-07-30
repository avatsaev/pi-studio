# Task 002 — Client `moveEntry` wire helper + user-facing error strings

- **Sprint:** sprint-046-file-explorer-move
- **Status:** backlog
- **Estimated size:** XS
- **Depends on:** task-001

## Goal
One thin client-side call site for `file_move_request` that translates the daemon's error codes into
the exact sentences the user reads in the explorer status line.

## Background / why
`packages/web-client/src/features/files/create-entry.ts` is the established shape for this: a single
exported async function, an `ERROR_MESSAGES` record mapping daemon codes to prose, and a thrown
`Error` carrying the message the caller renders. Copy that structure rather than inventing a second
one — the caller (task-006) then just `catch`es and writes `err.message` to the status line.

## Scope references
- `clean-room-scope/features/file-explorer-move.md` § Public Contract → RPCs,
  § Error Handling & Edge Cases, § UI Behavior (status line)

## What to build
Create: `packages/web-client/src/features/files/move-entry.ts` — a direct structural copy of the
sibling `create-entry.ts` (same doc-comment style, same `ERROR_MESSAGES` → thrown `Error` shape).

```ts
export async function moveEntry(
  client: PiStudioClient,
  path: string,
  destination: string,
): Promise<string>   // returns the resolved destination path
```

Body: `client.connection.request<{ ok: boolean; destination?: string; error?: string }>(
"file_move_request", { path, destination })`; on `!ok` throw
`new Error(ERROR_MESSAGES[code] ?? code ?? "Failed to move")`; on success return
`response.destination ?? destination`.

`ERROR_MESSAGES` — these exact strings are what the user reads:

```ts
const ERROR_MESSAGES: Record<string, string> = {
  empty_path: "Nothing to move.",
  invalid_name: "Invalid name for the destination.",
  exists: "An item with that name already exists in the destination folder.",
  not_found: "That item or destination folder no longer exists.",
  not_a_directory: "The destination is not a folder.",
  same_path: "That item is already in this folder.",
  into_descendant: "A folder cannot be moved into itself.",
  cross_device: "Cannot move across filesystems.",
};
```

## Out of scope
- Any UI wiring, drag handling, or query invalidation (task-006).
- Retry, confirmation prompts, or an overwrite path — `exists` is surfaced as a plain error.

## Acceptance criteria
- [ ] `moveEntry` issues exactly one `file_move_request` with `{ path, destination }` and no other
      fields.
- [ ] A successful response resolves to the daemon's echoed `destination`, falling back to the
      requested `destination` when the field is absent.
- [ ] Every error code produced by task-001's `moveEntry` (`empty_path`, `invalid_name`, `exists`,
      `not_found`, `not_a_directory`, `same_path`, `into_descendant`, `cross_device`, `move_failed`)
      maps to a thrown `Error`; unmapped codes throw with the raw code rather than swallowing it.
- [ ] The module imports nothing from React, stores, or TanStack Query — it is transport only, like
      `create-entry.ts`.

## Test / verification plan
- Build: `npm run build:web-client` and `npm run typecheck` pass.
- No dedicated unit test: `create-entry.ts` has none either, and the behavior is one request plus a
  lookup table — it is covered end-to-end by task-006's browser verification (the collision case
  asserts the `exists` sentence appears verbatim in the status line).

## Notes
- Keep the error map's key set aligned with task-001's returned codes. A code with no entry falls
  back to the raw string, which is ugly but never silent — that is the intended failure mode.
