# Task 002 — Commit box, branch switcher & git actions

- **Sprint:** sprint-024-git-full
- **Status:** done
- **Estimated size:** L
- **Depends on:** task-001; sprint-023/task-002 (git hooks)

## Goal
Build the commit box (message + suggest + commit + push), branch switcher (create/switch/delete),
and the full git actions cluster wired to real RPCs.

## Scope references
- `clean-room-scope/features/feature-panels-ui.md` § git actions, § commit box
- `clean-room-scope/features/git-checkout.md` § branch operations

## What to build
- **Commit box**: collapsible panel at bottom of Changes tab. Textarea for commit message; "Suggest
  message" button (calls agent to generate commit message from diff); "Commit" primary button
  (calls `git.commit` RPC); optional "Commit & Push" secondary. Stage/unstage individual files.
  Show commit progress + success/error toast.
- **Branch switcher**: combobox in workspace header showing current branch; dropdown lists local +
  remote branches (from `useGitBranches`); search/filter; select → `git.checkout` RPC.
  "Create branch" action → input name → `git.branch.create` RPC. "Delete branch" with confirmation.
- **Git actions cluster**: primary action (varies by state: "Commit" when dirty, "Push" when ahead,
  "Pull" when behind, "Up to date" when clean). Secondary actions in dropdown: stash, stash pop,
  fetch, merge, rebase. Each action: pending spinner → success toast / error toast.
- **Worktree setup callout**: if workspace uses a worktree (from workspace descriptor), show a
  callout explaining the worktree status and offering "Back to main" / "Delete worktree".
- **Conflict resolution**: when merge/rebase conflicts arise, show conflict file list with
  "Accept ours" / "Accept theirs" / "Open in editor" per file.

## Acceptance criteria
- [ ] Commit box: write message, suggest from diff, commit, push — all via RPCs with feedback.
- [ ] Branch switcher: list/search/switch/create/delete branches via RPCs.
- [ ] Git actions cluster reflects repo state (dirty/ahead/behind/clean).
- [ ] Conflict resolution UI shows when conflicts exist.

## Test / verification plan
- Commit: mock RPC → verify commit message sent → success toast.
- Branch: mock branch list → verify dropdown; switch → verify checkout RPC.
- Actions: mock "ahead" state → verify "Push" is primary action.
- Conflicts: mock conflict state → verify file list shown.
