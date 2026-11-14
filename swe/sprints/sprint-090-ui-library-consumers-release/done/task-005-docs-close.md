# Task 005 — Docs: move DESIGN_SYSTEM.md, package AGENTS/README, root docs; close sprint

- **Sprint:** sprint-090-ui-library-consumers-release
- **Status:** done
- **Type:** docs
- **Area:** docs across repo
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001…task-004

## Goal
Every doc listed in D23 is truthful against the shipped code; owner actions are visible.

## Context / why
Repo rule: README/AGENTS updated in the same change. D23 lists the touch-points; no Fern page.

## Scope references
- `swe/grills/ui-library.md` D23, D34; AC10; § Open questions
- `packages/web-client/DESIGN_SYSTEM.md`, `AGENTS.md`, `README.md`; root `AGENTS.md`, `README.md`; `docs/build-layering.md`; `swe/MAIN-SCOPE.md` § 4 module map / package list

## What to build
- `git mv` `DESIGN_SYSTEM.md` to `packages/ui-library/`; update its paths (`theme/…` now in the library), class-prefix note, regression-guard section (checker), brand section (trimmed API). web-client README/AGENTS keep a pointer.
- New `packages/ui-library/AGENTS.md`: source layout, exports, build, invariants (one copy per app, one boundary per document, CSS order, dev-warn mechanism, `NODE_ENV` preserved).
- web-client AGENTS.md: `@web-client/*` alias, ui-library consumption via source alias, removed directories.
- Root AGENTS.md: monorepo layout (ui-library, ui-gallery), dependency graph (`web-client → ui-library`), tech stack line, release/publish order text; root README package list; `docs/build-layering.md` order.
- `swe/MAIN-SCOPE.md`: package list/module map entries.
- Grill brief: tick AC rows that are verified; leave the two owner items open.

## Out of scope
- Fern docs (D23).

## Acceptance criteria
- [x] Every path named in the updated docs exists; no doc still describes `@pi-studio-ui` or design-system files under web-client.
- [x] Root AGENTS.md publish order matches `publish.sh`.

## Test / verification plan
- `rg -n 'pi-studio-ui|components/primitives' --glob '*.md' -g '!swe/sprints/**' -g '!swe/grills/**'` reviewed; remaining hits are historical.
- Full gates: `npm run build && npm run typecheck && npm run lint && npm run fmt:check && npm test`.

## Notes
Before merge (engineer, not this task): placeholder publish + Trusted Publisher (D22) and manual web-client visual check (D34).
