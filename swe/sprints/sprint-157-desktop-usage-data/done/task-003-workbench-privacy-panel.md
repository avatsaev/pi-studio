# Task 003 — Workbench: the `usageData` host member and Settings → Privacy

- **Sprint:** sprints/sprint-157-desktop-usage-data
- **Status:** done
- **Type:** feature
- **Area:** packages/workbench (host types, settings)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal
`WorkbenchHost.usageData?` exists; when present, Settings shows a "Privacy" category with the switch,
what is sent, why this run sends nothing (if so) and the anonymous ID. The browser host has no member,
so the browser client shows nothing.

## Context / why
Spec § 6, § 7, U12, D11, P5. Categories are gated by daemon capabilities today; this adds a host flag.

## Scope references
- `swe/features/desktop-usage-data.md` § 6, § 7
- `packages/workbench/src/host/types.ts` (`WorkbenchHost`, a new `HostUsageData` + `UsageDataView`),
  `packages/workbench/src/index.ts` (exports)
- `packages/workbench/src/features/settings/settings-categories.ts` (`SettingsCategoryCapabilities.usageData`,
  a "privacy" category), where the capabilities are built (find with
  `rg "daemonUpdate:" packages/workbench/src`), a new `PrivacyPanel.tsx` (+ `.module.css`) and a pure
  `privacy-view.ts` (+ test)
- `packages/workbench/src/test/test-host.ts` (a scripted `usageData` for tests)
- `packages/workbench/AGENTS.md`, `packages/workbench/README.md`

## What to build
- Types per spec § 6: `current()` and `setEnabled(enabled): Promise<void>`.
- `privacy-view.ts`: view → switch state, the blocked line's text (four reasons, § 7), the ID line;
  the fixed list of what is sent (§ 2's properties in plain words, the three events, country from the
  connection, no IP stored, PostHog EU) and the link target for the public page (a constant URL to the
  docs page added in sprint-158/task-002; use the docs site's address pattern from `fern/docs.yml`).
- `PrivacyPanel`: the switch (a failed `setEnabled` shows the error and restores the switch), the
  list, the optional lines; tokens only, `rem`, long ID ellipsized and selectable; reuse the switch
  control `DaemonSettingsPanel` uses.
- `available: (caps) => caps.usageData`; `usageData` is `host.usageData !== undefined`.

## Out of scope
The desktop host (task-005).

## Acceptance criteria
- [x] Unit tests of `privacy-view` for: enabled/disabled, each blocked reason, with and without ID.
- [x] A capabilities test: "privacy" available with a host member, absent without.
- [x] `npm run build:workbench`, `npm run typecheck`, `npm run lint`, `npx vitest run packages/workbench/src` pass.
- [x] The web client looks unchanged in a browser (orchestrator's check at the sprint end).

## Test / verification plan
- `npx vitest run packages/workbench/src/features/settings`
- `npm run build:workbench`

## Notes
Exact wording of the list is the implementer's, constrained by spec § 2 (no property omitted, none added).
