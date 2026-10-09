# Task 006 — Web-client: context meter bar, post-compaction estimate, percent-scale fix — Summary

- **Sprint:** sprints/sprint-074-context-compaction
- **Completed:** 2026-10-09
- **Status:** done

## What was implemented
`formatPercent` now reads Pi's 0–100 scale (`<1%` below one percent); `stats-store` documents the scale and gains `contextEstimated`. `applySessionStats` clears the flag when real tokens arrive; `applyAgentStreamEvent` seeds the estimate from a live `compaction` `completed` event. Pure `context-meter.ts` (`meterState`/`meterTone`/`meterText`/`meterTitle`/`meterFill`/`meterValueNow`), `useIsCompacting`, and `ContextMeter.tsx` (+ CSS, reduced-motion handling) replace the context segment text in `StatusBar`.

## Files created / changed
| File | Change |
|------|--------|
| `features/workspace/context-meter.ts` (+ test), `ContextMeter.tsx`, `ContextMeter.module.css` | new |
| `features/workspace/StatusBar.tsx`, `status-bar-format.ts` (+ test) | meter segment; scale fix |
| `stores/stats-store.ts` | scale doc, `contextEstimated` |
| `hooks/use-session-stats.ts` (+ test), `hooks/agent-stream-events.ts` (+ new test), `hooks/use-is-compacting.ts` | estimate flow |
| `packages/web-client/AGENTS.md` | layout + scale/meter/estimate invariants |

## Build & test results
```
$ npx vitest run packages/web-client -> 101 files, 1335 passed
$ tsc -b packages/web-client; npm run build:web-client -> success
$ oxlint/oxfmt on changed files -> clean
```

## Acceptance criteria
- [x] `formatPercent(0.7)` → `<1%`, `42.6` → `43%`, `100` → `100%`
- [x] `meterState` / `meterTone` boundaries (0.6999 / 0.70 / 0.8999 / 0.90) covered
- [x] Live `completed` → `~N%`; null poll keeps it; non-null poll clears `~` (unit tests; browser: `~7%`, tooltip `≈ 14.0k / 200.0k tokens (estimate)`, then a real value showed `10%`). Replay never reaches the stats path by construction (`applyAgentStreamEvent` is live-only).
- [x] Browser vs dev daemon + Vite: bar beside Gauge icon; `Compacting…` with sweep animation during a mock compaction; with `prefers-reduced-motion: reduce` emulated, `animation-name` was `none`; other segments unchanged.

## Follow-ups / TODO(verify)
- The mock provider returns no `contextUsage`, so the browser check seeded `stats-store` through the dev server's module graph for the pre-compaction value; the compaction events themselves were real daemon traffic.
