# Task 008 summary — Reopen client-side file/diff/molecule tabs on load

- **Sprint:** sprint-049-workspace-split-panes-ui
- **Status:** done — user-verified live
- **Written:** 2026-08-03

## What was wrong

Panes and their claims persisted, but only **daemon-owned** tabs were ever reopened. A
`file`/`diff`/`molecule` tab is a view of a path with no daemon-side existence, so nothing reopened it,
its claim expired at the hydration settle point, and the pane holding it was pruned — two files side by
side collapsed to one pane on every reload.

## The shape of the fix

The persisted **identity is already the descriptor**: `file:<path>`, `diff:<staged|worktree>:<path>`,
`molecule:<path>`. So this needed no new persisted state, no schema change, and no version bump — just
the inverse function and a replay:

- `tabFromIdentity(identity, workspaceCwd)` — exact inverse of `tabIdentity` for the three client-side
  kinds; `null` for `agent:`/`terminal:` (the restore hooks' job) and for anything unrecognised or
  path-less.
- `reopenClientTabs(loaded)` — walks every workspace's `placement` and opens what maps.
- Called from `usePaneLayoutBoot` immediately after `installPersistedLayouts`.

Three decisions worth keeping:

1. **Literal reconstruction, not `openFileTab`.** That helper *dispatches* on extension, so a persisted
   `file:/a/x.cif` would come back as a `molecule` tab, fail to match its own claim, and lose the pane
   anyway — the exact bug being fixed, one layer down. Round-tripping identity is the whole job, so the
   mapping must be literal. A test asserts `tabIdentity(tabFromIdentity(x)) === x` for all four forms.
2. **Gated on a live connection, not on mount.** First cut replayed at mount, and the user caught it
   immediately: reopening tabs is what brings a workspace into view, so a full split layout with file
   tabs appeared *behind the connect form*, before there was any daemon to load them from. It now waits
   for `status === "open"` — the same rule the daemon restores follow — and still runs before them
   (all three hooks live in `app.tsx`'s `Boot`, so effects fire in declaration order in one commit).
   Once per page load, not per connection: the tabs survive a reconnect, and replaying would
   re-activate them and steal focus. The geometry install stays at mount; it is invisible until a
   workspace is in view and must precede any tab arrival.
3. **Writes now preserve unconsumed claims** — a pre-existing bug this replay would have fired on every
   load. `writePaneLayout` derived the record purely from *live* tabs, so any write inside the restore
   window persisted only the tabs already open and dropped every pane whose chat or terminal was still
   in flight. The next load had geometry with no claims, and the settle point pruned exactly those
   panes: the split collapsed **one reload later**, with no user action and nothing to point at.
   Serialization now seeds `placement`/`activeByPane` from `pendingPlacement`/`pendingActive` and
   layers live tabs over them; post-settle the pending sets are empty and it reduces to the old
   projection exactly.
4. **Unknown prefixes are ignored, never guessed.** A record written by a newer client can name kinds
   this one has never heard of; those claims simply expire as before.

## Files changed

| File | Change |
|---|---|
| `features/workspace/reopen-client-tabs.ts` | new — `tabFromIdentity`, `reopenClientTabs` |
| `features/workspace/reopen-client-tabs.test.ts` | new — 10 tests |
| `hooks/use-pane-layout.ts` | replay gated on the connection, once per page load; install stays at mount |
| `lib/pane-layout-persistence.ts` | `writePaneLayout` layers live tabs over unconsumed claims |
| `lib/pane-layout-persistence.test.ts` | +2 regression tests (20 in file) |
| `packages/web-client/AGENTS.md` | new "Who reopens a tab depends on who owns it" + "A pane-layout write must never drop a claim" invariants (replacing the now-false claim that these kinds are never reopened); qualified the zero-agents invariant; layout entries for the new module and the boot hook |
| `clean-room-scope/features/workspace-split-panes.md` | § Restoring a persisted layout: daemon-owned vs client-side restore, inverse-identity requirement, unknown-prefix rule, replay step in the pseudocode; § Data & Persistence: writes MUST preserve unconsumed claims |
| `clean-room-scope/PLAN.md` | task-008 row, sprint task count 7 → 8, coverage row |

## Commands run

| Command | Result |
|---|---|
| `npx vitest run .../reopen-client-tabs.test.ts` | **10 passed** |
| `npx vitest run packages/web-client` | **44 files, 547 passed** |
| `npm run typecheck` | ✅ 0 errors |
| `npm run build:web-client` | ✅ built in 7.50s |
| `npx oxfmt --check` | ✅ clean |
| `npx oxlint` | ✅ no new warnings |

## Live verification

User confirmed working ("all good") on 2026-08-03, including the terminal-pid check (`echo $$` before/after drag + pane collapse — same pid).

1. Open two files in separate panes (and/or a molecule view, and/or a diff from the Changes panel).
2. Reload.
3. Expect: the same panes, same sizes, each with its file/diff/molecule tab and the right active tab
   per pane; content loads as the connection comes up.
4. Also worth a look: a file that was deleted between loads (tab reopens, panel shows its error state —
   the pane is not lost), and a diff whose file is no longer modified (tab reopens, diff is empty).
