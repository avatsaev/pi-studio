# Task 005 — Workspace header live fields & bundle code-splitting — Summary

- **Sprint:** sprint-030-integration-gap-closure
- **Completed:** 2026-11-07 (closed partial; implementation work itself landed earlier)
- **Status:** done (partial)

## What was implemented
- **Bundle code-splitting** — `packages/app/vite.config.ts` `manualChunks` for vendor libraries;
  Terminal/Browser/FilePreview/Git panes made `React.lazy` under the existing `<Suspense>` fallbacks.
  Main entry chunk 705 kB → ~200 kB; the >500 kB build warning is gone.
- **Real `isElectron`** — the workspace header reads `getIsElectron()` instead of a hardcoded `false`.
- Recorded result at the time: `npx vitest run packages/app` — 75 files / 1286 tests passing.

## What was NOT delivered
- Acceptance criterion **"Header shows real scripts count / setup availability"**. `scriptsCount: 0`
  and `setupAvailable: false` stayed hardcoded: no client-facing source for per-workspace scripts/setup
  data existed, and building it was sprint-031 task-003 (never built; sprint-031 has since been removed).

## Why it is closed rather than resumed
- The sprint-031 dependency was never scheduled (the sprint was later removed), and `packages/app` (incl. `LiveWorkspacePage.tsx`)
  no longer exists — `packages/web-client` is the production UI. A grep of `packages/*/src` finds no
  `scriptsCount`, `setupAvailable`, or scripts-listing RPC.
- Any future header-field work should be planned as a new task against `web-client`/`server`/`protocol`
  (together with the scripts/setup surface), not by reviving this one.

## Verification
No build or tests were run at close time; the figures above are the ones recorded in the task file's
progress section, and the stale-code observations come from a repo grep on 2026-11-07.
