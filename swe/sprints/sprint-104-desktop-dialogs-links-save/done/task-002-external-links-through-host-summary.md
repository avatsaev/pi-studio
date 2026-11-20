# Task 002 — External links through host — Summary
- **Sprint:** sprints/sprint-104-desktop-dialogs-links-save
- **Completed:** 2026-11-20
- **Status:** done

## What was implemented
`FileLink`'s `external` branch is now split. A URL with a scheme renders through `ExternalAnchor`. `ExternalAnchor` already set `target="_blank"` and `rel="noreferrer"` and already called `routeExternalLinkClick`, so `external-link.tsx` needed no change. An empty or fragment-only href keeps the plain `<a href>`. Local file links are untouched.

A new pure function, `classifyExternalHref(href)`, returns `"in-page"` for an empty, whitespace or `#…` href and `"url"` for anything else.

## Files created / changed
| File | Change |
|---|---|
| `packages/workbench/src/timeline/external-href.ts` | new: `classifyExternalHref` |
| `packages/workbench/src/timeline/external-href.test.ts` | new: https, mailto and file URLs are `url`; empty, whitespace, `#` and `#usage` are `in-page` |
| `packages/workbench/src/timeline/FileLink.tsx` | `external` branch uses the split; header comment updated |

## How it satisfies the scope
- No deviations.
- The "calls `openExternal` once and prevents default" criterion is covered by the existing `routeExternalLinkClick` tests, which I did not change. There is no DOM test environment, so I did not add a rendering test for it.

## Build & test results
```
$ npx vitest run packages/workbench/src/timeline packages/workbench/src/host
Test Files  23 passed (23)   Tests  267 passed (267)
$ npm run build:workbench
check-dist: ok
$ npx oxfmt <changed files>
Finished in 81ms on 3 files
$ npm run lint
warnings only, e.g. packages/client/src/daemon-client.ts (no-underscore-dangle); I did not touch that file
```

## Acceptance criteria
- [x] The classifier treats `https://example.com`, `mailto:a@b.c` and `file:///x` as URLs, and ``, `#`, `#usage` as in-page (verified by the unit test).
- [x] A web link with a host that has `openExternal` calls it and prevents the default action (by the existing `routeExternalLinkClick` tests plus code reading).
- [x] A web link with no host `openExternal` gets `target="_blank"` and `rel="noreferrer"` (by code reading: `ExternalAnchor` sets both).
- [x] A `#section` link is not passed to the host and gets no `target` (by code reading: it takes the plain anchor branch).
- [ ] Browser check of a web link opening a new tab: not run. The orchestrator does live checks.
- [x] Existing Markdown and file-link tests pass (the 267 tests above).

## Follow-ups / TODO(verify)
- Browser check with a mock agent: a message with `[site](https://example.com)` and a `#fragment` link.

## Proposed doc edits for the orchestrator
For `packages/workbench/AGENTS.md`, in the file-link rendering section: "`FileLink`'s `external` classification is split by `timeline/external-href.ts` (`classifyExternalHref`): in-page (empty or `#…`) renders a plain anchor, anything with a scheme renders through `ExternalAnchor` (host `links.openExternal`, else `target=_blank rel=noreferrer`). Local links are unchanged." Also add `external-href.ts` to the source layout tree under `timeline/`.

## Wave gate (orchestrator)
```
Wave gate: npm run build OK; npm run typecheck OK; npm run lint OK (exit 0); npm test 276 files / 3913 tests passed. Workbench doc edits applied by the orchestrator (AGENTS.md host section + file-link render layer, README host table).
```
