# Task 001 — Spike: does `pi install` keep an existing entry's filter arrays?

- **Sprint:** sprint-077-skills-install
- **Status:** done
- **Type:** test
- **Area:** packages/server (investigation)
- **Priority:** P1
- **Estimated size:** XS
- **Depends on:** none

## Goal

Resolve the spec's only open question with evidence before the package install path is built.

## Context / why

Reinstalling a package already managed skills-only must not silently re-enable its extensions. Pi's `addSourceToSettings` is believed to rewrite only `source` on a same-identity entry.

## Scope references

- swe/architecture/pi-resource-management.md § TODO(verify), § Install
- node_modules/@earendil-works/pi-coding-agent/dist/core/package-manager.js:624-656

## What to build

Throwaway script with `HOME` and `PI_CODING_AGENT_DIR` set to a temp dir **before** Pi is imported or spawned: write `{source:"npm:<small pkg>", extensions:[], prompts:[], themes:[]}`, run the bundled `pi install npm:<same pkg>`, diff settings.json. Record the answer in the spec's TODO(verify) and in this task's summary; delete the script.

## Out of scope

- Production code

## Acceptance criteria

- [x] Observed settings.json before/after recorded
- [x] Spec TODO(verify) checked off with the answer and, if filters are lost, task-004 updated to re-apply them after the spawn (not needed — filters survived)

## Test / verification plan

- The script's output, captured in the summary
- Real `~/.pi` and `~/.agents` unchanged (compare mtimes before/after)
