# Task 007 — Web: Install skill dialog — Summary

- **Sprint:** sprint-077-skills-install
- **Completed:** 2026-10-25
- **Status:** done

## What was done

Added the Skills panel's toolbar **Install skill…** flow — the last user-visible slice of the
sprint — on top of task-002's wire contract and task-006's SDK methods.

- **`InstallSkillDialog.tsx` (+ `.module.css`, new files).** Source → (preview & pick for
  `skills_repo`/`local_path`) → running → results, per swe/features/skills-manager.md § Install
  dialog. The displayed step has no React state of its own: `skills-presentation.ts`'s new
  `installDialogStep` derives `source`/`previewing`/`pick`/`running`/`results` purely from the two
  RPC hooks' in-flight/settled booleans, so it can't drift from what actually happened.
  - Source step: a text field with a live kind label from the SDK's re-exported
    `detectSkillSource` (`detectedSourceLabel`); Next is disabled for unrecognized input
    (`canAdvanceFromSource`). A recognized `pi_npm`/`pi_git` source shows the skills-only +
    full-system-access notice (`PACKAGE_SOURCE_NOTICE`, shipped verbatim) and Next calls
    `install()` directly, skipping the pick step entirely (`isPackageSourceKind`).
  - Pick step (`skills_repo`/`local_path` only): one row per `PreviewSkill`, checkbox default
    checked iff `valid` (`buildPickRows`), an invalid row shows an "Invalid" badge and stays
    disabled, an `exists` row shows "Already installed" plus its own "Already installed — replace"
    checkbox. Install sends `resolvePickedSkillNames(pickRows)` as `skills` and
    `pickedSkillsNeedReplace(pickRows)` as the request's single `replace` flag — an `exists` row
    whose own Replace checkbox isn't checked is filtered out client-side rather than round-tripped
    through the daemon's `name_exists` rejection (the wire's `replace` is request-wide, not
    per-name — see the pure helper's own doc comment). The Install button names the exact source
    string.
  - Running step: "Installing… this may take several minutes", no submit control — can't
    resubmit.
  - Results step: one row per `ItemResult` (✓/✗, message, collapsible `stderr`), "Done" resets and
    closes; the list itself refreshes via the install response replacing the cached
    `skills_list` query data (same wholesale-replace idiom as remove/update-all) and via the
    daemon's own `skills_changed` broadcast.
  - `SkillsPanel.tsx` mounts `InstallSkillDialog` **unconditionally** — only its `open` prop
    toggles the inner `<Dialog>` — so `useSkillPreview`/`useSkillInstall` never unmount when the
    dialog is closed: an in-flight `install()` keeps running and its state still lands here,
    matching § Install dialog: "closing does not cancel (queue continues; result arrives via
    skills_changed)". A fresh open (closed→open) resets the source field/pick rows/preview state
    UNLESS an install from a prior open is still pending or already settled, in which case
    reopening shows that live/settled state instead of discarding it.
- **`skills-presentation.ts` (+ test).** Pure install-dialog helpers, framework-free per this
  package's no-jsdom convention: `detectedSourceLabel`, `isPackageSourceKind`,
  `canAdvanceFromSource`, `PACKAGE_SOURCE_NOTICE`, `InstallDialogStep`/`installDialogStep`,
  `PickRowState`/`buildPickRows`/`resolvePickedSkillNames`/`pickedSkillsNeedReplace`/
  `hasNoPickedSkills`. 28 new test cases cover step transitions (idle/previewing/pick/running/
  results, package kinds reaching `running` directly, a settled install winning over a stale
  `previewPending`), Next disabled for unrecognized input, default-checked = valid, and every
  Replace-gating combination (new + existing-unreplaced + existing-replaced rows, invalid rows
  never sent).
- **`use-skills.ts`.** New `useSkillPreview` (`skills_preview_request`, no cache interaction — a
  preview mutates nothing) and `useSkillInstall` (`skills_install_request`; on success
  wholesale-replaces the cached `skills_list` query data and keeps the full response — including
  `results[]` — until the next attempt or an explicit `reset()`), following the exact shape of the
  existing `useSkillUpdateAll`.
- **`packages/web-client/AGENTS.md`.** Updated the `skills/` source-layout entry (new
  `InstallSkillDialog.tsx`/`.module.css` files, new `skills-presentation.ts`/`use-skills.ts`
  exports) and the Invariants section: amended the sprint-076 "Queued…" bullet (install is no
  longer out of scope) and added a new "Install dialog step machine +
  closing-doesn't-cancel (sprint-077/task-007)" bullet.

Daemon-side RPC handling (task-003/4/5, `packages/server`) was being built concurrently by another
agent — not touched.

## Files changed

| File | Change |
| --- | --- |
| `packages/web-client/src/features/skills/InstallSkillDialog.tsx` | New — the dialog component |
| `packages/web-client/src/features/skills/InstallSkillDialog.module.css` | New — its styles |
| `packages/web-client/src/features/skills/SkillsPanel.tsx` | Added toolbar "Install skill…" button + unconditional `InstallSkillDialog` mount; updated doc comment |
| `packages/web-client/src/features/skills/skills-presentation.ts` | Added install-dialog pure helpers (step machine, kind labels, pick-row rules) |
| `packages/web-client/src/features/skills/skills-presentation.test.ts` | New test suites for the above (28 cases) |
| `packages/web-client/src/features/skills/use-skills.ts` | Added `useSkillPreview`, `useSkillInstall`; updated doc comment |
| `packages/web-client/AGENTS.md` | Updated `skills/` layout entry + Invariants section |

## Build & test results

```
$ npx vitest run packages/web-client/src/features/skills
 ✓ packages/web-client/src/features/skills/skills-presentation.test.ts (49 tests)
 ✓ packages/web-client/src/features/skills/use-skills.test.ts (4 tests)
 Test Files  2 passed (2)
      Tests  53 passed (53)

$ npx vitest run packages/web-client/src/theme
 Test Files  3 passed (3)
      Tests  13 passed (13)

$ npx oxfmt packages/web-client/src/features/skills/InstallSkillDialog.tsx \
    packages/web-client/src/features/skills/skills-presentation.ts \
    packages/web-client/src/features/skills/skills-presentation.test.ts \
    packages/web-client/src/features/skills/use-skills.ts \
    packages/web-client/src/features/skills/SkillsPanel.tsx
Finished in 93ms on 5 files using 32 threads.

$ npx oxlint packages/web-client/src/features/skills/
(no output — clean)

$ npm run typecheck -w packages/web-client
> tsc -p tsconfig.json --noEmit
(no output — clean)

$ npm run build:web-client
✓ built in 10.20s
```

(Pre-existing `(!) Some chunks are larger than 500 kB` Vite warnings are unrelated to this change —
same chunking warnings present before this task, driven by Shiki/Mermaid language bundles.)

## Acceptance criteria

- [x] Unrecognised input disables Next — `canAdvanceFromSource`, tested; wired to the Next
      button's `disabled` prop.
- [x] Package source skips the pick step — `isPackageSourceKind` routes Next straight to
      `install()`; `installDialogStep` reaches `running` without ever visiting `previewing`/`pick`.
- [x] Existing-name rows require Replace before Install sends them — `resolvePickedSkillNames`
      excludes an `exists` row unless its own `replace` flag is set, tested for every combination.
- [x] Results render per item; list refreshes — `ResultsList` renders one row per `ItemResult`
      with collapsible `stderr`; the install response replaces the cached `skills_list` query data
      and the daemon's `skills_changed` broadcast re-invalidates it for every window.

## Follow-ups

None. Upload tab remains explicitly out of scope (deferred, per the feature spec's non-goals).
The daemon-side `skills_preview_request`/`skills_install_request` handlers (task-003/4/5) are a
sibling in-flight task in `packages/server`, not part of this slice.
