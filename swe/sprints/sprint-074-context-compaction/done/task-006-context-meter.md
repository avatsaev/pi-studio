# Task 006 — Web-client: context meter bar, post-compaction estimate, percent-scale fix

- **Sprint:** sprint-074-context-compaction
- **Status:** done
- **Type:** feature
- **Area:** packages/web-client (features/workspace, stores, hooks)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-005

## Goal

The status bar's context segment becomes a loading-bar meter (`◔ ▰▰▰▱▱ 42%`) with threshold colors
and unknown/estimated/compacting states. It shows a correct value after a compaction and below 1%.

## Context / why

Three defects meet in this segment:
- **G5:** after a compaction Pi reports `tokens: null, percent: null` until the next LLM reply, and
  `applySessionStats` skips nulls, so the old pre-compaction value stays on screen indefinitely.
- **G9:** Pi's `percent` is **0–100** (`(tokens / contextWindow) * 100`), but `stats-store.ts:15`
  calls it a 0–1 fraction and `formatPercent` guesses (`p <= 1 ? p * 100 : p`). A session at 0.7%
  displays `70%`. `formatPercent`'s only caller is `StatusBar.tsx:83`, and its test pins the wrong
  guess (`status-bar-format.test.ts:37-41`), as does the `use-session-stats.test.ts:44-52` fixture.
- The text format the user wants replaced.

## Scope references

- `swe/features/context-compaction.md` § Public contract › Web-client (Stats estimate, Percent
  scale, ContextMeter), § UI specification › Context meter, § Behavior & algorithms (`meterState`)
- `packages/web-client/src/features/workspace/StatusBar.tsx:82-84` (context segment), `:100-111`
  (segment markup); `StatusBar.module.css`
- `packages/web-client/src/features/workspace/status-bar-format.ts:20-25` + its test
- `packages/web-client/src/stores/stats-store.ts:12-23`
- `packages/web-client/src/hooks/use-session-stats.ts:49-68` (`applySessionStats`) + test
- `packages/web-client/src/hooks/agent-stream-events.ts:29-56` — the live-only side-effect switch
- `packages/web-client/src/timeline/compaction.ts` (`isCompactionPending`, task-005)
- Tokens: `--pi-color-accent`, `--pi-color-statusWarning`, `--pi-color-statusDanger`,
  `--pi-color-surface3`, `--pi-color-foregroundMuted`

## What to build

- **Percent scale.** Correct the `stats-store` doc comment to 0–100. `formatPercent` always treats
  input as 0–100 and renders `<1%` for `0 < p < 1`. Rewrite the two tests that pinned the 0–1
  guess, and fix the `use-session-stats` fixture to Pi's real scale.
- **Estimate.** `SessionStats.contextEstimated?: boolean`. In `applyAgentStreamEvent`'s live switch,
  a `compaction` `completed` event with `estimatedTokensAfter` sets `contextTokens`,
  `contextPercent` (`/ window * 100` when `contextWindow` is known) and `contextEstimated: true` for
  that session. `applySessionStats` writes `contextEstimated: false` whenever it writes non-null
  tokens. Replayed history never touches stats.
- **Pure meter state** `features/workspace/context-meter.ts`: `meterState(stats, compacting)` →
  `{kind:"compacting"} | {kind:"unknown"} | {kind:"value", fraction, estimated}`, with fraction =
  `tokens/window` when both are known, else `percent/100`. Also `meterTone(fraction)` →
  `"normal" | "warning" | "danger"` at the 0.70 / 0.90 boundaries, and `meterText(state)` (`42%`,
  `~7%`, `—`, `Compacting…`) and `meterTitle(stats, state)` (`84.1k / 200k tokens`,
  `≈ 14.2k / 200k tokens (estimate)`).
- **`useIsCompacting(sessionId)`** hook: `isCompactionPending` over the session's timeline rows.
  Task-007 extends it with the local pending flag.
- **`ContextMeter.tsx`** + CSS module: Gauge icon, an 80 × 6 px track, fill width = fraction
  (clamped) colored by tone, a `~`/reduced-opacity treatment when estimated, a dashed empty track for
  unknown, and an indeterminate sweep while compacting. Under `prefers-reduced-motion: reduce`: a
  static striped fill, no animation. `role="meter"` with `aria-valuemin=0`, `aria-valuemax=100`,
  `aria-valuenow` (omitted when unknown or compacting) and `aria-valuetext`. Design tokens only, rem
  font sizes, no fallback values.
- **`StatusBar.tsx`**: render `ContextMeter` in place of the context segment's text, keeping the
  segment chrome and chevrons. Tokens and cost segments unchanged. The meter is **not** interactive
  in this task (task-007 makes it the popover trigger).
- Docs: `packages/web-client/AGENTS.md` status-bar section (meter, scale invariant, estimate rule).

## Out of scope

- Popover, compact action, local pending (task-007).
- Any auto-compaction threshold marker.

## Acceptance criteria

- [x] `formatPercent(0.7)` → `<1%`, `formatPercent(42.6)` → `43%`, `formatPercent(100)` → `100%`.
- [x] `meterState` covers compacting, unknown (no data; null-after-compaction with no cache), value
      from tokens/window, value from percent-only, and estimated. `meterTone` has the exact
      boundaries (0.6999 normal, 0.70 warning, 0.8999 warning, 0.90 danger).
- [x] A live `completed` compaction event switches the meter to `~N%`, a following null poll keeps
      it, and a non-null poll clears `~`. Replaying the same event from history changes nothing.
- [x] In a browser (`npm run dev:daemon`): the bar renders next to the Gauge icon, sweeps during a
      mock compaction, then shows the estimate. Reduced-motion emulation shows no animation.
      The other status-bar segments are unchanged.

## Test / verification plan

- Tests: `status-bar-format.test.ts`, `use-session-stats.test.ts`, `stats-store.test.ts` (if
  touched), new `features/workspace/context-meter.test.ts`, and the agent-stream-events side
  effect (`hooks/agent-stream-events` test if one exists, else a focused new one).
- Run: `npx vitest run packages/web-client` and `npm run build:web-client`.
- Manual: browser check above, including DevTools `prefers-reduced-motion` emulation. Record it.
