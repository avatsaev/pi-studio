# Task 004 — Docs sync + pre-ship verification

- **Sprint:** sprint-063-html-file-preview
- **Status:** done
- **Type:** docs + test
- **Area:** web-client / docs
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002, task-003

## Goal
Make the living docs describe the shipped registry contract and the HTML preview's security model,
and run the sprint's full gates plus a browser pass before the sprint closes.

## Context / why
Two docs contradict the code the moment task-001 lands: `packages/web-client/AGENTS.md`'s source
layout describes the old four-table registry and the `LIVE_REFRESH_KINDS` literal, and
`swe/features/feature-panels-ui.md`'s file-preview section predates both the molecule viewer and this
one. The security model is also exactly the kind of thing a future change quietly breaks ("just add
`allow-same-origin` so the stylesheet loads"), so the invariants must be written down where a coding
agent reads them, not only in a task file that moves to `done/`.

## Scope references
- `swe/features/html-file-preview.md` (the spec this sprint implements; mark implemented parts and
  correct anything the implementation contradicted)
- `packages/web-client/AGENTS.md` § Source layout, § Invariants
- `swe/features/feature-panels-ui.md` § file preview
- `swe/sprints/PLAN.md` (sprint status if anything diverged from the plan)

## What to build
- `packages/web-client/AGENTS.md`:
  - source-layout entries for `html-sandbox.ts`, `HtmlViewer.tsx`, `hooks/use-file-source.ts`, and a
    rewritten `viewer-registry.ts` line describing the descriptor table + derived lookups;
  - update the `use-file-live-refresh` entry (the kinds gate now comes from the descriptor);
  - a new **"HTML preview sandbox"** invariant recording, with reasons: never `allow-same-origin`
    (and why, given `localStorage` holds the daemon password); no object URLs inside the sandbox
    (measured — opaque origin cannot fetch a parent `blob:`); `srcdoc`'s base URL is the app's, hence
    the injected `.invalid` base; the meta CSP is a *network* policy and remote loading is allowed by
    default with an explicit per-tab block toggle;
  - a new **"Adding a file viewer"** invariant: one `VIEWER_REGISTRY` entry, `liveRefresh` explicit,
    and the standing rule that a *new tab kind* (molecule-style) needs justification — the registry
    is the default path.
- `swe/features/feature-panels-ui.md`: file-preview section updated to the real viewer set
  (text/markdown/image/video/binary/html + the separate molecule tab) and the registry contract.
- `swe/features/html-file-preview.md`: fold in any implementation-time deviation; resolve the two
  `TODO(verify)` items that this sprint can answer (the blocking-CSP `script-src data:` question is
  sprint-064's, unless already settled while implementing).

## Out of scope
- Any code change beyond comment/doc corrections uncovered while writing (if a real defect surfaces,
  record it and fix it in its owning task, not here).
- Root `AGENTS.md` (no cross-package, protocol, or docker surface changed in this sprint).

## Acceptance criteria
- [x] No doc in the repo still describes the four-table registry or a hand-maintained
      `LIVE_REFRESH_KINDS`.
- [x] `packages/web-client/AGENTS.md` carries the two new invariants, with the measured browser facts
      stated as facts (not guesses).
- [x] Full gates from a clean tree: `npm run clean && npm run build`, `npm run typecheck`,
      `npm test`, `npm run lint`, `npx oxfmt --check <changed files>` — all green.
- [x] Browser pass recorded in the summary: `.html` preview across at least three theme variants
      (including `light`), a split pane with a preview and a chat side by side, a `.md` preview with
      a relative image, a `.png`/`.mp4`/`.zip` sanity check (no viewer regressed), and the sandbox
      probe (`parent.document`/`localStorage` blocked).
- [x] `swe/sprints/PLAN.md` reflects the shipped sprint if anything diverged from the plan.

## Test / verification plan
- `npm run clean && npm run build && npm run typecheck && npm test && npm run lint`.
- `npx oxfmt --check` on changed files only — never a project-wide reformat; record any pre-existing
  unrelated failures in the summary instead of reformatting them.
- Manual browser matrix as listed in the acceptance criteria, each observation written into
  `task-004-docs-and-verification-summary.md`.

## Notes
Per project convention this package has no jsdom/component-test infrastructure: React components are
verified in a real browser and only pure logic is unit-tested. Do not add a component test runner to
"prove" the viewer.
