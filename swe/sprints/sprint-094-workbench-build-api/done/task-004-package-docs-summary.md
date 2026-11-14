# Task 004 — Workbench package documentation; slim `web-client`'s — Summary

- **Sprint:** sprints/sprint-094-workbench-build-api
- **Completed:** 2026-11-14
- **Status:** done

## What was implemented
`packages/workbench/README.md` (written with the smoke markers in task-003, completed here): what the package is and its limits (Vite, React 19, one instance per document), quickstart (`vite.config.ts` + `main.tsx`, the snippets pack-smoke extracts verbatim), stylesheet order and `fonts.css`, the katex decision, a custom shell, the full public-API table, the host contract member by member (synchronous storage and transport ordering called out), PDF viewing (`./vite` plugin + worker, same `pdfjs-dist` range). `packages/workbench/CHANGELOG.md`: initial entry. `packages/workbench/AGENTS.md`: existing package sections plus "Application reference" — web-client's application source layout (≈670 lines) and all application invariants (≈1960 lines) moved here verbatim, with a preamble stating paths are relative to `src/` and how pre-move names map; stale paths fixed (`lib/clipboard.ts` → `host/browser-clipboard.ts`, `WorkspacePage.tsx` → `shell/WorkspaceShell.tsx`, ui-library `Menu.tsx`, token test). `packages/web-client/AGENTS.md` rewritten for the shell (2839 → 115 lines): dependency graph, packaging, source layout, commands (unchanged), shell invariants including the build-time brand override (moved verbatim). `packages/web-client/README.md` intro and development section reframed as the shell.

## Files created / changed
| File | Change |
|------|--------|
| `packages/workbench/README.md` | completed |
| `packages/workbench/CHANGELOG.md` | created |
| `packages/workbench/AGENTS.md` | application reference moved in; head updated |
| `packages/web-client/AGENTS.md` | rewritten for the shell |
| `packages/web-client/README.md` | shell framing |

## How it satisfies the scope
`workbench-package.md` (documentation deliverables) and `workbench-host-adapter.md` § Acceptance "host contract documented in the README" (now satisfied).

Path check: every backticked path with a directory component in the four documents resolves (bases: repo root, the package, its `src`, plus `packages/ui-library/src`, `swe/architecture`, `swe/features` for cross-references); bare file names resolve to a file in the repository. The only unresolved names are not repository files: `MolViewer.tsx` (inside `@molviewer/core`), Pi's `auth.json`/`models.json`, and the `dist` outputs `index.d.ts`/`styles.css`.

Out of scope here and left for sprint 095 task-002 (as planned): root `AGENTS.md` (8 references to web-client's AGENTS sections), `packages/server/AGENTS.md` (4) and `docs/desktop-client-handoff.md` (1) still point at sections that now live in the workbench AGENTS.

## Build & test results
```
$ bash packages/workbench/scripts/pack-smoke.sh   (README snippets extracted verbatim)
... ALL PASS
$ path check (one-off script over the 4 documents) -> only the external/dist names listed above
```

## Acceptance criteria
- [x] The README quickstart is the snippet pack-smoke uses, verbatim (extracted by marker).
- [x] Every public export is documented in the README table; nothing private is listed as API.
- [x] No path in either AGENTS file points at a missing repository file (external/dist names noted).
- [x] web-client's AGENTS no longer describes code that left the package.
- [x] `docs/desktop-client-handoff.md`: one stale pointer to web-client's AGENTS remains, scheduled for the sprint 095 task-002 rewrite; nothing else in it changed.

## Follow-ups / TODO(verify)
- Root/server AGENTS cross-references to moved sections: sprint 095 task-002.
