# Task 004 — Workbench package documentation; slim `web-client`'s

- **Sprint:** sprint-094-workbench-build-api
- **Status:** backlog
- **Type:** docs
- **Area:** packages/workbench, packages/web-client (docs)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-002

## Goal
Write the workbench's README, AGENTS and CHANGELOG, and move the application documentation out of `web-client`'s.

## Context / why
`packages/web-client/AGENTS.md` is about 850 lines, almost all of it describing code that now lives in the workbench. Leaving it there would document the wrong package.

## Scope references
- `swe/architecture/workbench-package.md` (whole)
- `swe/architecture/workbench-host-adapter.md` (whole)
- `packages/web-client/{AGENTS.md,README.md}`
- `packages/ui-library/{README.md,AGENTS.md,CHANGELOG.md}` (format precedent)
- Repository rule: docs sync on code changes

## What to build
- `packages/workbench/README.md`: what the package is; quickstart for the whole application (stylesheets, host, `Workbench`); composing a custom shell; the host contract member by member, with the synchronous-storage rule and the transport ordering rule called out; the `./vite` plugin and the pdf.js worker; `fonts.css`; the katex stylesheet decision; the one-instance-per-document limit; the list of public exports.
- `packages/workbench/AGENTS.md`: purpose, dependency graph, source layout tree, commands, invariants. Move the feature, store, hook and timeline sections and their invariants from `web-client`'s AGENTS, updating paths.
- `packages/workbench/CHANGELOG.md`: first entry.
- `packages/web-client/AGENTS.md` and `README.md`: describe the shell only (entry, browser host construction, build-time brand override, Vite config, how it consumes the workbench from source) and link to the workbench for everything else.
- Keep `docs/desktop-client-handoff.md` current: update whatever this task makes stale there (status table, workbench and host sections, wire facts, milestones, open questions). Say in the summary what changed in it, or that nothing did.

## Out of scope
- Root documents, `docs/` and `swe/` (sprint 095 task-002).

## Acceptance criteria
- [ ] The README quickstart is the snippet the pack-smoke script uses, verbatim.
- [ ] Every public export is documented; nothing private is documented as API.
- [ ] No path in either AGENTS file points at a file that does not exist.
- [ ] `web-client`'s AGENTS no longer describes code that left the package.
- [ ] `docs/desktop-client-handoff.md` matches the repository after this task, or the summary states that nothing in it was affected.

## Test / verification plan
- A script or one-off check that every backticked `packages/...` path in the four documents exists.
- `bash packages/workbench/scripts/pack-smoke.sh` still passes with the README snippet.

## Notes
- Match each document's existing structure and voice. Markdown is excluded from `oxfmt`.
