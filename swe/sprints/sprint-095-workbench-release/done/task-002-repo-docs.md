# Task 002 — Repository-level documentation

- **Sprint:** sprint-095-workbench-release
- **Status:** done
- **Type:** docs
- **Area:** root docs, docs/, swe/, docker/, fern/
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
Make every repository-level document describe the repository as it now is.

## Context / why
The package set, the dependency graph and the release order changed. Root `AGENTS.md` is the first thing an agent reads; `docs/desktop-client-handoff.md` is the first thing the desktop agent reads.

## Scope references
- Repository rule: docs sync on code changes
- Root `AGENTS.md` (§ Monorepo layout, § Dependency graph, § Tech stack, § Release & production deployment, § Package AGENTS.md index), root `README.md`
- `docs/build-layering.md`
- `docs/desktop-client-handoff.md`
- `swe/MAIN-SCOPE.md` (§ 3 components, § 4 directory map, § Tech stack build row, § 8 index statuses, § 10)
- `docker/README.md`
- `fern/` pages that mirror the README

## What to build
- Root `AGENTS.md` and `README.md`: add the workbench to the layout, the dependency graph, the release order and the package index; describe `web-client` as the browser shell.
- `docs/build-layering.md`: the new build order and the source-alias arrangement for `ui-library` and the workbench.
- `docs/desktop-client-handoff.md`: rewrite the status table and "The workbench" section from "planned" to the real API (exports, host members, quickstart, constraints found during implementation); update the milestones if the real API changes them; re-check every statement marked as verified against the code.
- `swe/MAIN-SCOPE.md`: mark the two workbench specs shipped with their sprint numbers; update the component list, directory map and build row; tick resolved § 10 items.
- `docker/README.md` and `fern/` only where they state something that changed.
- Keep `docs/desktop-client-handoff.md` current: update whatever this task makes stale there (status table, workbench and host sections, wire facts, milestones, open questions). Say in the summary what changed in it, or that nothing did.

## Out of scope
- Package-level documents (sprint 094 task-004).

## Acceptance criteria
- [ ] No repository-level document describes `web-client` as containing the features, or lists a release order without the workbench.
- [ ] `docs/desktop-client-handoff.md` contains no "planned" or "not built" statement about the workbench.
- [ ] Every path those documents name exists.
- [ ] `fern check` passes if a `fern/` page changed.
- [ ] `docs/desktop-client-handoff.md` matches the repository after this task, or the summary states that nothing in it was affected.

## Test / verification plan
- Path-existence check over the changed documents.
- `rg -n "planned|not built|Scoped, not built" docs/desktop-client-handoff.md` shows only statements about work that is still not built (the protocol follow-ups).
