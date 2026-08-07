# Task 003 — Autocomplete: slash commands, file mentions, agent modes

- **Sprint:** sprint-025-composer-full
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-001; sprint-023 (explorer hooks)

## Goal
Wire the autocomplete popover to real data sources: `/` commands from the agent provider manifest,
`@` file mentions from the workspace file tree, and agent mode/model selectors.

## Scope references
- `clean-room-scope/features/composer-ui.md` § autocomplete, § slash commands, § file mentions

## What to build
- **Slash command source**: fetch available commands from agent capabilities (provider manifest +
  client-side commands like /new, /clear, /help). Show description + argument hint in popover.
  On select, insert command text + position cursor after argument placeholder.
- **File mention source**: on `@` trigger, search the workspace file tree (cached from explorer hook);
  fuzzy-match by filename; on select, insert `@path/to/file` and optionally resolve to include
  file content as context (via file read hook).
- **Agent mode control**: segmented control or dropdown above the textarea showing current model/mode;
  change triggers `agent.config.update` RPC. Modes come from provider manifest.
- **Keyboard navigation**: arrow up/down cycle options; Tab/Enter selects; Escape dismisses.
  Popover positions above textarea (FloatingUI).
- **Recent files**: `@` with empty query shows recently opened files (from tab history).

## Acceptance criteria
- [ ] `/` shows real commands from provider manifest + client commands; selecting inserts.
- [ ] `@` searches real file tree; selecting inserts path; file content attached as context.
- [ ] Agent mode/model selector shows available modes; changing updates the agent config.
- [ ] Keyboard navigation works smoothly; popover positions correctly.

## Test / verification plan
- Commands: mock provider with 5 commands → verify popover shows all, filter by prefix.
- Files: mock file tree with 20 files → type `@read` → verify `README.md` appears.
- Mode change: select different model → verify RPC called.
