# Task 002 — Documents: the public "Usage data" page and the corrected statements

- **Sprint:** sprints/sprint-158-usage-data-close
- **Status:** done
- **Type:** docs
- **Area:** fern, READMEs, swe, AGENTS files
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** sprint-157/task-004, sprint-157/task-005, sprint-157/task-006

## Goal
D17: the public documentation says what the desktop app sends, to whom, and how to turn it off; no
document says the project has no telemetry; the specs and agent guides match the code.

## Scope references
- `swe/features/desktop-usage-data.md` D17, § 2, § 7
- Create `fern/pages/usage-data.mdx`, add it to `fern/docs.yml`
- `README.md` (the desktop app's section: one sentence and a link), `desktop/README.md`
- `swe/MAIN-SCOPE.md:20` ("It has no telemetry") and the index row's status
- `swe/architecture/workbench-host-adapter.md` (the `usageData` member, a dated amendment line)
- `desktop/AGENTS.md`, `desktop/docs/architecture.md` (the usage module, the hook, the build variable,
  `sys-locale`), `packages/workbench/AGENTS.md` / `README.md` if task-003 did not already
- `swe/features/desktop-usage-data.md` status line
- Not edited: `swe/grills/desktop-native-shell.md:176` (a record of its time)

## What to build
The page: the three events and when; every property of § 2; the country derived by PostHog, no IP
stored; PostHog Cloud, EU; published installers only; off by the switch in Settings → Privacy, or by
`DO_NOT_TRACK`; where the anonymous ID is shown, and that quoting it gets one's events deleted (the
contact being the repository's issues). The panel's link (task-003's constant) resolves to it.

## Acceptance criteria
- [x] `cd fern && fern check` passes.
- [x] `rg -i "no telemetry" README.md fern swe/MAIN-SCOPE.md desktop` finds nothing that contradicts the feature.
- [x] The panel's link target is the page's published address.

## Test / verification plan
- `cd fern && fern check`; the `rg` above.
