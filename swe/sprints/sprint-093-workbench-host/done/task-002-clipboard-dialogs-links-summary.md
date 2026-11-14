# Task 002 — Host: `clipboard`, `dialogs` and `links` — Summary

- **Sprint:** sprints/sprint-093-workbench-host
- **Completed:** 2026-11-14
- **Status:** done

## What was implemented
Host type gained `clipboard.writeText`, `dialogs.confirm/alert/prompt` (promises) and optional `links.openExternal`. Browser host: `lib/clipboard.ts` moved (`git mv`) to `host/browser-clipboard.ts` and used as `clipboard.writeText`; dialogs wrap `window.*`; no `openExternal`. All 21 `window.confirm/alert/prompt` call sites (FileContextMenu ×7, FileExplorer ×1, ModelProvidersPanel ×1, SessionContextMenu ×7, WorkspaceContextMenu ×2, SkillsPanel ×4 — counted with the extracted helpers) now await `getHost().dialogs.*` with unchanged texts; handlers became async; menus close at the same points as before (confirm resolves before close, as the blocking dialog did). The rename and delete-workspace flows moved to `features/sessions/session-actions.ts` (testable outside React). External links: new `host/external-link.tsx` `ExternalAnchor` (and `routeExternalLinkClick`) replaces the three `target="_blank"` anchors in `LoginDialog`; LoginDialog's copy button uses the host clipboard. New `test/test-host.ts` (`createTestHost`: in-memory storage, scripted answers, recorded calls).

## Files created / changed
| File | Change |
|------|--------|
| `packages/workbench/src/host/{types,browser-host}.ts` | members added |
| `packages/workbench/src/host/browser-clipboard.ts` | moved from lib/clipboard.ts |
| `packages/workbench/src/host/external-link.tsx` | created |
| `packages/workbench/src/host/host-members.test.ts` | created (6 tests) |
| `packages/workbench/src/test/test-host.ts` | created |
| `packages/workbench/src/features/sessions/session-actions.ts` | created (rename, delete workspace) |
| `packages/workbench/src/features/{files/FileContextMenu,files/FileExplorer,provider-auth/ModelProvidersPanel,provider-auth/LoginDialog,sessions/SessionContextMenu,sessions/WorkspaceContextMenu,skills/SkillsPanel}.tsx` | host calls |
| `packages/workbench/src/lib/random-id.ts` | comment path |
| `packages/workbench/AGENTS.md, docs/desktop-client-handoff.md` | docs |

## How it satisfies the scope
`workbench-host-adapter.md` § Member contracts (`clipboard`, `dialogs`, `links`), § Dialog call sites, § Browser host.

## Build & test results
```
$ rg "window\.(confirm|alert|prompt)|navigator\.clipboard" packages/workbench/src
only host/browser-host.ts and host/browser-clipboard.ts (+ one comment in lib/random-id.ts)
$ npx vitest run packages/workbench/src/host -> 2 files / 11 tests passed
$ npm run build -> OK; npm run typecheck -> OK; npx oxlint -> exit 0; oxfmt --check (28 changed files) -> clean
$ npx vitest run packages/workbench packages/web-client -> 111 files / 1464 tests passed

Browser (vite dev :5394, production daemon :6767):
- Delete delete-me.txt: dialog dismissed -> file still listed and on disk; accepted -> removed from the tree and from disk.
- Copy Absolute Path on notes.txt -> clipboard holds "/tmp/wb-parity/notes.txt".
- Rename: the prompt opens through the host; the harness can only accept with the default value, so the title stayed (rename-with-new-text covered by the unit test).
- Delete workspace (all conversations) on the scratch workspace with the dialog accepted -> workspace gone (cleanup of the sprint-092 parity workspace).
```

## Acceptance criteria
- [x] No workbench source outside the browser host calls `window.confirm/alert/prompt` or `navigator.clipboard`.
- [x] Browser dialogs show the same texts and block as before (native dialogs via the browser host).
- [x] Cancelling a confirm leaves the target untouched (browser file delete; unit tests for workspace delete; prompt null → no rename).
- [x] All tests pass.
- [x] `docs/desktop-client-handoff.md`: host section lists the new members and the `openExternal` behaviour.

## Follow-ups / TODO(verify)
- The prompt-with-typed-text path was verified by unit test only (the headless harness answers prompts with their default value).
