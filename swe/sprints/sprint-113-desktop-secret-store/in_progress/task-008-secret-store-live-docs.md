# Task 008 — Linux live checks and documents for the secret store

- **Sprint:** sprint-113-desktop-secret-store
- **Status:** in_progress
- **Type:** test
- **Area:** desktop/docs, swe/features
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-006, task-007

## Goal
The secret store is shown to work in the real app on Linux, and the documents describe it.

## Context / why
Live evidence for the Secrets criteria of the spec, and the documents that still say secrets live in `daemons.json`.

## Scope references
- `swe/features/desktop-transport-bridge.md` § Acceptance criteria (Secrets), § TODO(verify)
- `swe/features/desktop-daemon-registry.md` § Public contract 1, decisions D13 and D27 (amend: carried out)
- `desktop/AGENTS.md` (rule 10, "Where it stands"), `desktop/docs/architecture.md` (§ The five seams, § The registry and the local daemon), `desktop/README.md`, `desktop/docs/development.md`
- `docs/desktop-client-handoff.md`

## What to build
- In the container, in the real webview, with a scratch configuration directory and daemon:
- (1) start on a version 1 `daemons.json` holding a direct entry with a password and a relay entry: afterwards the file is version 2, the secrets are in the store, and the direct entry connects; the relay entry connects if the local relay of the sprint-111 checks can be started, else say it was not run;
- (2) with a Secret Service: add, edit and remove an entry and show the item appear, change and go with `secret-tool`;
- (3) without one: `secretStore` is `file`, `secrets.json` is mode 0600, and a screenshot shows the Daemons screen's line.
- The documents listed above, rewritten where they say secrets are in `daemons.json`. The registry spec's § 1 shows version 2 and points here.
- A failed check is fixed in the task that owns the code and that task's summary is reopened.

## Out of scope
- macOS and Windows (sprint 117).
- The bridge.

## Acceptance criteria
- [ ] The three runs are in the summary with their commands, outputs and the screenshot.
- [ ] The Secrets criteria of the spec that Linux can show are ticked with that evidence; the macOS and Windows parts stay open.
- [ ] No document claims that a secret is in `daemons.json`, except where it describes version 1 or a `*.corrupt-*` copy.
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- `cargo xtask ci` in `desktop/`
- The live runs, always with a scratch `PI_STUDIO_HOME` and a free port.

## Notes
- Spec status lines, `PLAN.md` and the handoff are edited by the orchestrator.
