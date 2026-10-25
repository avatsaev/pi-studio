# Task 007 — Web: Remove, Remove package, Update all — Summary

- **Sprint:** sprint-076-skills-remove-update
- **Completed:** 2026-10-25
- **Status:** done

## What was done

Implemented slice 2 of the Skills manager web panel on top of sprint-075's list+toggle panel and
task-006's SDK (`removeSkill`, `updateAllSkills`):

- **Row Remove** — a per-row `IconButton` (trash icon / spinner while pending) rendered only when
  `skill.removable`. Confirm text comes from `skillRemoveConfirmText` (new,
  `skills-presentation.ts`), which implements the four origin cases from the spec exactly as
  listed, with symlink taking priority over origin (any origin can be a symlink on disk) and the
  "Agent Skills with provenance" wording gated on `provenance` being present (not just
  `origin === "agents_dir"`, since the spec names provenance explicitly) — a hand-placed
  `agents_dir` folder with no provenance falls through to the generic "Deletes `<path>`." wording.
  A declined `window.confirm` sends no RPC. A failed remove shows a dismissible inline row error
  (same pattern as the existing toggle `rowErrors`); the row is never removed speculatively — only
  the next `{skills, packages}` response (which wholesale-replaces the query cache) can make it
  disappear.
- **Package header Remove package** — a `Button` next to each package group's badges, shown for
  every group with a `packageInfo` (i.e. every package group). Confirm text from
  `removePackageConfirmText` names the source and `PiPackageInfo.skillCount`, pluralized. Sends
  `removeSkill({packageSource})`. Failure shows a dismissible inline error under the group header.
- **Toolbar Update all** — a `Button` next to the search box; confirm text is
  `UPDATE_ALL_CONFIRM_TEXT`, shipped verbatim from the spec. Busy state via `Button`'s own
  `loading` prop. On success, renders `UpdateAllResults`: one row per `ItemResult` (label via new
  `updateAllTargetLabel`, mapping `"agent-skills"`/`"pi-packages"` to "Agent Skills"/"Pi packages",
  unknown targets verbatim), a success/failure `StatusBadge`, any `error` string shown inline, and
  — only when `stderr` is present — a "Show details"/"Hide details" toggle revealing a
  scrollable, collapsed-by-default `<pre>` block. Results persist until the next Update all
  attempt or an explicit "Dismiss" click. A thrown/domain failure for the whole request (not a
  per-engine one) shows a dismissible inline error above the group list.
- **Data flow** — `useSkillRemove`/`useSkillUpdateAll` (new, `use-skills.ts`) are explicitly NOT
  optimistic: both wholesale-`setQueryData(rpcKeys.skillsList(), response)` on success, matching §
  Data flow ("install/remove/update replace query data with the response (never optimistic)").
  `useSkillRemove` keys per-target state by skill `path` or `package:<source>` so a row remove and
  a package remove never collide. `useSkillUpdateAll` keeps the full response (including
  `results[]`) in state until dismissed so the panel can render it.
- **"Queued…" simplification** — the spec's "Queued…" state is spelled out only for two installs
  racing across windows (install is out of scope this sprint). Per the task brief's explicit
  permission, each control here shows only "Working…"/a spinner for its own in-flight request;
  cross-mutation disabling is not implemented, since the daemon's own FIFO queueing already makes
  concurrent client mutations safe and nothing in the spec requires the client to serialize them.
  Documented as an invariant in `AGENTS.md` (§ Invariants "Skills panel Remove / Remove package /
  Update all").

## Files changed

| File | Change |
|---|---|
| `packages/web-client/src/features/skills/skills-presentation.ts` | Added `skillRemoveConfirmText`, `removePackageConfirmText`, `UPDATE_ALL_CONFIRM_TEXT`, `updateAllTargetLabel` |
| `packages/web-client/src/features/skills/skills-presentation.test.ts` | Added tests for all four new helpers (one per origin case, pluralization, known/unknown target mapping) |
| `packages/web-client/src/features/skills/use-skills.ts` | Added `useSkillRemove` (+ `SkillRemoveTarget`, `UseSkillRemove`) and `useSkillUpdateAll` (+ `UseSkillUpdateAll`) hooks |
| `packages/web-client/src/features/skills/SkillsPanel.tsx` | Wired toolbar layout, row Remove, package-header Remove package, `UpdateAllResults`; updated header doc comment |
| `packages/web-client/src/features/skills/SkillsPanel.module.css` | Added `.toolbar`, `.removePackageBtn`, `.rowActions`, `.updateAllResults` and related result-row classes |
| `packages/web-client/AGENTS.md` | Updated `skills/` source-layout entry; added the "Skills panel Remove / Remove package / Update all" invariant (including the documented "Queued…" simplification) |

## Build & test results

```
$ npx vitest run src/features/skills src/theme/token-integrity.test.ts src/theme/font-scale.test.ts
 ✓ src/features/skills/skills-presentation.test.ts (33 tests) 5ms
 ✓ src/theme/font-scale.test.ts (4 tests) 2ms
 ✓ src/theme/token-integrity.test.ts (3 tests) 2ms
 ✓ src/features/skills/use-skills.test.ts (4 tests) 2ms
 Test Files  4 passed (4)
      Tests  44 passed (44)
```

```
$ npm run build:web-client
> VITE_TARGET=web tsc -b && NODE_OPTIONS=--max-old-space-size=6144 VITE_TARGET=web vite build
...
✓ built in 10.36s
```
(tsc -b passed with no errors; vite build succeeded — the chunk-size-limit warnings shown are
pre-existing vendor-chunk warnings, unrelated to this change.)

```
$ npx oxlint packages/web-client/src/features/skills/*.ts packages/web-client/src/features/skills/*.tsx
(no output — clean)
```

`npx oxfmt` run on every file touched (no unrelated diffs).

## Acceptance criteria

- [x] Packaged rows show no Remove
- [x] Each origin shows its confirm text
- [x] Update all shows per-engine results and the list refreshes

## Follow-ups

- Install dialog (sprint 077) — out of scope here, as specified.
- No live-daemon manual verification was performed (this task's test plan is unit tests + build
  only); the feature spec's broader production-daemon acceptance checklist (§ Acceptance
  criteria) covers end-to-end verification and is not part of this task's scope.
