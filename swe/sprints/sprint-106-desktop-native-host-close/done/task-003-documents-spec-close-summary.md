# Task 003 — Documents and spec close — Summary

- **Sprint:** sprints/sprint-106-desktop-native-host-close
- **Completed:** 2026-11-20
- **Status:** done (documents only). Done in one sequential pass with sprint-111/task-003, which rewrites the same files; the final text of the shared documents is the result of both.

## What was implemented
- **`swe/features/desktop-native-host.md`**
  - Status line: built, checked live on Linux; one criterion open; macOS and Windows not run (sprint-106/task-002, `desktop/docs/platform-checks.md`).
  - Acceptance criteria: 17 of 18 ticked, each with a pointer (`sprint-103/task-004`, `sprint-104/task-008 check N`, `sprint-105/task-005`, `sprint-106/task-001 check N`, `sprint-110/task-007 check N`). **Left open:** the file dragged from the OS ("not run": the container has no desktop; platform-checks N4). Ticked with a stated limit: the `origin` preview (Linux only; macOS/Windows stay `inert` until measured), the `inert` notice (tests and the Chromium snapshot, not a macOS/Windows webview), the second launch (one process; focus not observable without a window manager).
  - The three criteria the task listed as "needs the registry" (A/B layouts with a shared theme, a corrupt `daemons.json`, the registry view in `ui.inspect`) are ticked here too, because the evidence already exists (sprint-110/task-007 check 5, sprint-106/task-001 checks 4 and 16, sprint-111/task-001); see the sprint-111 summary.
  - Decisions recorded where they belong: outside Tauri the browser host (§ 2); boot snapshot carries `preview`, `daemons`/`minDaemonVersion` arrived with the registry (§ 1); ranged save through `saveTarget` (§ 3, § Save to disk); last save folder kept for one run (§ Save to disk); the caps (§ Storage, § Dialogs, § Save to disk); the current entry is `local` until the registry exists (§ Storage); the engine reads and writes the app's files through the native-only `store` crate, not through service hooks (§ 5, Services row). § 5 also lists the page's commands and the two events as built.
  - TODO(verify): each entry now has what was observed (preview, clipboard, file input still unverified, save start folder still unverified, drops, `pagehide` known gap with the switch variant, configuration directory and 0600, macOS/Windows).
  - Purpose rewritten in the past tense ("Before this feature…").
- **`swe/architecture/workbench-host-adapter.md`**: main contract rewritten member by member from `host/types.ts` (dialogs without `prompt`, `preview`, external links, the `saveTarget` option and `SaveTarget`, `app.platform`, `app.minDaemonVersion`, `daemons` and its types). The amendment became a "History" table; its two TODO(verify) entries about Tauri webviews are marked resolved.
- **Indexes:** `swe/MAIN-SCOPE.md` (both feature rows, the host-adapter row, the open-checks entries); `swe/sprints/PLAN.md` (open questions, the coverage row's name).
- **Desktop and repository documents:** `desktop/AGENTS.md` (Where it stands, workspace map, golden rules 6 and 7 corrected, new rule 10 on secrets), `desktop/README.md`, `desktop/docs/architecture.md` (intro, layers, seams 3 and 4, the Decisions row for the host; the registry/supervisor/menu/secrets section is from the sprint-111 task), `desktop/docs/control-protocol.md` (the webview does not use the socket), root `AGENTS.md` (the `desktop/` paragraph), `docs/desktop-client-handoff.md` (status row rewritten as one clean row, "Rules in the scaffold", milestone 1), `packages/workbench/README.md` (`links.openExternal` row).

## Files created / changed
All under `swe/`, `desktop/` (`AGENTS.md`, `README.md`, `docs/architecture.md`, `docs/control-protocol.md`), root `AGENTS.md`, `docs/desktop-client-handoff.md`, `packages/workbench/README.md`, `packages/cli/AGENTS.md`. No source, no `.github/`, no `desktop/docs/platform-checks.md`.

## How it satisfies the scope
Every box ticked has a citation to a summary; every box left open says why and points at sprint-106/task-002 or platform-checks. Decisions from planning and from the work are in the section they affect. `desktop/docs/development.md` and the workbench `AGENTS.md` already matched the code (no edit).

## Verification
- `rg -n "createBrowserHost\(\)|browser host" desktop docs/desktop-client-handoff.md AGENTS.md`: every remaining hit is accurate (the web client's host, the historical transfer notes, the architecture text on what the desktop host keeps from it, three source comments).
- Host adapter spec compared with `packages/workbench/src/host/types.ts` member by member: `AppIdentity`, `DaemonEntryView`, `LocalDaemonState`, `NewDaemon`, `DaemonPatch`, `DaemonErrorCode`, `DaemonError`, `DaemonSettings`, `HostDaemons`, `HostDialogs`, `HostClipboard`, `HostLinks`, `ConnectIntent`, `AgentDeepLinkSource`, `HostLaunch`, `ConnectTarget`, `HostTimers`, `HostConnection`, `UploadSource`, `ViewableFile`, `UploadOptions`, `SaveTarget`, `HostFiles`, `HostPdf`, `HostPreview`, `WorkbenchHost`, and `BrowserHostOptions` (`browser-host.ts`) agree.

## Build & test results
```
$ cd desktop && cargo xtask ci
CI summary: all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm)
$ npm run build        # exit 0
$ npm run typecheck    # exit 0
$ npm run lint         # exit 0 (warnings in packages/server tests, none new)
$ npm test             # 291 files, 4129 tests passed
```
`npm run fmt:check` was not counted (it failed on 28 files before this work).

## Acceptance criteria
- [x] No acceptance box in the spec is ticked without evidence, and none that failed is ticked (none failed; the OS drag, not run, is open).
- [x] The host adapter spec's main contract matches `host/types.ts`.
- [x] No document says the desktop window uses the browser host for storage, dialogs, links, save or the HTML preview (the architecture document says which members the desktop host keeps from it: transport, timers, upload, view URLs).
- [x] The planning-time decisions listed are in the spec.
- [x] `cargo xtask ci`, `npm run build`, `typecheck`, `lint`, `test` pass.

## Follow-ups / TODO(verify)
- The comment above `createDesktopHost` in `desktop/apps/pistudiodesktop/src/host/desktop-host.ts` says the browser host has `app`, `storage`, `launch` and `daemons` replaced; it also replaces `dialogs`, `links`, `preview` and `files`. Source, not touched.
- The caps are recorded as "chosen at planning"; the owner has not confirmed them (PLAN open question stays open).
- Open for a person: sprint-106/task-002 (macOS and Windows, `desktop/docs/platform-checks.md`); the OS file drag, the Upload picker and the save dialog's start folder on a real desktop; the close-time layout flush (~250 ms).
