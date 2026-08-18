# Task 004 — Sidebar chrome: counted header, per-workspace "New session", pinned footer — Summary

- **Sprint:** sprint-062-workspace-sidebar-redesign
- **Completed:** 2026-08-18
- **Status:** done

## What was implemented

`SessionList`'s frame rebuilt per § 03: the header now reads `WORKSPACES · {groups.length}`
(`3xs` rung, bold, `.1em` tracking, uppercase via CSS) with its band pinned to
`WORKSPACE_SECONDARY_HEADER_HEIGHT` (36px) through an inline `minHeight` — no invented `--pi-*`
token, no border (the first band's own top border is the visual separator). The old `FolderOpen`
ghost `Button` and `.openBtn` are gone. Each expanded workspace's row list ends with a `＋ New
session` button (`Icon` + lucide `Plus`, centered, `2xs`/`foregroundMuted`, hover-lift to
`surface0`) dispatching `openNewChat(group.cwd)` — the identical call the band's `⋮` "New
conversation" menu item already used. A single pinned footer row (`＋ Add workspace`, same visual
treatment, `border-top` separator) sits after `.list`, outside the scroll container, calling
`openCwdPicker()` — now the sidebar's only "open a workspace" affordance. Both new/footer buttons
are `disabled` with an explanatory `title` while `status !== "open"`. No `⚙` is rendered anywhere.

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/features/sessions/SessionList.tsx` | modified (header, footer, new-session row) |
| `packages/web-client/src/features/sessions/SessionList.module.css` | modified (`.header`, `.list`, `.newSessionRow`, `.footer`; `.openBtn` removed) |

## How it satisfies the scope

Implements all three chrome pieces from the task's comparison table. The three app-specific
decisions are honored exactly as directed:

1. **One "open a workspace" affordance** — only the footer row; `TabPanelHost.tsx`'s no-workspace
   empty-state "Open Workspace" button is a different surface and was left untouched (out of
   scope, not part of this component).
2. **`⚙` omitted, not faked** — no gear glyph, no settings route/dialog anywhere in the diff.
3. **36px header band** — `WORKSPACE_SECONDARY_HEADER_HEIGHT` from `platform/breakpoints.ts`
   passed as an inline `minHeight`, matching the pane tab strip's height exactly (same constant,
   no duplicated literal).

`EmptyState`'s existing "Not connected" / "No workspaces — open a folder to start" copy is
unchanged, and reads correctly alongside the now-always-visible footer (screenshot-verified: the
hint and the footer's own label don't restate each other).

## Build & test results

```
$ npm run build:web-client
tsc -b && vite build
✓ built in 10.56s   (success — no tsc errors)

$ npx vitest run packages/web-client/src/features/sessions packages/web-client/src/theme/token-integrity.test.ts packages/web-client/src/theme/font-scale.test.ts
✓ workspace-grouping.test.ts (3 tests)
✓ font-scale.test.ts (4 tests)
✓ session-presentation.test.ts (20 tests)
✓ token-integrity.test.ts (3 tests)
Test Files  4 passed (4)
     Tests  30 passed (30)

$ npx oxfmt --check packages/web-client/src/features/sessions/SessionList.tsx packages/web-client/src/features/sessions/SessionList.module.css
All matched files use the correct format.

$ npx oxlint packages/web-client/src/features/sessions/SessionList.tsx
(no errors)
```

Manual (browser, `npm run dev:daemon` mock provider + `npm run dev` web-client): disconnected →
header reads `WORKSPACES · 0`, footer visibly disabled with the "Not connected" hint; connected
with zero workspaces → footer enabled, click opens `OpenWorkspaceDialog`, opening a folder brings
the header to `WORKSPACES · 1` with the workspace's row list ending in an enabled `+ New session`
row; clicking it created and selected a second session in the same workspace (count went 1 → 2),
confirming the `openNewChat(cwd)` dispatch and cwd targeting are correct. Footer stayed pinned
below the scrollable row list across every screenshot.

## Acceptance criteria

- [x] Header reads `WORKSPACES · N` (`N` = `groups.length`) at the `3xs` rung, bold, `.1em`
      tracking, 36px band flush with a pane's tab strip (screenshot- and inline-style-verified).
- [x] Exactly one "open a workspace" affordance in the sidebar — the footer row; the header icon
      button and `.openBtn` are gone (grep/build-verified, no remaining references).
- [x] The footer stays visible outside the scroll container and is disabled with the connect hint
      while disconnected (screenshot-verified both states).
- [x] Each expanded workspace ends with a working `＋ New session` row that opens a new chat in
      that workspace's cwd, disabled while disconnected; the band's `⋮` "New conversation" is
      untouched and dispatches the identical `openNewChat` call.
- [x] No unicode `＋`/`⚙`/`▶` glyph anywhere in the sidebar — every glyph is `Icon` + lucide `Plus`
      (2 call sites, both reviewed).
- [x] Disconnected and no-workspaces empty states still render their existing copy unchanged.

## Follow-ups / TODO(verify)

- None outstanding for this task. task-005 covers the doc sync (feature spec, AGENTS.md
  invariants) and the full pre-ship verification sweep across theme variants and breakpoints.
