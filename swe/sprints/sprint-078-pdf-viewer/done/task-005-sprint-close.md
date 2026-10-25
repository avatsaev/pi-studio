# Task 005 — Sprint close: live E2E, docs, gates

- **Sprint:** sprint-078-pdf-viewer
- **Status:** done
- **Type:** docs
- **Area:** packages/web-client, swe/
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001…task-004

## Goal

Prove the feature end to end in a real browser against a real daemon, in dev and in the built
bundle served by the CLI's static server. Then bring the docs in line and pass every gate.

## Scope references

- `swe/features/pdf-file-preview.md` § Acceptance criteria (all), § TODO(verify)
- `packages/web-client/AGENTS.md`: tech-stack line, `features/files` source-layout entry, `viewer-plugins/`
  and `settings/` entries, § Invariants "Viewer-disable gate", "Adding a file viewer"
- Root `AGENTS.md` tech-stack table (new web-client library, like `@molviewer/core`'s row)
- `swe/sprints/PLAN.md` (status note, coverage row)

## What to build

- Live E2E (dev daemon + Vite, browser): every spec acceptance criterion, in order.
- Built bundle: `npm run build:web-client`, serve `dist/web` via `pi-studio ui` (or
  `startWebServer`), and confirm a PDF needing cmaps/standard fonts renders with no 404s or
  HTML-for-asset responses in the network log.
- Docs: the AGENTS.md updates listed above. The "Viewer-disable gate" invariant gains the
  file-kind variant (descriptor `toggle`, resolved once per `FilePanel` mount). "Adding a file
  viewer" documents `toggle`.
- Resolve both spec TODO(verify) items with evidence (or record the Electron one as still open,
  with why).

## Acceptance criteria

- [x] Every spec acceptance criterion observed in a browser, recorded in the summary.
- [x] `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run fmt:check` all pass.
- [x] Docs truthful against the code; PLAN.md marks the sprint done.

## Test / verification plan

- The full gates above, plus the browser session (screenshots/notes in the summary).
