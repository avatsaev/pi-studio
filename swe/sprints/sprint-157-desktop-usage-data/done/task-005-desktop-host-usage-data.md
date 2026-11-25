# Task 005 — Desktop host: `usageData` over `boot` and `settings.set`

- **Sprint:** sprints/sprint-157-desktop-usage-data
- **Status:** done
- **Type:** feature
- **Area:** desktop/apps/pistudiodesktop/src/host
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-002, task-003

## Goal
The desktop app's host has `usageData`, so Settings → Privacy appears in the window and its switch
writes `shareUsageData`.

## Context / why
Spec § 5, § 6, P1 (the page only reads the view and sets the switch; it never sends).

## Scope references
- `swe/features/desktop-usage-data.md` § 4, § 5, § 6
- `desktop/apps/pistudiodesktop/src/host/boot.ts` (+ test: parse `usage`), create `usage-data.ts`
  (+ test), modify `desktop-host.ts` (+ test)
- Pattern to follow: `desktop/apps/pistudiodesktop/src/host/updates.ts`

## What to build
- `boot.ts`: parse `usage: {enabled, sending, blocked?, id?}`; a malformed part is a boot failure like
  the other parts (same rule as `update`).
- `usage-data.ts`: `current()` from the parsed view; `setEnabled(v)` runs
  `engine_command` `settings.set {key: "shareUsageData", value: v}`, then updates `enabled` and
  `sending` (`sending` = `enabled && !blocked`); rejects with the command's error and keeps the view.
- `createDesktopHost` adds `usageData`.

## Out of scope
Rust (tasks 002, 004).

## Acceptance criteria
- [x] Tests: boot parsing (valid, missing, wrong types, unknown `blocked`), `setEnabled` success and
  failure, `sending` recomputed.
- [x] `cd desktop/apps/pistudiodesktop && npm test`, `cd desktop && cargo xtask ci` (its web step) pass.

## Test / verification plan
- `npx vitest run desktop/apps/pistudiodesktop/src/host`
