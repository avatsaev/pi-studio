# Task 006 — Sprint close: cross-browser checks, docs, spec amendments, full gates

- **Sprint:** sprint-081-composer-path-drop
- **Status:** done
- **Type:** docs
- **Area:** repo-wide
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002, task-003, task-004, task-005

## Goal

Prove the feature in every target browser, land the docs and spec amendments, and finish with green
gates.

## Context / why

Task-005 verifies in Chrome. D11's undo and the drag lifecycle differ across engines, and the
feature changes a documented drag contract (workspace-split-panes.md § Drag sources), so the
invariants must be written down where the next drag change will look.

## Scope references

- swe/features/composer-path-drop.md § Acceptance criteria, § TODO(verify)
- swe/notes/composer-path-drop-spike.md
- packages/web-client/AGENTS.md (§ Invariants; "Composer layout"; the external-drag / split-pane
  notes)
- Root AGENTS.md (monorepo-layout web-client line)
- fern/pages/web-ui.mdx (user-facing docs; root AGENTS.md says they mirror README behaviour)

## What to build

Record each step in the summary with its observed result, or mark it not-run with the reason.

1. **Cross-browser:** Firefox and Safari run the task-005 manual checklist, with emphasis on undo,
   Escape-cancel clearing, and the pane-preview hand-off.
2. **Relay:** not applicable. The feature is client-only with no frames. State this in the summary.
3. **Docs:**
   - `packages/web-client/AGENTS.md` gains a "Composer path drop" invariant covering:
     - the path-ref MIME and why it is not an `ExternalDragKind`;
     - folders now `copyMove`;
     - the host-yield rule, and that it holds even while compacting;
     - the strict `relativeRefPath`, not `relativeToRoot`;
     - execCommand-with-fallback, and why (the controlled textarea loses native undo otherwise);
     - no path text in logs.
   - Root `AGENTS.md`: the web-client layout line mentions dropping a Files row onto the composer.
   - `fern/pages/web-ui.mdx`: one sentence (with the README if it describes the composer).
4. **Spec amendments** (`swe/features/composer-path-drop.md`):
   - status: shipped;
   - § Public contract 1 rewritten per task-003's refinement (own MIME + helpers, not an
     `ExternalDragKind`);
   - TODO(verify) #1, #2, #3, #5 marked resolved with outcomes;
   - #4 kept open as the follow-up.
   - Also: `swe/features/workspace-split-panes.md` § Drag sources note matches what shipped;
     `swe/MAIN-SCOPE.md` § 10 updated; PLAN.md sprint-081 status.
5. **Grill brief:** no change; it is history.

## Out of scope

- Fixing `relativeToRoot` and *Copy Relative Path* (tracked follow-up; spec TODO #4)
- Deferred drag sources (Changes tab, timeline links)

## Acceptance criteria

- [ ] Steps 1–2 recorded with observed results
- [ ] Docs and spec amendments landed as listed
- [ ] `npm run build`, `npm run typecheck`, `npm run lint`, `npm run fmt:check` (changed files),
      `npm test` all green

## Test / verification plan

- The live steps above, then the full gates from `swe/av-swe.config.json`
