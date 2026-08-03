# Task 008 — Reopen client-side file/diff/molecule tabs on load

- **Sprint:** sprint-049-workspace-split-panes-ui
- **Status:** in_progress
- **Type:** feature
- **Depends on:** task-006 (claim-driven restore routing)
- **Size:** S

## Why

Reported from the live smoke test: chats and terminals come back after a refresh, but **open files and
molecule views disappear**, and the panes holding them collapse.

This was a documented scope decision, and it is the wrong one. Panes and their claims persist, but
only *daemon-owned* tabs are ever reopened — chats from `list_agents_request`, terminals from the
terminal listing. A `file`/`diff`/`molecule` tab has no daemon-side existence at all, so nothing
reopens it, its claim expires at the hydration settle point, and `settleHydration` prunes its pane.
Two files side by side therefore collapse to a single pane on every reload, which makes the whole
split feature feel lossy.

## Target

- `packages/web-client/src/features/workspace/reopen-client-tabs.ts` (new) — `tabFromIdentity` +
  `reopenClientTabs`.
- `packages/web-client/src/hooks/use-pane-layout.ts` — replay at boot, after the install, before the
  persistence writer is wired.
- Docs: `packages/web-client/AGENTS.md`, `clean-room-scope/features/workspace-split-panes.md`.

**Non-goals:** no new persisted state, no schema/version bump, no change to how daemon-owned tabs are
restored, no scroll-position or editor-state restoration.

## Change

1. `tabFromIdentity(identity, workspaceCwd)` — the exact inverse of `tabIdentity` for the three
   client-side kinds; `null` for `agent:`/`terminal:` (daemon-owned) and for anything unrecognised or
   path-less. It MUST build the tabs literally rather than call `openFileTab`, which dispatches on
   extension: a persisted `file:/a/x.cif` would come back as a `molecule` tab, fail to match its own
   claim, and lose the pane anyway.
2. `reopenClientTabs(loaded)` — walk every workspace's `placement` and `open()` what maps.
3. Call it from `usePaneLayoutBoot` right after `installPersistedLayouts`, synchronously: each open
   consumes its own claim, and the replay completes long before either daemon restore reports in, so
   no new hydration source and no ordering coordination are needed. It needs no connection — a
   path-backed panel's content query is gated on the client and fires when one appears.

## Acceptance

- [x] Every client-side identity round-trips: `tabIdentity(tabFromIdentity(x)) === x`.
- [x] A `file:` and a `molecule:` identity on the same path stay distinct kinds.
- [x] Reopened tabs land in the pane that claimed them, and those claims are consumed (not pruned).
- [x] `agent:`/`terminal:` claims are left pending for the restore hooks.
- [x] Every workspace in the record is replayed, not just the active one.
- [x] A second replay activates rather than duplicating; an empty record does nothing.
- [x] Unknown prefixes and path-less identities are ignored, never guessed.
- [ ] **Live:** open two files (and/or a molecule view) in separate panes, reload, and both panes come
      back with their tabs — user-verified.

## Verification

`reopen-client-tabs.test.ts` (10 tests) + full web-client suite; live check handed to the user.
