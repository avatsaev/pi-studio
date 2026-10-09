# Task 009 — Sprint close: live E2E, root docs, full gates — Summary

- **Sprint:** sprints/sprint-074-context-compaction
- **Completed:** 2026-10-09
- **Status:** done (E2E step 8 not run, by the user's call to wrap up)

## Setup
Production daemon (`packages/server/dist/daemon/main.js`, real `pi --mode rpc`) on a throwaway `PI_STUDIO_HOME` / `PI_STUDIO_PI_HOME` seeded with the real auth + models files; model Haiku via LiteLLM; two browser windows on the same daemon (Vite dev server). Scratch dirs deleted afterwards.

## Live E2E results
| # | Step | Result |
|---|------|--------|
| 1 | Popover → Compact now with instructions | PASS - `Compacting context…` then `Context compacted · 3.5k → ~3.1k (manual)` live in both windows; meter `Compacting…` → `~2%`; `~` cleared after the next turn (`2%`) |
| 2 | `/compact fold it up` in composer | PASS - one `agent_compact_request`, no `send_agent_prompt`, no user row, draft cleared, second divider in both windows |
| 3 | Running guard | PASS - popover button disabled with "Wait for the agent to finish"; `/compact` draft not submitted on a verified-`running` session (0 compact RPCs); `pi-studio agent compact` → `busy: agent … is running; wait for the turn to finish before compacting`, turn continued |
| 4 | Cancel mid-summarisation | PASS after fix - `Compaction canceled (manual)` in ~0.3 s; session usable |
| 5 | Automatic threshold (`reserveTokens` 199000 of 200k) | PASS - `auto · threshold` dividers live in both windows inside the turn, agent ended `idle` |
| 6 | "Nothing to compact" | PASS - `failed` divider live in both windows plus inline error |
| 7 | Restart → hydration, then compact before any prompt | PASS - 3 dividers rebuilt as `Context compacted · N before` at correct positions in both windows; compacting a process-less record resumed it and succeeded with history intact |
| 8 | Old-daemon fallback | NOT RUN - published 0.0.108 daemon was started (no `compactionEvents`) but the run was stopped before using it; covered by web-client store/reducer tests only |
| 9 | Percent scale | PASS - real `percent: 1.767` renders `2%`, not a 0-1 guess (`<1%` covered by unit tests / mock smoke) |

## Defects found by the live run and fixed here
1. **Doubled failure text** - `Compaction failed: Compaction failed: Nothing to compact`. Pi already prefixes `errorMessage` (`Compaction failed: ` manual, `Auto-compaction failed: ` automatic). `event-mapper.ts` now strips it (and omits `error` when nothing remains); the old mapper test had encoded an unprefixed message. Tests added in `pi-adapter.test.ts`.
2. **Cancel shown as an error** - after Stop, Pi rejects the RPC (`Turn prefix summarization failed: This operation was aborted`) and the composer showed it in red. `compaction-store.ts` now records a user cancel while a compaction is pending and returns `{ ok: false, reason: "canceled" }` with no stored error. Two regression tests added.

## Docs
Root `AGENTS.md` (compaction stream-event paragraph), `swe/features/context-compaction.md` (TODO(verify) → Resolved with evidence), `swe/sprints/PLAN.md` (sprint-074 COMPLETE, totals 72 sprints / 373 tasks).

## Gates
`npm run build` ok, `npm run typecheck` ok, `npm test` 215 files / 2823 tests passed, `npm run lint` no errors (warnings only in untouched files), `oxfmt --check` clean on changed files.

## Observations outside this sprint (not changed)
- Production daemon has no handler for `wait_for_agent` or `list_models` (`pi-studio agent wait`, `provider models` fail with `unknown_message_type`).
- `pi-studio agent run -p pi/<provider>/<model>` puts the combined string into `config.model` without `modelProvider`, so Pi falls back to its built-in provider.
