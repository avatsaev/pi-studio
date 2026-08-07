# Task 006 summary — Restore claimed chat tabs, agent-stable identity

- **Sprint:** sprint-049-workspace-split-panes-ui
- **Status:** done — user-verified live
- **Written:** 2026-08-03

## The bug this fixes

A workspace split across two conversations came back single-paned after a reload, and the pane that
held the other chat was pruned.

Two independent causes, both fixed here:

1. **Identity was not stable across a reload.** `tabIdentity()`'s `chat` branch keyed on the tab's
   `sessionId`, which is client-local: `openNewChat` mints `s-<base36>-<seq>`, while restore mints
   `s-<agentId prefix>` (`use-session-restore.ts`). The persisted claim `agent:s-msdiisq2-1` could
   therefore never match anything on the next load. It now keys on the daemon-side **agent id**
   (`agent:<agentId>`), which survives reconnects and daemon restarts, and is `null` while a draft's
   `createAgent` is still in flight — an unrestorable tab, correctly omitted from the record.
2. **Only one chat was ever reopened.** `restoreAgents()` hydrated every known agent into the session
   store but opened a tab for `order[0]` alone, so the second pane's claim went unconsumed and the
   settle point pruned its pane. It now reopens **every** hydrated chat whose identity appears in a
   pending claim, across every workspace, then falls back to `order[0]` when nothing claimed it.

A third gap fell out of fix 1: a chat's identity now depends on **session-store** state, and
`bindAgent` mutates neither `tab-store` nor `layout-store`. Without a third subscription a
brand-new conversation's pane stayed unclaimed in the record until some later layout mutation
happened to flush it. `installPaneLayoutPersistence()` now also watches `session-store`, reusing the
same identity-signature comparison, so a bind schedules exactly one write and a title/status change
schedules none.

## Design notes

- **`first` is opened last, and only if unclaimed.** Re-opening an already-placed tab would route
  through `activate` and drag focus off the pane the persisted record chose. The sidebar's
  `session-store.activate(first.id)` and `ui-store.setCwd` are untouched — the most recent
  conversation still highlights, exactly as before.
- **Background workspaces restore too.** `claimedChatIdentities()` scans every workspace's claims, not
  just the one the user lands in; otherwise switching to another workspace after a reload would show a
  layout that had already been pruned.
- **No record ⇒ old behaviour.** `claimed` is empty on a fresh install, cleared storage, or a version
  mismatch, and the loop collapses to the historical single-tab open.
- **Deliberately out of scope:** restoring `file` / `diff` / `molecule` tabs. Their identities persist
  and their claims survive to the settle point, but nothing reopens them — that is a product decision
  about reopening editors on load, not part of this feature.

## Files changed

| File | Change |
|---|---|
| `stores/tab-store.ts` | `tabIdentity()`'s `chat` branch: `agent:<agentId>`, `null` when unbound |
| `hooks/use-session-restore.ts` | `claimedChatIdentities()`, `openChatTab()`, reopen-every-claimed loop |
| `lib/pane-layout-persistence.ts` | third write trigger: `session-store`, via a shared `onIdentityMaybeChanged` |
| `lib/pane-layout-persistence.test.ts` | `chatTab(sessionId, agentId)` fixture; +2 trigger tests (18 in file) |
| `hooks/restore-hydration.test.ts` | +5 claimed-restore tests (13 in file) |

## Commands run

| Command | Result |
|---|---|
| `npx vitest run .../pane-layout-persistence.test.ts` | **18 passed** |
| `npx vitest run .../restore-hydration.test.ts` | **13 passed** |
| `npx vitest run packages/web-client` | **43 files, 535 passed** |
| `npm run typecheck` | ✅ clean |
| `npm run build:web-client` | ✅ built in 7.68s |
| `npx oxlint` (hooks + lib + stores) | ✅ no new warnings |
| `npx oxfmt` | ✅ formatted |

## What the new tests prove

- `agent:<agentId>` is the chat key, and an unbound draft has **no** identity.
- Two claimed chats reopen into **the panes that claimed them** (`P0`/`P1`), with `pendingPlacement`
  emptied by consumption rather than by pruning.
- A claim is honoured over the persisted `activePaneId` fallback (claimed `P1` while focus was `P0`).
- With no record, only the most recent chat opens — the pre-split behaviour, unchanged.
- A claim in a **non-active** workspace restores that workspace's tab too.
- An unclaimed chat stays closed, and a pane whose terminal never came back is still pruned.
- `bindAgent` triggers exactly one write; `setTitle`/`setStatus` trigger none.

## Live verification

User confirmed working ("all good") on 2026-08-03, including the terminal-pid check (`echo $$` before/after drag + pane collapse — same pid).

Automated coverage cannot exercise the real reload path (this project's vitest runs `.test.ts` under
plain Node, no DOM, and restore needs a live daemon). The remaining check, being run by the user:

1. Connect to the daemon, open a workspace.
2. **Split right** → two panes, each holding its own conversation; send a message in each.
3. Reload.
4. Expect: the same two panes, same sizes, each with **its own** chat and its history; the focused
   pane is the one that was focused; no third/duplicate chat tab appears from the other agents the
   daemon still knows about.

Note: any pane-layout record written before this change is keyed on session ids and will not match —
the panes are pruned gracefully at the settle point (no crash), but the first reload after this change
loses the old layout once. `PANE_LAYOUT_VERSION` was intentionally **not** bumped: the feature is
unreleased, so no user record exists. The dev browser's stale record was cleared.
