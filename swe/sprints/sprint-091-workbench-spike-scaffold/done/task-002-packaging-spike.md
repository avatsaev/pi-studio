# Task 002 — Packaging spike: settle the library-build unknowns

- **Sprint:** sprint-091-workbench-spike-scaffold
- **Status:** done
- **Type:** test
- **Area:** packages/workbench (throwaway)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
Answer the workbench spec's packaging `TODO(verify)` items with a throwaway build, before any application code moves.

## Context / why
The application has build features `ui-library` never needed: a third-party stylesheet import, about twenty lazy imports, large fonts, a worker. Vite's library mode treats some of these differently from an application build. Finding out after 200 files have moved would be expensive.

## Scope references
- `swe/architecture/workbench-package.md` § Build, § TODO(verify)
- `packages/ui-library/vite.config.ts` (the config pattern to copy)
- `packages/ui-library/scripts/pack-smoke.sh` (consumer check precedent)
- `packages/web-client/src/timeline/markdown.tsx` (katex stylesheet import, lazy mermaid)
- `packages/web-client/src/features/connection/ConnectionBar.tsx` (lazy `SettingsDialog`)

## What to build
- In a scratch directory outside the repository, build a minimal Vite library using the `ui-library` config pattern (ES format, every dependency external, `cssCodeSplit: false`). It must contain: one CSS Module; `import "katex/dist/katex.min.css"`; a `lazy(() => import("./Local"))`; a dynamic `import("mermaid")` with mermaid external; a CSS `@font-face` pointing at a real woff2 file; an entry that re-exports a lazily loaded component.
- Install the packed tarball into a scratch Vite + React + TypeScript consumer and run its dev server and a production build.
- Record an observed answer, with the command and the relevant output, for each question: (1) is the katex stylesheet inlined into `styles.css`, and are its fonts inlined as base64; (2) is the woff2 inlined, and does copying font files verbatim next to a hand-written `fonts.css` work; (3) are local lazy imports emitted as separate chunks and does the external dynamic import stay `import("mermaid")`; (4) does the consumer need any `optimizeDeps` setting; (5) can a lazily loaded component be exported from the entry without its chunk being merged into the entry; (6) is `process.env.NODE_ENV` left unreplaced.
- Decide the form of the packed-tarball smoke check. Known constraint: the repository has no browser-automation dependency (no playwright, no puppeteer).
- Write `swe/notes/workbench-packaging-spike.md` with findings and the chosen approach per question. Resolve the matching `TODO(verify)` entries in the spec, and amend the notes of sprint 094 tasks if a finding changes them.
- Keep `docs/desktop-client-handoff.md` current: update whatever this task makes stale there (status table, workbench and host sections, wire facts, milestones, open questions). Say in the summary what changed in it, or that nothing did.

## Out of scope
- Any change under `packages/`.
- The pdf.js worker: the spec already routes it through the host.

## Acceptance criteria
- [ ] Each of the six questions has an observed answer backed by command output in the note.
- [ ] The smoke-check form is decided and recorded.
- [ ] The spec's packaging `TODO(verify)` items are resolved or rewritten with what remains open.
- [ ] The scratch directories are removed.
- [ ] `docs/desktop-client-handoff.md` matches the repository after this task, or the summary states that nothing in it was affected.

## Test / verification plan
- The note's commands can be re-run from a clean scratch directory and give the recorded results.

## Notes
- If the katex stylesheet is inlined with fonts, the two candidate fixes are: keep that import external, or drop it from the library and document that the consumer imports it.
