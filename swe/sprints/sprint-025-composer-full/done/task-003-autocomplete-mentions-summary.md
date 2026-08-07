# Task 003 — Autocomplete: slash commands, file mentions, agent modes — Summary

- **Sprint:** sprint-025-composer-full
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented

Wired the composer autocomplete popover to real data sources — `/` commands
(client + provider), `@` file mentions (workspace tree, fuzzy), and an agent
mode/model control that pushes changes to the daemon.

1. **Slash command source (`mergeSlashCommands`).** Merges built-in client
   commands (`/exit`, `/clear`) with provider-advertised commands. Client
   commands appear only at the **root** (not in a draft, not for inline
   `/skill` mid-text); provider commands win on name clash. Filter + rank:
   exact-name → name-prefix → description-contains, then alphabetical.

2. **File mention source (`fuzzyMatchFiles` + `isSubsequence`).** Fuzzy-matches
   the workspace directory listing by name/path with a ranked scale
   (exact → name-prefix → name-contains → path-contains → name-subsequence →
   path-subsequence). An **empty `@` query** returns recent files (in order)
   when provided, else the first N entries. Directory entries are marked so the
   inserted path can be a prefix.

3. **Agent mode control (`useAgentModeControl` + `buildAgentConfigUpdate`).**
   `providerModesToOptions` maps `ProviderMode[]` → UI options; changing the
   mode/model issues `client.agent(id).update(patch)` (`agent.config.update`)
   with an optimistic store update and only-defined fields in the payload.

4. **React hook (`useComposerAutocomplete`).** Gathers provider commands (from
   the agent's capabilities) + workspace file entries (from
   `useDirectoryListing`) for a given server/agent/cwd, ready to feed the
   Composer.

5. **Composer wiring.** The Composer now:
   - computes command-mode options via `mergeSlashCommands` and file-mode
     options via `fuzzyMatchFiles` based on the detected active token;
   - renders both popover variants (command + file), inserting the selection
     via `applyCommandInsertion` / `applyFileInsertion`;
   - keyboard navigation (↑/↓ cycle, Enter/Tab select, Esc dismiss) works for
     both modes and consumes keys before submit;
   - shows a mode `<select>` chip in the footer when modes are available.
   `AgentPane` feeds `providerCommands` + `fileEntries` from the new hook.

## Files created / changed

| File | Change |
|------|--------|
| `packages/app/src/composer/autocomplete-sources.ts` | created (pure sources) |
| `packages/app/src/composer/autocomplete-sources.test.ts` | created (15 tests) |
| `packages/app/src/hooks/use-composer-autocomplete.ts` | created (hooks) |
| `packages/app/src/components/timeline/Composer.tsx` | modified (command+file popover, mode chip) |
| `packages/app/src/components/workspace/PaneContentRouter.tsx` | modified (feed autocomplete data) |
| `packages/app/src/composer/index.ts` | modified (export sources) |
| `packages/app/src/hooks/index.ts` | modified (export hooks) |

## How it satisfies the scope

- **composer-ui.md § Slash-command & file-mention autocomplete** — command mode
  merges client (root-only) + provider commands with debounce-ready filtering;
  draft lists only provider commands; inline lists only provider commands;
  file mode fuzzy-matches directory suggestions with `{ path, kind }`; file
  mode wins when both could match (handled upstream by `detectActiveToken`);
  keyboard consumes arrows/enter/escape first.
- **§ Provider / model / mode / feature controls** — mode chip in the footer
  (compact placement) reading available modes; changes persist to the daemon
  via `agent.config.update` with optimistic store update.
- **Recent files** — empty `@` query returns recent paths first.

### Deviations / scope boundaries
- **File tree source.** Fuzzy matching runs over the current directory
  listing (`useDirectoryListing`) rather than a recursively flattened cache or
  the dedicated daemon directory-suggestions RPC (`{ cwd, query, limit,
  includeFiles, includeDirectories }`). The matcher is source-agnostic; swapping
  in the suggestions RPC later is a drop-in. Marked TODO(verify).
- **File-content-as-context on select.** Selecting a file inserts
  `@path` (scope's primary behavior). Auto-resolving file *content* into the
  message as context depends on the file-read hook + message-context payload
  and is a follow-up (not required for the insert-path acceptance criterion).
- **Model selector (favorites, per-provider rows).** The mode chip is wired;
  the full combined *model* selector with favorite pinning is a larger control
  surface — the `buildAgentConfigUpdate`/`useAgentModeControl` plumbing already
  supports `model` changes, so the richer selector is additive UI (sprint-028
  polish).

## Build & test results

```
$ npx tsc -b packages/app
(clean)

$ npx vitest run packages/app/src/composer/autocomplete-sources.test.ts
 Test Files  1 passed (1)
      Tests  15 passed (15)

$ npm run typecheck   # whole monorepo
(clean)

$ npm test
 Test Files  117 passed (117)
      Tests  1539 passed (1539)
```

## Acceptance criteria
- [x] `/` shows real commands from provider manifest + client commands;
      selecting inserts — `autocomplete-sources.test.ts` mergeSlashCommands
      (merge/filter/rank/draft/inline); Composer inserts via
      `applyCommandInsertion`.
- [x] `@` searches real file tree; selecting inserts path — `fuzzyMatchFiles`
      tests (prefix "read"→README, path-substring, recent files, limit);
      Composer inserts via `applyFileInsertion`. (File-content-as-context is a
      documented follow-up.)
- [x] Agent mode/model selector shows available modes; changing updates the
      agent config — `providerModesToOptions` + `buildAgentConfigUpdate` tests;
      `useAgentModeControl` issues `agent.update`.
- [x] Keyboard navigation works; popover positions correctly — Composer
      ↑/↓/Enter/Tab/Esc handling unified across command + file modes.

## Follow-ups / TODO(verify)
- Swap directory-listing source for the daemon directory-suggestions RPC (whole
  tree, debounced) when available.
- File-content-as-context resolution on `@`-select.
- Full combined model selector with favorites (sprint-028 polish); plumbing is
  ready.
