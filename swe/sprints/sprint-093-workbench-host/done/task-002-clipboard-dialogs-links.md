# Task 002 — Host: `clipboard`, `dialogs` and `links`

- **Sprint:** sprint-093-workbench-host
- **Status:** done
- **Type:** feature
- **Area:** packages/workbench (host, features)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
Route clipboard writes, blocking dialogs and external links through the host.

## Context / why
There are 21 `window.confirm`/`alert`/`prompt` calls. Whether they work in a Tauri webview is unverified, and a native shell will want native dialogs either way. External links use an anchor with `target="_blank"`, which is also unverified in a Tauri webview.

## Scope references
- `swe/architecture/workbench-host-adapter.md` § Member contracts (`clipboard`, `dialogs`, `links`), § Dialog call sites, § Error handling
- `packages/workbench/src/lib/clipboard.ts`
- `packages/workbench/src/features/files/{FileContextMenu.tsx,FileExplorer.tsx}`
- `packages/workbench/src/features/sessions/{SessionContextMenu.tsx,WorkspaceContextMenu.tsx}`
- `packages/workbench/src/features/skills/SkillsPanel.tsx`
- `packages/workbench/src/features/provider-auth/{ModelProvidersPanel.tsx,LoginDialog.tsx}`

## What to build
- Add `clipboard.writeText`, `dialogs.confirm/alert/prompt` (all returning promises) and optional `links.openExternal` to the host type.
- Browser host: `clipboard` is today's `copyText` including its `execCommand` fallback; `dialogs` wrap the `window` functions; `links.openExternal` is absent.
- Replace every `window.confirm`, `window.alert` and `window.prompt` call with an awaited host call. Message texts do not change.
- External links: when `links.openExternal` exists, activating the link calls it and prevents the default navigation; when absent, the anchor behaves as today (middle-click and "copy link address" keep working).
- Tests: a confirm that resolves `false` does not run the destructive action; a prompt that resolves `null` does not rename; a host with `openExternal` receives the URL.
- Keep `docs/desktop-client-handoff.md` current: update whatever this task makes stale there (status table, workbench and host sections, wire facts, milestones, open questions). Say in the summary what changed in it, or that nothing did.

## Out of scope
- Replacing native dialogs with in-app dialogs in the browser.

## Acceptance criteria
- [ ] No workbench source outside the browser host calls `window.confirm`, `window.alert`, `window.prompt` or `navigator.clipboard`.
- [ ] In the browser every dialog shows the same text as before and blocks as before.
- [ ] Cancelling a confirm leaves the file, agent, workspace, skill or credential untouched.
- [ ] All tests pass.
- [ ] `docs/desktop-client-handoff.md` matches the repository after this task, or the summary states that nothing in it was affected.

## Test / verification plan
- `rg "window\.(confirm|alert|prompt)|navigator\.clipboard" packages/workbench/src` matches only the browser host.
- `npx vitest run packages/workbench`
- Browser check: delete a file (cancel, then confirm), rename a session, copy a path.

## Notes
- Handlers become asynchronous. Where a menu closes on click, make sure it still closes at the same moment as before, not after the dialog resolves, unless it did so before.
