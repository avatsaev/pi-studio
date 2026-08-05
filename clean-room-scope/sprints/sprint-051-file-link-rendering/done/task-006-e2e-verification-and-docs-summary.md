# Task 006 — E2E verification + docs sync — Summary

- **Sprint:** sprint-051-file-link-rendering
- **Completed:** 2026-08-05
- **Status:** done

## What was implemented
Closing verification pass for the sprint: confirmed every acceptance-criteria checkbox across
tasks 001–005 is covered by an automated test, ran the full project gate suite once from the repo
root, and confirmed the `AGENTS.md` doc sync (protocol capability row, web-client source-layout +
"File link rendering" section, server `composeSystemPrompt`/`file-link-instructions.ts` description)
is accurate against the code as it landed. No new source logic — verification and documentation
only, per the task's own scope.

## Files changed
| File | Change |
|------|--------|
| `packages/protocol/AGENTS.md` | `CLIENT_CAPS` row lists `file_link_markdown` |
| `packages/web-client/AGENTS.md` | source-layout tree entries for `file-link-src.ts`, `href-resolution.ts`, `file-open-target.ts`, `FileLink.tsx`; new "File link rendering" section (classification split, `a` override, converged dispatch, pane-owner propagation, drag wiring, capability gate) |
| `packages/server/AGENTS.md` | `agent-service.ts` description updated to `composeSystemPrompt`/`CAPABILITY_INSTRUCTIONS`, mentions `file-link-instructions.ts` alongside `inline-image-instructions.ts`; no remaining reference to the retired single-flag ternary |

## Acceptance-criteria sweep (`file-link-rendering.md` § Acceptance Criteria)
| Criterion | Task | Automated test |
|---|---|---|
| Two-way classification table (empty, fragment-only, path+fragment, schemes, absolute, tilde, relative) | 001 | `file-link-src.test.ts` (47 cases) |
| Normalization + percent-decoding of local results | 001 | `file-link-src.test.ts`, `paths.test.ts` (`collapseDotSegments`) |
| `classifyImageSrc` local results now normalized/decoded, other behavior unchanged | 001 | `image-src.test.ts`, `markdown.test.ts` |
| `owningPaneId`/`workspaceCwd` threaded panel host → `Markdown` without re-derivation | 002 | typecheck (compile-time chain) + `pane-layout-view.test.ts` (`resolveOwningPaneId`) |
| Existing chat rendering / tab focus / inline-image rendering unchanged by the prop-threading | 002 | full focused suite green, no click handler reads the new props at that point |
| `a` override renders actionable local links, unmodified external/anchor links | 003 | `markdown.test.ts` ("converged click-to-open dispatch") |
| Click dispatches `openFileTab` with normalized path + owning tab's `workspaceCwd`/`owningPaneId`, reusing an existing tab | 003 | `file-open-target.test.ts`, `markdown.test.ts`; live E2E (see task-003 summary) |
| `InlineImage` click-to-open converged onto the same dispatch (regression) | 003 | `markdown.test.ts` ("InlineImage regression") |
| Unplaced tab (`owningPaneId === null`) falls back without throwing | 003 | `file-open-target.test.ts` |
| `file_link_markdown` capability registered + advertised; composes correctly with `inline_image_markdown` in stable order | 005 | `create-run.test.ts`, `daemon/bootstrap.test.ts` |
| CLI-created sessions (no capabilities) unaffected | 005 | `create-run.test.ts` (pre-existing "no capability" case, unchanged) |
| Drag source carries `EXTERNAL_DRAG_MIME.path`, identical to a Files-tree row; external/remote never draggable | 004 | `external-drag.test.ts` (`pathDragStartHandler`) |
| Drop-side (edge split / center / already-open reuse) unchanged | 004 | `use-external-pane-drop.test.ts` (pre-existing, untouched, still green) |

No gaps found — every criterion traces to a passing automated test.

## Build & test results (full gate suite, repo root)
```
$ npm run build
tsc -b (all packages) + vite build (web-client) + cli chmod — success, all packages built

$ npm run typecheck
tsc -b — success, zero errors

$ npm run lint
oxlint — exit 0 (pre-existing repo-wide warning baseline only; zero new warnings on any file
  this sprint touched)

$ npm test
Test Files  137 passed (137)
     Tests  1520 passed (1520)
```

## Known Limitations re-confirmed
- **Directory-target link/drag**: no existence/type pre-check before click or drag — a directory
  link stays actionable and draggable; a click opens `FilePanel`'s non-file state, a drop fills the
  new split with it. Accepted per the spec and task-004's own scope note; unchanged by this sprint.
- **Spawn-time instruction-binding asymmetry**: both `inline_image_markdown` and `file_link_markdown`
  instructions bind only at agent-spawn time from the creating client's advertised capabilities — a
  CLI-created session opened later in a capable web client does not retroactively gain either
  instruction. Documented identically in `inline-image-instructions.ts` and
  `file-link-instructions.ts`'s header comments; verified by `create-run.test.ts`'s CLI-session case.
- **No existence pre-check before click or drag** in general (not just directories) — a link to a
  file that no longer exists still opens a tab; `FilePanel`'s own not-found handling takes over from
  there, unchanged by this sprint.

## Acceptance criteria
- [x] Every checkbox in `file-link-rendering.md` § Acceptance Criteria confirmed satisfied, with the
      specific automated test identified (table above).
- [x] `packages/protocol/AGENTS.md`'s `CLIENT_CAPS` row lists `file_link_markdown`.
- [x] `packages/web-client/AGENTS.md` documents `file-link-src.ts`, `href-resolution.ts`,
      `FileLink.tsx`, the `a` override, the `owningPaneId`/`workspaceCwd` propagation, drag wiring,
      and the capability advertisement line.
- [x] `packages/server/AGENTS.md` documents `composeSystemPrompt`/`CAPABILITY_INSTRUCTIONS` and
      `file-link-instructions.ts`, with no remaining reference to the retired single-flag ternary.
- [x] `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` all succeed from the repo root.
- [x] Each § Known Limitations item re-confirmed accurate (above).

## Follow-ups / TODO(verify)
- Live drag-to-split manual pass (dragging a rendered `FileLink`/`InlineImage` onto a pane edge/
  center/already-open tab) was verified at the unit level (drag-start payload) and via the
  pre-existing, unmodified drop-side suite; a live end-to-end drag gesture through the browser
  was not additionally re-driven here since native HTML5 DnD is not reliably simulable headlessly
  and the identical drop mechanism was already live-verified for the Files-tree source in
  sprint-049. Click-to-open (the higher-risk, newly-converged path) *was* live-verified end-to-end
  in task-003's manual pass against a running dev daemon + web-client.
