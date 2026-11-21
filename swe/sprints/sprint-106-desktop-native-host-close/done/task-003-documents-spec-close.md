# Task 003 — Documents and spec close

- **Sprint:** sprint-106-desktop-native-host-close
- **Status:** done
- **Type:** docs
- **Area:** swe (specs, MAIN-SCOPE, PLAN), desktop documents, root AGENTS.md, packages/workbench documents, docs/desktop-client-handoff.md
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
The native-host spec, the host adapter contract and every document that describes the desktop app agree with what was built, and the spec's status says what is done and what is still open.

## Scope references
- `swe/features/desktop-native-host.md` (status line, § Acceptance criteria, § TODO(verify))
- `swe/architecture/workbench-host-adapter.md` (§ Public contract, § Amendment)
- `swe/MAIN-SCOPE.md` (the spec's index row, the open-checks entries), `swe/sprints/PLAN.md` (sprints 102–106, § Open questions)
- `desktop/AGENTS.md` ("Where it stands", golden rules 1, 5, 6), `desktop/README.md`, `desktop/docs/architecture.md`, `desktop/docs/development.md`
- Root `AGENTS.md` (the `desktop/` paragraph), `packages/workbench/AGENTS.md`, `packages/workbench/README.md`, `docs/desktop-client-handoff.md`
- The task-001 summary (the Linux results) and, if it ran, task-002's

## What to build
- **Spec:** status line; tick each acceptance criterion that passed on Linux, with a pointer to its evidence; leave the macOS and Windows parts open and pointing at sprint-106/task-002. Three criteria need a second daemon entry or the registry file and stay open, marked "needs the registry": separate layouts for entries A and B with a shared theme, a corrupt `daemons.json`, and the registry view in `ui.inspect`. Record the decisions taken at planning and during the work, each in the section it belongs to:
  - outside Tauri (the snapshot tool, a browser on the dev server) the page uses the browser host;
  - the boot snapshot carries `preview`; `daemons` and `minDaemonVersion` arrive with the registry;
  - the save runs range by range through the `saveTarget` option of `createBrowserHost`;
  - the last save folder is remembered for one run of the app;
  - the caps chosen for keys, scopes, dialog text, handles and saves;
  - the current entry is `local` until the registry exists.
  - the engine reads and writes the app's files through the native-only `store` crate, not through service hooks.
  Update each TODO(verify) entry with what was observed.
- **Host adapter spec:** move what is now built from the amendment into the main contract (`dialogs` without `prompt`, `preview`, external links, the `saveTarget` option of the browser host). `daemons` and `app.minDaemonVersion` stay in the amendment, marked "registry, not built".
- **Indexes:** the MAIN-SCOPE row and open-checks entries; PLAN's open questions for these sprints.
- **Desktop and repository documents:** "Where it stands" and the golden rules in `desktop/AGENTS.md`, the root `AGENTS.md` desktop paragraph (no longer "with the browser host"), the handoff document's status row and milestone 1 state, the workbench documents' host sections.

## Out of scope
- `swe/features/desktop-daemon-registry.md`: unchanged here; it is closed by sprint-111/task-003.
- Code.

## Acceptance criteria
- [ ] No acceptance box in the spec is ticked without evidence, and none that failed is ticked.
- [ ] The host adapter spec's main contract matches `packages/workbench/src/host/types.ts`.
- [ ] No document says the desktop window uses the browser host for storage, dialogs, links, save or the HTML preview.
- [ ] The planning-time decisions listed above are in the spec.
- [ ] `cargo xtask ci` and the root `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` pass on the final tree.

## Test / verification plan
- `rg -n "createBrowserHost\(\)|browser host" desktop docs/desktop-client-handoff.md AGENTS.md --glob '!target'` and read each hit.
- Compare the host adapter spec's shape with `host/types.ts` member by member.
- The gates named above.

## Notes
- Shared documents are edited here, in one sequential task, on purpose.
- Root `npm run fmt:check` failed on 28 files before any of this work; do not count that against these sprints, and do not reformat them.
