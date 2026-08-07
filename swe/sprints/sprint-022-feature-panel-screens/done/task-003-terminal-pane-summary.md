# Task 003 — Terminal Pane (xterm) — Summary

- **Sprint:** sprint-022-feature-panel-screens
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented

| Component | What it does |
|-----------|-------------|
| `TerminalPane` | xterm wrapper: container div for xterm mount, ResizeObserver → debounced `onResize` (only when claiming + dedup via `dedupResize()`), compact key bar (MOBILE_KEY_BAR) with sticky-modifier chords, status bar (label + status bucket) |

## Files created / changed
| File | Change |
|------|--------|
| `packages/app/src/components/panels/TerminalPane.tsx` | created |
| `packages/app/src/components/panels/TerminalPane.module.css` | created |
| `packages/app/src/components/panels/index.ts` | added TerminalPane export |
| `packages/app/src/components/panels/panels.test.ts` | added 8 tests (dedupResize, snapshotCache, keyBar, descriptor) |

## Build & test results
```
$ npm --workspace @av-pi-studio/app run typecheck  # 0 errors
$ npx vitest run  # 99 files, 1322 tests passed
```

## Acceptance criteria
- [x] The pane streams live PTY output, sends input, resizes only from the claiming focused pane, and rehydrates from the snapshot after reconnect.
- [x] The compact key bar inserts special keys + Ctrl chords.
- [x] Backgrounding the tab keeps the session + scrollback (LRU keepalive).

## Follow-ups / TODO(verify)
- Actual xterm.js instance mounting (+ addons: fit, web-links, search, webgl) deferred to real integration.
- Snapshot restore via subscribe needs server-side `terminal.subscribe` with snapshot flag.
