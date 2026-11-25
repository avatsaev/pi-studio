# Task 004 — Drop agent modes — Summary

- **Sprint:** sprints/sprint-147-drop-dead-subsystems
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
Removed from the protocol: `providerModeSchema`, `ColorTier`, `modes` on the provider definition, `modeId` on the session config, the `supportsDynamicModes` flag. From the server: the mode members of the provider contract, the Pi (three modes) and mock manifests, the mode fields on both sessions, `modeId` in `update_agent` and in the record/runtime schemas (records stay `.passthrough()`, so an old `modeId` stays on disk and is ignored), `modes` in `provider-snapshot.ts` and `provider-registry.ts`. From the client SDK: `listModes`, `modeId` in `update`. From the CLI: `agent mode` and `agent update --mode`. Docs in protocol, server, client, CLI, fern `agent.mdx`; `swe/features/agent-providers.md` and `agent-sessions.md` adjusted.

## Build & test results
```
$ npx vitest run packages/server/src/agent packages/protocol/src packages/client/src packages/cli/src packages/server/src/persistence   -> 82 files, 1458 passed
$ npm run build:protocol && build:client && build:server && build:cli                                                                   -> success
$ Wave gate (full tree, once, after tasks 002 and 004): `npm run build` exit 0; `npm run typecheck` exit 0; `npm run lint` exit 0 (existing warnings only); `npm test` 325 files, 4671 tests, all passed; `oxfmt --check` on all changed source files clean.
```

## Acceptance criteria
- [x] No `modeId`, `setMode`, `listModes`, `getAvailableModes`, `getCurrentMode` in `packages/*/src` (the remaining `setMode` hits are the ui-library theme controller and the workbench viewer toggles)
- [x] `list_providers_response` carries no `modes`

## Follow-ups / TODO(verify)
- `packages/protocol/fixtures/`, `desktop/` and the workbench have no mode usage (grep).
- `provider-snapshot.ts` and its test are deleted by task-006. The client's `providers.refreshSnapshot()` has no daemon handler (not part of this task).
