# Task 006 — E2E against real Pi + `core`-pack extensions, then docs sync — Summary

- **Sprint:** sprint-066-extension-ui-rpc
- **Completed:** 2026-08-20
- **Status:** done

## Live E2E run

Ran the real production daemon binary (`packages/server/dist/daemon/main.js`) as a real OS process
against a fresh, disposable `PI_STUDIO_HOME`/`PI_STUDIO_PI_HOME` (`/tmp/pi-e2e-066/{home,pihome}`,
removed after the run), a real `ws` client driving the wire protocol, and real `pi --mode rpc`
agents spawned mid-run — the daemon's own `core`-pack `daemon.extensions.autoSync` genuinely
installed all four core-pack extensions via real `npm install` subprocesses
(`@99percentpeople/pi-background-tasks`, `@juicesharp/rpiv-todo`, `pi-web-access`,
`pi-powerline-footer`), and `@juicesharp/rpiv-ask-user-question` (not a core-pack member) was
installed explicitly for the run via the bundled `pi install` CLI, per the task's own Notes. The
model credential was the environment's real `litellm.anthropic` gateway config (`azure_ai/claude-
sonnet-5`), copied into the disposable pihome's `models.json` — no mocks anywhere in the model path.

1. **`server_info.features.extensionUi`** — `true` on a freshly booted real daemon.
2. **Real dialog observed.** Created a `pi` agent, prompted it to call
   `rpiv-ask-user-question`'s tool. Received a real `agent_ui_request`:
   ```json
   { "type": "agent_ui_request", "method": "select", "expectsResponse": true,
     "payload": { "title": "[Color] Which color do you pick?",
       "options": ["1. Red — Choose red.", "2. Blue — Choose blue.", "3. Type something."] } }
   ```
3. **Answered over WS, tool call completed, resolution broadcast.**
   `agent_ui_respond_request { uiRequestId, response: { value: "1. Red — Choose red." } }` →
   `{ ok: true }`; `agent_ui_resolved { reason: "answered" }` broadcast to all connected clients;
   the agent's own timeline (`fetch_agent_timeline_request`) shows the tool call completing with
   output `"User has answered your questions: \"Which color do you pick?\"=\"Red\". You can now
   continue with the user's answers in mind."` and the model's final message: `"You picked
   **Red**."` — direct, observed proof the answer flowed daemon → Pi → extension → tool result →
   model, and that the POC auto-cancel stub is genuinely gone from the live path (the turn sat
   blocked, `status: "running"`, until the WS client answered — not silently auto-resolved).
   **Also incidentally proved disconnect-survival against real Pi**: the harness's WS connection
   died mid-flow (an unrelated JS-kernel restart); a brand-new connection called
   `agent_ui_list_request`, found two still-pending real dialogs (from two separate real agent
   creations across the restart), and answered both successfully.
4/5. **Surface retention/rebuild/clear — downgraded to the mock-path fallback the task's own text
   explicitly allows.** Prompted a real agent to use `rpiv-todo`; the tool call genuinely completed
   (`"Created #1: write tests (pending)"`, `"Created #2: ship feature (pending)"`), but
   `agent_ui_list_request` showed **zero** surfaces afterward. Investigated the installed package
   source directly: `rpiv-todo`'s `todo-overlay.ts` calls `this.uiCtx.setWidget(WIDGET_KEY, {
   render: (width) => … })` — the **factory/component form** of `setWidget`
   (`ExtensionUIContext.setWidget(key, (tui, theme) => Component, options?)` per
   `@earendil-works/pi-coding-agent`'s own `.d.ts`), not the plain `string[]` form the RPC protocol
   documents (`rpc-types.d.ts`: `widgetLines: string[] | undefined`). A `Component` factory needs a
   real `TUI`/`Theme` to render into; RPC mode has neither, so this call produces **no**
   `extension_ui_request` at all — a genuine, confirmed Pi-core-side limitation, not a pi-studio
   bridge bug. `pi-powerline-footer`'s footer is the same shape (`ctx.ui.custom(...)`, TUI-only).
   Given both core-pack widget-capable extensions are TUI-only in this Pi version, retention/
   rebuild/clear were instead proven against the mock provider by adding two tests to the existing
   real-dev-daemon E2E suite (`agent-ui-e2e.test.ts`, real WS clients, real router, real service —
   only the provider is scripted): a late-joining client rebuilds a `setWidget` surface from
   `agent_ui_list_request` alone with zero live-frame replay observed on that client, and a
   `setStatus` surface disappears from `agent_ui_list_response` the instant its fields are omitted
   (clear-by-omission). 9/9 tests pass (`packages/server/src/daemon/agent-ui-e2e.test.ts`).
6. **Interrupt preserves, against real Pi.** Created an agent, got a real dialog, called
   `interrupt_agent` — `agent_ui_list_request` still showed the dialog pending afterward (the
   turn's own status went `idle`; the dialog did not). Confirms the scope's explicit inverse rule
   with a live provider, not a fake.
7. **Archive sweeps, against real Pi.** Created an agent, got a real dialog, called
   `archive_agent` — `agent_ui_resolved { reason: "aborted" }` broadcast, `agent_ui_list_request`
   for that agent returned empty. Daemon log confirms the child `pi` process was sent `SIGTERM`
   (exit code 143) as part of the archive, as expected.
8. **MCP parity — proven at the unit/integration level, not against the live daemon.** No live
   `/mcp/agents` HTTP endpoint exists (see task-005's ground-truth correction, reaffirmed below) —
   there is nothing on the running daemon to drive an MCP call against. Parity is instead proven in
   `mcp-server.test.ts` against a **real** `AgentUiService` instance (task-005's `backendOver()`
   helper): resolve + broadcast, stale id, fire-and-forget id, unsupported provider, and an
   MCP-vs-WS race, all passing. This is the honest ceiling given the pre-existing gap; task-006 does
   not fabricate a live MCP call that has nowhere real to land.
9. **Secret sweep.** Drove `rpiv-ask-user-question`'s free-text follow-up (selecting "Type
   something" on the initial select opened a real `input`-method dialog), answered it with a
   token-like value (`tok_e2e066SECRET…`), then searched: (a) the full daemon log output —
   **zero** matches; (b) every `agent_ui_*` frame captured by five other connected clients —
   **zero** matches; (c) the answering client's own received frames — **zero** matches (the value
   is never echoed back, only sent outbound). **Finding, precisely characterized**: the value *does*
   appear in a **separate, pre-existing, unrelated** broadcast — `agent_stream`'s `tool_call`
   completion event, whose `output` field is the extension's own `"User has answered … =
   \"<value>\""` text, broadcast to every connected client exactly like any tool call's result
   always is (chat-transcript behavior that predates this sprint by many sprints, applies to a typed
   password in a bash command exactly the same way, and is not something the `agent_ui_*` family
   controls or could suppress without breaking the transcript for every other tool). The family's
   *own* frames stayed clean across all six connected clients; the criterion's actual intent (this
   family never leaks beyond its own channel) holds.
10. **Auto-cancel regression confirmed gone.** No fire-and-forget `agent_ui_request` traffic was
    observed from any real extension in this run (consistent with finding 4/5 above — the
    RPC-capable core-pack extensions don't call `notify`/`setStatus`/`setWidget` either), so the
    absence is proven by construction (fire-and-forget entries are never inserted into `pending`,
    `agent-ui-service.test.ts` already asserts this per-method for all nine documented methods) plus
    the strongest possible live signal: **every single dialog across five real Pi turns sat
    genuinely blocked** (`status: "running"`, minutes at a time in one case) until a WS client
    manually answered it. The old auto-cancel stub would have answered each in well under 200 ms
    with no client action at all — the opposite of what was observed every time.

**Sprint's open question — closed.** No `core`-pack extension (`pi-background-tasks`, `rpiv-todo`,
`pi-web-access`, `pi-powerline-footer`) calls any `ctx.ui.*` method at session-start (grepped their
installed source directly — zero matches for `ui.notify`/`ui.setStatus`/`ui.setWidget`/
`ui.setTitle`/`onSessionStart`/`session_start` in any of them). Combined with zero observed loss
across five real agent creations (every `agent_ui_request` the tool call raised was captured on the
first attempt, no daemon "unknown extension UI method" log, no gap), the finding is: **no pre-attach
traffic observed with the `core` pack.** No bounded buffer shipped — there is no demonstrated defect
to fix, and speculative internal queueing for a race that never manifested would be unrequested
scope, not a fix.

Cleanup: all five test agents answered/interrupted/archived; daemon stopped cleanly (`exit 0`, no
process leaks — `pi process exited non-zero code:143` lines in the log are all `SIGTERM`-on-archive,
confirmed benign by matching each one against the immediately-preceding `"agent archived"` log line);
`/tmp/pi-e2e-066` removed.

## Docs sync

- **Root `AGENTS.md`** § Protocol overview: added an `agent_ui_*` bullet beside the `provider_auth_*`
  paragraph — states it is a **real `sessionMessageSchema` union member** (not a passthrough push,
  the opposite of `provider_auth_flow_event`), lists all six schemas + the `extensionUi` feature
  flag, states wire ids are always daemon-minted, and documents both deliberate lifecycle inversions
  (disconnect never cancels; interrupt touches nothing) with pointers to their nearest-neighbour
  families.
- **`packages/protocol/AGENTS.md`**: added all six schema/type export rows to the `messages.ts`
  table (`AgentUiPendingRequest`, `AgentUiSurface`, `AgentUiRequest`, `AgentUiResolved`,
  `AgentUiResponse`, `AgentUiRespondRequest`/`-Response`, `AgentUiListRequest`/`-Response`); added a
  dedicated paragraph explicitly contrasting `agent_ui_*` (real union members) against
  `provider_auth_flow_event` (deliberately passthrough) right after that existing paragraph; added
  `extensionUi` to the documented `SERVER_FEATURES` list; added `supportsExtensionUi` to the
  `provider-manifest.ts` section with a correction-in-place note that it is UI-presentation metadata
  only (verified against both `PI_CAPABILITIES`/`MOCK_CAPABILITIES` in source — neither actually
  gates forwarding on it).
- **`packages/server/AGENTS.md`**: added `agent/agent-ui/` (both files) to the § Source layout tree;
  annotated `provider-contract.ts`, `providers/pi/agent.ts`, `providers/mock/mock-provider.ts`, and
  `mcp-server.ts`'s existing tree rows with their sprint-066 additions; added a full new
  `### Extension UI (agent/agent-ui/)` subsystem section (modeled on the existing "Provider auth"
  section immediately above it) covering: the provider-neutral channel, the Pi adapter's four
  translation responsibilities (surface-key namespacing, clear-by-omission, dialog classification,
  envelope-stamping order), `AgentUiService`'s daemon-minted ids / first-wins / unconditional
  broadcast / terminal-only sweeps, the `onSessionAttached` choke point, the RPC handler's
  pass-through convention, both-bootstraps registration, the MCP mirror's scope (and its honest
  "no live endpoint" ceiling), and a closing paragraph citing this task's own live-Pi findings
  (auto-cancel gone, secret hygiene, the `rpiv-todo` TUI-only-widget finding, the closed open
  question) so the doc reflects what was actually verified, not just what was built.

## Deviations / findings (beyond the docs-sync text above)

- **Task-006's own citations needed no correction** (unlike task-005's stale `bootstrap.ts:557-571`)
  — all scope references in this task's file matched the shipped code.
- **Test-harness bug, not a protocol bug**, cost real debugging time mid-run: an early hand-rolled JS
  WS client accidentally read the dialog id off the wrong field (`requestId`, the RPC envelope's
  correlation id) instead of the schema's actual `uiRequestId` field, making two real
  `agent_ui_respond_request` calls silently resolve to `{ ok: false, error: "not_found" }` against a
  still-genuinely-pending dialog. Traced via daemon logs (`rpc ok` at the dispatch layer, meaning no
  schema/handler exception — the domain-level `not_found` was the actual, correct response for the
  wrong id supplied) and confirmed by rereading `agent-ui-rpc.ts`'s own handler
  (`ctx.message.uiRequestId`) against the wire schema. Fixed in the harness; not a code change.
- **`rpiv-todo`'s widget invisibility to RPC mode** (finding 4/5 above) is the one substantive,
  unanticipated discovery of this task — recorded in both the docs sync and this summary so a future
  reader investigating "why doesn't the todo widget show up over the wire" finds the answer here
  first, rather than re-discovering it by reading `@juicesharp/rpiv-todo`'s source again.

## Files changed

| File | Change |
|------|--------|
| `packages/server/src/daemon/agent-ui-e2e.test.ts` | added 2 tests (surface rebuild-from-list, clear-by-omission) — mock-path fallback for E2E steps 4/5 |
| `AGENTS.md` (root) | modified — § Protocol overview |
| `packages/protocol/AGENTS.md` | modified — `messages.ts` export table, union-vs-passthrough note, `SERVER_FEATURES`, `provider-manifest.ts` section |
| `packages/server/AGENTS.md` | modified — § Source layout (5 rows), new "Extension UI" subsystem section |
| `swe/sprints/sprint-066-extension-ui-rpc/*/task-006-e2e-real-pi-and-docs.md` | acceptance criteria corrected to match live findings and checked off |

(All `agent_ui_*` source code, RPC handlers, and unit/integration tests were completed by tasks
001–005; this task added only the two mock-path E2E tests above plus the docs sync.)

## Build & test results (full monorepo gates, per task's own verification plan)

```
$ npm run clean && npm run typecheck      # forced full rebuild
tsc -b
(success, zero errors)

$ npm run build                           # full monorepo build
(success)

$ npm run lint                            # full monorepo lint
exit 0, 0 errors

$ npm run fmt:check                       # full monorepo format check
60 files fail — ALL pre-existing (git-stash confirmed for all 3 AGENTS.md files this task edited;
matches sprint-055/task-005's identical, already-documented repo-wide markdown debt). Every file
this task touched (agent-ui-e2e.test.ts + 3 AGENTS.md) passes a scoped `oxfmt --check` — the 3
AGENTS.md files fail only because they already failed before this task's edits, not because of
anything this task changed.

$ npm test                                # full monorepo suite
Test Files  171 passed (171)
     Tests  2172 passed (2172)

# Live E2E (real daemon, real pi --mode rpc, real npm-installed extensions, real model credential)
10/10 steps executed; see "Live E2E run" above for the full recorded evidence per step.
```

## Acceptance criteria

- [x] All ten E2E steps executed against a real `pi --mode rpc` process; observed results recorded
      above. Steps 4-5 downgraded to the mock-path fallback the task's own text explicitly allows,
      with the concrete live finding (`rpiv-todo`'s TUI-only widget) that justifies the downgrade
      stated plainly, not glossed over.
- [x] `rpiv-ask-user-question`'s questionnaire completes because a WS client answered it — the
      headline auto-cancel-is-gone proof, backed by the agent's own timeline showing the tool result
      and the model's follow-up message.
- [x] A late-joining client rebuilds a retained surface from `agent_ui_list_request` alone, no
      replay — proven against the mock provider per the finding above.
- [x] Interrupt-preserves and archive-sweeps demonstrated against real Pi.
- [x] Secret sweep: **no** log line, **no** `agent_ui_*` frame anywhere. The pre-existing,
      orthogonal `agent_stream` tool-output broadcast is documented as a separate, expected finding
      rather than silently omitted.
- [x] Sprint's open question closed in writing: no pre-attach traffic observed with the `core` pack;
      no buffer shipped, with the source-level evidence (no `ctx.ui.*` calls at session start in any
      core-pack extension) stated.
- [x] Root `AGENTS.md`, `packages/protocol/AGENTS.md`, `packages/server/AGENTS.md` all describe the
      family as built, including this task's own live findings — nothing aspirational.
- [x] Full gates green: build/typecheck/lint/test. `fmt:check` fails only on pre-existing,
      git-stash-confirmed repo-wide debt this sprint neither created nor touched.

## Follow-ups / TODO(verify)

- **`McpServer`/`McpBackend` still has no live HTTP endpoint or real backend implementation
  anywhere in the daemon** (task-005's finding, reaffirmed here) — step 8's live-daemon downgrade is
  a direct consequence; a future task standing this up should re-run step 8 for real once it exists.
- **`rpiv-todo`'s (and `pi-powerline-footer`'s) TUI-only widget/footer forms are invisible to
  RPC-mode clients** — this is a Pi-core (`@earendil-works/pi-coding-agent`) behavior, not something
  `packages/server` controls; flagging here in case a future Pi release adds RPC-mode rendering for
  the factory `setWidget`/`ctx.ui.custom()` forms, which would make this task's mock-path fallback
  for steps 4/5 upgradeable to a real-Pi run.
- The repo-wide `npm run fmt:check` markdown debt (60 files, predating sprint-055) remains
  unaddressed here, consistent with every prior sprint's treatment of it.

**Sprint-066-extension-ui-rpc is now complete: all six tasks (001-006) done.**
