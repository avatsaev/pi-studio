# Task 006 — Sprint close: cross-browser checks, docs, spec amendments, full gates — Summary

- **Sprint:** sprints/sprint-081-composer-path-drop
- **Completed:** 2026-11-03
- **Status:** done (with the cross-browser step NOT run, see below)

## What was done
1. **Cross-browser (Firefox, Safari): NOT RUN.** This host has neither browser (no Firefox/WebKit binary; the
   browser tooling is Chromium-only). Chromium 150 was exercised in task-001 (harness) and task-005 (real
   composer). The undo/Escape-cancel/pane-hand-off checks on Firefox and Safari remain open and are recorded
   as such in the spec, MAIN-SCOPE and PLAN.
2. **Relay:** not applicable. The feature is client-only and adds no frames, RPCs or capability flags.
3. **Docs:** `packages/web-client/AGENTS.md` (new "Composer path drop" invariant + source-layout entries for
   `composer-path-drop.ts` and the expanded `external-drag.ts`); root `AGENTS.md` web-client layout line;
   `fern/pages/web-ui.mdx` one section ("Pointing the agent at a file"). Neither README mentions the composer
   or drag-and-drop, so they are unchanged.
4. **Spec amendments:** `composer-path-drop.md` (status shipped, § Public contract 1 rewritten per task-003's
   refinement, acceptance criteria ticked only where verified, TODO(verify) #1/#2/#3/#5 resolved with outcomes,
   #4 kept open); `workspace-split-panes.md` § Drag sources note; `MAIN-SCOPE.md` index row + § 10 items
   (Firefox/Safari and `relativeToRoot` listed as still open); `sprints/PLAN.md` sprint-081 status.
5. **Grill brief:** unchanged (history).

## Build & test results
```
$ npm run build            # success (pre-existing chunk-size notice only)
$ npm run typecheck        # success
$ npm run lint             # 0 errors; warnings are pre-existing, none in changed files
$ npx oxfmt --check <8 changed source files>   # all formatted
$ npm test                 # 3271 passed, 19 failed in 4 server files (git-status, git-ops,
                           # worktree-service, bootstrap): `git commit` fails inside temp repos because the
                           # host has commit.gpgsign=true with no usable signer. Unrelated to this sprint.
$ GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false npm test
                           # 242 files, 3290 tests, all passed
```

## Acceptance criteria
- [ ] Steps 1-2 recorded: step 2 recorded (n/a); step 1 recorded as NOT RUN (Firefox/Safari unavailable)
- [x] Docs and spec amendments landed as listed
- [x] build, typecheck, lint, fmt (changed files), test green (test only with the host's commit signing disabled
      for the test process; the default-config failures are the environmental gpgsign ones above)

## Follow-ups / TODO(verify)
- Run the task-005 checklist (undo, Escape-cancel, pane-preview hand-off, OS-file upload drop, a drop during a
  running turn, a timeline file link released over the composer) on Firefox and Safari, and image paste.
- `lib/paths.ts` `relativeToRoot` sibling-prefix bug and the tree's *Copy Relative Path* (spec TODO #4).
