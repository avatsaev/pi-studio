# Task 007 — Sprint close: live E2E, root docs, full gates

- **Sprint:** sprint-073-viewer-settings
- **Status:** backlog
- **Type:** docs
- **Area:** repo-wide
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002, task-003, task-004, task-005, task-006

## Goal

Prove the whole chain works against a real daemon and a real browser, then land the repo-level
documentation the six preceding tasks deliberately left to one writer.

## Context / why

Every prior task ran its own package's suite. Nothing has yet exercised protocol → daemon → SDK →
store → gate → UI in one pass, and the two behaviors that only appear end to end are exactly the
ones this feature exists for: **multi-client convergence** and **persistence across restarts**.

Root-level docs are batched here on purpose. Six tasks each editing the root `AGENTS.md` would
conflict; one writer with the finished behavior in hand writes it once, accurately.

## Scope references

- `docs/MOLVIEWER_DECOUPLING.md` § 5 Phase 0, § 7 semantics table (:663-665), § 8 test list
  (:710-718), § 10 Chunk A
- Root `AGENTS.md` — § Protocol overview (the RPC-family paragraphs), § Persistence layout tree
- `swe/architecture/viewer-plugin-system.md` — the "Prerequisite flagged, not glossed" note that
  says chunk A must land first

## What to build

**Live E2E (real production daemon, real browser, two windows).** Not the dev daemon — the
persistence path only exists in production bootstrap's `$PI_STUDIO_HOME`.

1. `npm run build && npm start`, connect a browser window.
2. Toggle Molecule Viewer off → `~/.pi-studio/viewer-settings.json` appears containing exactly the
   one row; no `.tmp` file remains.
3. Open a `.cif` from the explorer → text tab. Context menu shows neither molecule item; the `+`
   menu shows no "New molecule view".
4. Second browser window on the same daemon → its toggle is already off; flip it back on there →
   the first window's switch flips **without a reload**.
5. Reload window one → still on. Restart the daemon → still on.
6. With the viewer on, open a molecule tab, then disable the viewer → the open tab keeps rendering
   (disabled never destroys state). Reload → that tab returns as a **text** tab.
7. Corrupt `viewer-settings.json` by hand, restart the daemon, reconnect → everything enabled, a
   warning in the daemon log, and the file left as-is by the read.

Record the observed result of each step in the task summary. Any step that cannot be run must be
stated as not-run, never assumed.

**Root `AGENTS.md`.** Add a `viewer_settings_*` paragraph to § Protocol overview alongside the
`provider_auth_*` / `agent_ui_*` entries, stating: real union members including the push (and why,
versus the passthrough-push family); the daemon knows nothing about plugins; absent row = enabled;
capability-absent clients treat everything as enabled. Add `viewer-settings.json` to the
§ Persistence layout tree with a one-line purpose.

**`docs/MOLVIEWER_DECOUPLING.md`.** Append a review-log entry recording that chunk A shipped, with
anything the implementation settled differently from the plan. Mark § 5 Phase 0 as shipped so the
next reader does not re-plan it.

**`swe/sprints/PLAN.md`.** Flip the sprint-073 section's Status line to COMPLETE and update the
coverage note.

**Verify no doc claims aspirational behavior.** In particular the phase-1 spec
(`swe/architecture/viewer-plugin-system.md`) says its enabled-filter reads a settings store that
"doesn't exist yet" — that sentence is now false. Update it to point at the shipped store.

## Out of scope

- Anything in phases 1-5 of the decoupling plan. This closes chunk A only.
- Relay-transport verification. Worth doing eventually (the multi-client claim is strongest there),
  but the push rides the same session envelope every other broadcast uses, and no relay-specific
  code was added. If a relay is available, run step 4 over it and record the result; do not block
  the sprint on standing one up.

## Acceptance criteria

- [ ] All seven E2E steps executed against a real production daemon and a real browser, each with
      its observed result recorded (or explicitly marked not-run, with the reason).
- [ ] Root `AGENTS.md` documents the family and the persistence file.
- [ ] `docs/MOLVIEWER_DECOUPLING.md` has a chunk-A review-log entry and phase 0 marked shipped.
- [ ] `swe/architecture/viewer-plugin-system.md` no longer describes the settings store as absent.
- [ ] `swe/sprints/PLAN.md` sprint-073 section reads COMPLETE.
- [ ] Full root gates green: `npm run build`, `npm run typecheck`, `npm test`, `npm run lint`,
      `npm run fmt:check` (only for files this sprint touched — the repo has pre-existing markdown
      formatting failures unrelated to this work; do not widen the diff to chase them).

## Notes

- Step 7's corrupt-file case is the one that distinguishes this subsystem's soft-fallback loader
  from `extensions-state.ts`'s `"unreadable"` sentinel. If it behaves like the sentinel, task-002's
  loader picked the wrong contract — fix it here rather than documenting the surprise.
- If the `viewerSettings` flag does not reach `server_info.features` on the relay path, that is a
  task-002 defect; fix it and say so, do not paper over it in the docs.
