# Task 001 — Spike: `execCommand('insertText')` inside a native drop on the controlled composer — Summary

- **Sprint:** sprints/sprint-081-composer-path-drop
- **Completed:** 2026-11-03
- **Status:** done

## What was implemented
A throwaway React 19 + zustand harness (in `/tmp/spike`, outside the repo, deleted) driven by real CDP
drag events in Chromium 150. Findings are in `swe/notes/composer-path-drop-spike.md`.

## Files created / changed
| File | Change |
|------|--------|
| `swe/notes/composer-path-drop-spike.md` | created: browser x question table, fallback rule, never-focused rule |

## How it satisfies the scope
Questions 1-6 answered for Chromium. Deviation: harness replicates the composer's controlled-textarea +
store round-trip instead of temporary wiring inside the real `Composer` on the dev stack (the answers
depend only on browser/React/store behaviour; the real composer is verified in task-005).
Firefox and Safari were NOT tested: no such binaries on this host, the browser tool is Chromium-only.

## Build & test results
No repo code changed; `git status` shows only the note (plus the sprint task move).

## Acceptance criteria
- [~] Note answers questions 1-6 for Chrome; Firefox/Safari named as untestable here and why
- [x] States the fallback detection rule (`execCommand` false/throws OR value unchanged) and the never-focused rule (insert at end)
- [x] No spike code in the working tree

## Follow-ups / TODO(verify)
- Firefox/Safari rows of questions 1-4 remain untested; task-006 owns them.
- Finding for D11: the `setRangeText` fallback destroys the entire undo history, not just the insertion.
