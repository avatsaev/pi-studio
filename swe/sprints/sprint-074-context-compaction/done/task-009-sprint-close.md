# Task 009 — Sprint close: live E2E against real Pi, root docs, full gates

- **Sprint:** sprint-074-context-compaction
- **Status:** done
- **Type:** docs
- **Area:** repo-wide
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002, task-003, task-004, task-005, task-006, task-007, task-008

## Goal

Prove the whole chain against a real production daemon, a real `pi --mode rpc` process and real
browsers. Then land the root documentation and resolve the spec's `TODO(verify)` items.

## Context / why

Each task ran its own package's suite against fakes or the mock provider. Several behaviors only
exist with real Pi: automatic threshold compaction inside a turn, Pi's own error strings, the
post-compaction `null` usage, the session-file hydration of a real `compaction` entry, and abort
cancelling a real summarisation.

## Scope references

- `swe/features/context-compaction.md` § Acceptance criteria, § TODO(verify)
- Root `AGENTS.md` § Protocol overview (stream-event and feature-flag paragraphs)
- `swe/sprints/PLAN.md` sprint-074 section

## What to build

**Live E2E** (`npm run build && npm start`, a model credential via `pi-studio auth login`, two
browser windows on the same daemon). Record each step's observed result in the summary, or mark
it not-run with the reason. Never assume a result.

1. Idle session with a few turns → meter popover → Compact now with instructions → both windows
   show the `manual` divider live, the meter sweeps, then `~N%`. After the next turn, `~` is gone.
2. `/compact` from the composer → same result, with no user row and no prompt sent.
3. Start a long turn → popover action disabled with the running note, and a `/compact` draft cannot
   be submitted. `pi-studio agent compact <id>` against the running agent → `busy`, and the turn
   keeps running.
4. Compact, then press Stop (composer) or Cancel (popover) mid-summarisation → `Compaction
   canceled`, session usable.
5. **Automatic compaction:** in a throwaway `--pi-home`, set Pi `settings.json`
   `compaction.reserveTokens` close to the model's context window so the threshold trips on the
   next turn. Send a prompt and observe an `auto · threshold` divider live in both windows, inside
   the turn, with the agent ending `idle`.
6. "Nothing to compact": compact a fresh one-message session → inline error plus a `failed`
   divider.
7. Restart the daemon → reopen the compacted session → `Context compacted · <before> before`
   divider at the right position. Then Compact now **before** sending anything → the process
   resumes and the compaction succeeds, with history intact.
8. **Old-daemon fallback:** point the browser at a daemon without `compactionEvents` (the previous
   published release, e.g. `npx @av-pi-studio/cli@<prev> daemon start` on another port/home) →
   Compact now shows the local in-progress state and the estimate, with no divider and no error.
9. Percent scale: a fresh session under 1% shows `<1%`, not `70%`.

**Docs.**
- Root `AGENTS.md` § Protocol overview: a `compaction` stream-event paragraph covering the phases,
  `compactionId` upsert, manual events recorded via `handleCompact`'s subscription window,
  automatic events inside `runTurn`, the `busy` guards, resume-on-compact, the `compactionEvents`
  flag and its client fallback, and hydration from Pi `compaction` entries.
- `swe/features/context-compaction.md`: resolve every `TODO(verify)` with evidence (CommandMenu
  disabled rows; `compaction_end` before reject on all Pi failure paths, from step 6; the final
  `busy` wording).
- `swe/sprints/PLAN.md`: flip the sprint-074 Status line to COMPLETE and update coverage.
- Re-read every AGENTS.md touched by tasks 001–008 for contradicted invariants (in particular the
  status-bar and stats-store descriptions of `contextPercent`'s scale).

## Out of scope

- Relay-transport verification. If a relay is at hand, run step 1 over it and record the result.
  Do not block on it: compaction events ride the same `agent_stream` envelope as every other event.

## Acceptance criteria

- [ ] All nine E2E steps executed with observed results recorded (or explicitly not-run, with the
      reason).
- [ ] Root `AGENTS.md` documents the event family and flag.
- [ ] Spec `TODO(verify)` items resolved. PLAN.md sprint-074 reads COMPLETE.
- [ ] Full root gates green: `npm run build`, `npm run typecheck`, `npm test`, `npm run lint`, and
      `npx oxfmt --check` on files this sprint touched (do not widen the diff to chase
      pre-existing formatting).

## Notes

- If step 5's threshold trick doesn't trip (per-model overrides win over the ordinary setting, see
  `settings-manager.js` `getCompactionTokenSetting`), set the per-model override instead and say
  which one worked.
- If step 7's resume path loses history, that is a task-003 `ensureTimelineSeeded` defect. Fix it
  here and say so.
