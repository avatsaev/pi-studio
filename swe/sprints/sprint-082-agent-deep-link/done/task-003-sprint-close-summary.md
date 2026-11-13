# Task 003 — Sprint close — Summary

- **Sprint:** sprints/sprint-082-agent-deep-link
- **Completed:** 2026-11-13
- **Status:** done

## What was implemented
Live browser verification (headless Chromium, `dev-main.js` mock-provider daemon on 127.0.0.1:46821, Vite on 46822, three agents), docs, and spec close-out (status shipped, TODOs resolved as decisions, MAIN-SCOPE row marked shipped).

## Files changed
`packages/web-client/AGENTS.md` (deep-link invariant + layout line), `AGENTS.md` (web-client line), `fern/pages/web-ui.mdx` (new "Linking to an agent"), `swe/features/web-ui-agent-deep-link.md`, `swe/MAIN-SCOPE.md`.

## Live observations
- `?host=…&connect=1#agent=<older>` selected that "first one" chat (not the most recent), in the focused pane; `#agent=<newer>` selected "second one". No duplicate tabs (3 tabs, 3 sessions). Screenshots taken.
- Bare `#agent=<id>` did not connect (status stayed disconnected until Connect was pressed; default host :6767 has no daemon there, so manual-connect-then-select was NOT observed live — covered by unit tests).
- `#agent=nope` on a connected page via hashchange: toast "Agent not found: nope" shown; URL left without `#`. On first-load `#agent=nope&connect=1` the URL was cleaned and connected.
- hashchange to `#agent=<id>` on a connected restored page selected it without reload; URL cleaned.
- Reload after apply: URL had no `agent`, nothing re-applied.
- Not run: `#offer=…&agent=…` and relay pairing (no relay locally); cleanup of `offer=` fragment is covered by `stripAgentParam` unit tests.

## Build & test results
```
$ npm run build        # success
$ npm run typecheck    # success
$ npm run lint         # 0 errors; pre-existing warnings in untouched files
$ npm run fmt:check    # 43 pre-existing files flagged (identical on baseline); none of this sprint's files
$ npm test             # 246 files, 3304 passed
```

## Acceptance criteria
- [x] Spec criteria checked via tests (agent-deep-link.test.ts, apply-agent-deep-link.test.ts, pairing.test.ts) and live observations above
- [x] `git diff --stat` touches nothing under packages/server or packages/protocol
- [x] Gates green (fmt:check pre-existing noise only)

## Follow-ups / TODO(verify)
- TODO(verify): relay pairing + `agent` live; manual Connect then select live.
