# Task 002 Summary — Client `moveEntry` wire helper + error strings

## What was built
- `packages/web-client/src/features/files/move-entry.ts` — a structural copy of `create-entry.ts`:
  `moveEntry(client, path, destination)` issues exactly one `file_move_request` with `{ path,
  destination }`, throws a mapped `Error` on `!ok`, and resolves to `response.destination ??
  destination` on success.
- `ERROR_MESSAGES` covers every code `moveEntry` (task-001) can return: `empty_path`,
  `invalid_name`, `exists`, `not_found`, `not_a_directory`, `same_path`, `into_descendant`,
  `cross_device`; an unmapped code (e.g. `move_failed`) falls back to the raw code string, never
  swallowed.

## Files changed
- `packages/web-client/src/features/files/move-entry.ts` (new).

## Commands run + results
- `npm run build:web-client` → clean (typecheck + vite build).
- `npm run typecheck` → clean (whole-repo `tsc -b`).

## Acceptance criteria status
All satisfied: single-request shape with no extra fields, destination fallback on success, full
error-code coverage with raw-code fallback for unmapped codes, and the module imports nothing from
React/stores/TanStack Query (only `PiStudioClient`'s type).

## Notes / follow-ups
- No dedicated unit test, matching `create-entry.ts`'s precedent and the task's own guidance — this
  is covered end-to-end by task-006's browser verification.
