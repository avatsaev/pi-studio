# Task 004 — Mock support, end-to-end verification, docs sync — Summary

- **Sprint:** sprint-040-agent-command-discovery
- **Completed:** 2026-07-26
- **Status:** done

## What was implemented
1. **Mock support**: `MockAgentSession.listCommands()` returns a fixed, deterministic 3-entry list
   covering all three sources — one `extension` (project scope), one `prompt` (project scope), one
   `skill` (user scope) — with stable `name`/`id`/`description`/`source`/`scope`/`path` (no
   timestamps/randomness), so `agent_list_commands_request` is exercisable end-to-end without a
   real `pi` binary.
2. **Preserved unsupported-path coverage**: `exportHtml` remains deliberately omitted on the mock
   (unchanged from sprint-037), so the "optional method absent → `rpc_error`" path stays covered
   by the existing `handleExportHtml` test even now that `listCommands` is implemented. Updated the
   in-code comment above the slash-command stubs to say so explicitly.
3. **Docs sync**:
   - `packages/protocol/AGENTS.md` — added `agentCommandDescriptorSchema`/`agentListCommandsRequestSchema`/`agentListCommandsResponseSchema` to the `messages.ts` key-exports table.
   - `packages/server/AGENTS.md` — added a "Command discovery" Invariants bullet (mirroring the
     existing "Slash-command operations" bullet's structure) describing the RPC, the
     `AgentCommandDefinition` shape, and both provider implementations; updated the
     `slash-command-operations.ts` source-layout table row to mention command discovery.
   - Root `AGENTS.md` — verified it does not enumerate individual slash-command/RPC names (only the
     general flat-snake-case/dotted-alias convention), so no change was needed there, matching the
     task's own prediction.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/agent/providers/mock/mock-provider.ts` | added `AgentCommandDefinition` import; implemented `listCommands()`; updated the slash-command-stubs comment |
| `packages/server/src/agent/providers/mock/mock-provider.test.ts` | added a test asserting the deterministic 3-entry output and re-confirming `exportHtml` stays unsupported |
| `packages/protocol/AGENTS.md` | added 3 rows to the `messages.ts` key-exports table |
| `packages/server/AGENTS.md` | added a "Command discovery" Invariants bullet; updated the `slash-command-operations.ts` source-layout row |

## How it satisfies the scope
- Mock output is fully deterministic (no `Date.now()`/`randomUUID()` in the returned list), so
  repeated test runs never flake.
- `exportHtml` — not `listCommands` — remains the mock's "one omitted optional method" proving the
  unsupported→`rpc_error` path from task-003, exactly per the task's guidance (task-003's own unit
  test additionally used an isolated `sessionStub()` override for the same reason, independent of
  whatever the mock provider itself supports).
- Docs describe only what the code now does — no aspirational fields, no unbuilt SDK/CLI/web-client
  surfaces implied.

## Build & test results
```
$ npm run build
(all 7 packages built clean, including web-client's vite build)

$ npm run typecheck
> tsc -b
(clean, no output)

$ npx vitest run packages/server packages/protocol
 Test Files  56 passed (56)
      Tests  462 passed (462)

$ npx oxfmt --check <every file touched across all 4 tasks>
All matched files use the correct format. (after running `npx oxfmt` once to auto-fix)

$ npx oxlint <every file touched across all 4 tasks>
Only pre-existing warnings on untouched lines (unused test imports predating this sprint, one
pre-existing `Array#reverse()` style note, one pre-existing `consistent-function-scoping` note on
the existing `sessionStub` helper) — zero errors, zero new warnings introduced by this sprint's
changes.
```

## Acceptance criteria
- [x] Mock `listCommands()` returns a deterministic multi-source list.
- [x] At least one optional method remains omitted on the mock so the unsupported→`rpc_error`
      path stays covered (`exportHtml`, unchanged from sprint-037).
- [x] Docs updated (protocol + server AGENTS.md) truthfully; no aspirational behavior documented.
- [x] `npm run build`, `npm run typecheck`, and the server + protocol Vitest suites pass.

## Follow-ups / TODO(verify)
- No real-`pi`-binary live smoke test was run (optional per the task — "not required for
  sign-off"); the adapter unit test (task-002, verified against Pi's actual `.d.ts` types) and the
  mock test above are the proof, per the task's own sign-off criteria.
- SDK facade, CLI, MCP mirror, and web-client discovery surfaces remain explicitly deferred to a
  future sprint (out of scope for sprint-040, per every task's "Out of scope" section).
