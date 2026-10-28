# Grill — Todo extension view in the UI

> Status: grilled
> Started: 2026-10-28   Last updated: 2026-10-28   Rounds: 5
> Engineer: avatsaev   Agent: pi

## Raw idea
"let's grill this todo feature in the ui" — surface the `@juicesharp/rpiv-todo` extension's todo list in the web UI (context: is there a sprint that implements the todo extension view in the UI? — no; retained surfaces §09/§10 are scoped but unplanned).

## Problem & outcome
- **Who:** a user watching an agent work in the web UI.
- **Today:** rpiv-todo's overlay is TUI-only; the web UI shows the model's plan nowhere except raw `todo` tool rows.
- **Done means:** glanceable live view of the agent's todo list in a collapsible panel above the composer (D2, D3 revised).
- **Measured by:** TODO(verify) — decided at Acceptance.

## Goals
- Read-only live todo list per conversation, restored after reload/compaction (D4).

## Non-goals
- User editing of tasks (D4); a Pi-Studio-native todo tool (D1); generic widget renderer (separate, unplanned).

## Decisions
| # | Theme | Question | Decision | Rationale | Round |
|---|-------|----------|----------|-----------|-------|
| D1 | data | Source of todo list | Daemon derives it from `todo` tool results / `rpiv-todo-state` entries | Only path with a real producer today; widget never reaches RPC | 1 |
| D2 | problem | Problem solved | See the agent's live plan | Parity with TUI overlay | 1 |
| D3 | placement | Where in UI | ~~Right dock tab~~ **Superseded (R2):** panel above the composer, per conversation | Engineer reconsidered after dock/tab-kind challenge; mirrors TUI `aboveEditor`; no new tab kind or layout primitive | 1→2 |
| D4 | scope | v1 | Read-only live list; no editing | Smallest shippable | 1 |
| D5 | placement | Appearance trigger | Appears automatically when the agent has ≥1 non-deleted todo (the 'auto-open on first todo' answer, applied to the panel; no tab, no layout change) | Natural fit for an above-composer panel; hides when empty like the TUI overlay | 2 |
| D6 | transport | Daemon→client | New `agent_todos_*` family: list request + broadcast push, `agentTodos` capability flag; typed `{tasks,nextId}` | Append-only protocol; works after reload; avoids overloading closed ToolCallDetail | 2 |
| D7 | truth | Source after reload/compaction/restart/fork | Mirror rpiv-todo replay: last `rpiv-todo-state` custom entry on the CURRENT branch, live-updated from `todo` tool results | Follows fork/rewind/tree exactly like the extension; requires reading custom entries (dropped at hydration today) | 2 |
| D8 | ux | Collapse | Expanded by default, user-collapsible, remembered per conversation; collapsed = one line with in-progress `activeForm` | Matches TUI overlay; glanceable | 3 |
| D9 | ux | Fields/statuses | Subject + status icon; `activeForm` for in_progress; `deleted` hidden; completed dimmed/struck; `blockedBy` as "blocked by #n"; description/owner on expand; `metadata` ignored | Useful without clutter | 3 |
| D10 | ux | Scale | Panel height capped (~40% of pane) with scroll; completed group collapsed when >~5 done; order by id; panel stays visible after all done | Dozens of tasks must not eat the transcript | 3 |
| D11 | ux | Multi-pane / subagents | One panel per chat pane bound to its own agent; sub-agent lists not merged | rpiv-todo partitions by session id; no parent/child relation needed on wire | 3 |
| D12 | integration | Recognition/coupling | Pi adapter only: constants (`todo`, `rpiv-todo-state`) + strict validator mirroring rpiv-todo `isTaskDetails`; invalid/unknown shapes ignored (no panel); added to AGENTS.md "mirrors internals, re-check on bump" list | Keeps extension knowledge in `providers/pi/`; garbage-proof | 4 |
| D13 | timing | Liveness | Update live from `todo` tool_execution_end details; reconcile by re-reading current branch at turn end/agent_settled and after fork/compact/tree changes | Catches `ctx.executeTool` writes and branch moves; no hot-path I/O | 4 |
| D14 | integration | Boundary | Provider-neutral todos channel on `AgentSession` (provider-contract.ts); Pi adapter extracts; mock provider can emit scripted todos | Provider isolation (root invariant 3); makes dev daemon + tests drive the UI | 4 |
| D15 | transport | Fan-out | Broadcast full snapshot to all sessions + `agent_todos_list` RPC for late join; client filters by agentId; monotonic seq/rev drops stale; task-count cap (~200) | Same shape as `agent_ui_*`/`skills_changed`; snapshots avoid ordering bugs | 4 |
| D16 | data | Process-less agent after restart | `agent_todos_list` answers by reading the current branch from the session file, read-only, no process spawn; cached until a process attaches or state changes | Panel must appear on reload; avoids persisting a second source of truth | 5 |
| D17 | security | Text rendering | Plain text only (no markdown/links); subject single-line ellipsis, full text on expand/title; server caps field lengths during validation | Model-authored text; no injection surface | 5 |
| D18 | rollout | Kill switch | Capability flag `agentTodos` only; ships on; no setting | Panel invisible unless agent uses todos, collapsible when it does | 5 |
| D19 | scope | Surfaces | SDK + web-client only; CLI `agent todos` and aria-live announcements Deferred; panel is a labelled region, keyboard-collapsible | Smallest shippable | 5 |

## Integration points
| Existing module / service / config | How the feature touches it | Direction | Risk / note |
|------------------------------------|----------------------------|-----------|-------------|
| `packages/protocol/src/messages.ts`, capabilities | New `agent_todos_*` schemas + `agentTodos` feature flag | emits | Append-only; real `sessionMessageSchema` members |
| `packages/server/src/agent/provider-contract.ts` | Optional todos channel on `AgentSession` | contract | Mock + Pi implement |
| `providers/pi/event-mapper.ts`, `agent.ts`, `session-hydration.ts` | Extract from `todo` tool results; read `rpiv-todo-state` custom entries on current branch | reads | Hydration currently drops `custom` entries |
| New daemon service (like `agent-ui-service.ts`) | Retains latest snapshot per agent; sweeps on archive/delete | owns | Both bootstraps (dev daemon uses mock) |
| `packages/client` (`PiStudioClient`) | `listAgentTodos`/`onAgentTodosUpdate`/`hasAgentTodosCapability` + reducer | consumes | Mirrors agent-ui facade |
| `packages/web-client` ChatPanel/Composer area | Todo panel above composer, per chat pane | renders | Collapse state in per-workspace UI storage |
| `AGENTS.md` (root + server) | Mirrored-internals list | docs | Re-check on Pi/rpiv-todo bump |

## Codebase context
| Area | Path(s) | Fact that matters |
|------|---------|-------------------|
| Extension | `packages/server/src/extensions/curated-packs.ts:43` | `npm:@juicesharp/rpiv-todo` is a `core`-pack member, installed by the daemon (v2.15.0 locally) |
| Extension widget | `rpiv-todo/todo-overlay.ts:65` | Panel uses factory-form `setWidget("rpiv-todos", factory, {placement:"aboveEditor"})` — TUI-only; never reaches RPC as `extension_ui_request` (s066/t006 finding, PLAN.md ~2196) |
| Extension state | `rpiv-todo/state/replay.ts` | Canonical state `{tasks:[{id,subject,status:pending\|in_progress\|completed\|deleted,description?,activeForm?,owner?,blockedBy?:number[],metadata?}], nextId}` persisted as `custom` session entries type `rpiv-todo-state` on EVERY change, plus `toolResult` `details` of tool `todo` |
| Daemon mapping | `providers/pi/event-mapper.ts` `mapToolCall`, `session-hydration.ts:117` | Tool results map to a closed `ToolCallDetail` union (shell/read/edit/write/search/fetch/task); `details` is read only for edit patch; `custom` entries are dropped on hydration |
| Wire | `packages/protocol/src/messages.ts:232` | `toolCallDetailSchema` is a closed discriminated union; append-only rule applies |
| Retained surfaces | `swe/features/extension-ui-rpc.md`, `agent-ui-service.ts`, `packages/client/src/agent-ui-state.ts` | Daemon+SDK retain `setStatus/setWidget(string[])/setTitle` per agent, no renderer in web-client (§09/§10 unbuilt) |
| UI spec | `swe/UI design/redesign 0.1.0/Extension Dialogs Visual Spec.html` §09–§10 | Widget block / status strip visual spec exists, generic (not todo-specific) |

## Happy path
1. Daemon has `rpiv-todo` (core pack); user prompts an agent in a chat pane.
2. Model calls the `todo` tool; Pi emits `tool_execution_end` with `details` `{tasks,nextId}`.
3. Pi adapter validates (D12) and pushes a snapshot into the provider-neutral todos channel (D14); the daemon service retains it per agent and broadcasts `agent_todos_update {agentId, seq, tasks}` (D15).
4. The chat pane for that agent shows the Todos panel above the composer (D5), expanded, with status icons, the in-progress `activeForm`, `n/m` in the header (D8–D10).
5. Further `todo` calls update the panel live; at turn end the daemon reconciles from the session file (D13).
6. User reloads the browser / daemon restarts: `agent_todos_list` rebuilds the panel from the current branch of the session file with no process spawn (D7, D16).
7. User forks/rewinds/navigates the tree: reconcile re-reads the branch; panel follows (D7, D13).

## Data & state
- Wire: `{agentId, seq, tasks: Task[]}` where `Task = {id, subject, status, description?, activeForm?, owner?, blockedBy?: number[]}` (`metadata` not forwarded; `nextId` not forwarded unless needed — TODO(verify)).
- Ownership: daemon service keeps latest snapshot per agent in memory only; never persisted in the agent record (D16). Source of truth = session file branch + live tool results.
- Lifecycle: swept on agent archive/delete; cleared snapshot (no non-deleted tasks) hides the panel.
- Client: reducer keyed by agentId, drops frames with seq ≤ last seen; collapse state per conversation in per-workspace UI storage.
- Existing data: sessions predating rpiv-todo state entries replay from `toolResult` `details` (as the extension does); no migration.

## Edge cases & failure modes
| Area | Condition | Decided behavior | Decision |
|------|-----------|------------------|----------|
| inputs | Malformed/unknown shape, wrong types, `tasks` truncated by another extension | Ignore the snapshot, keep last valid; no panel if none | D12 |
| inputs | Huge list / long subjects | Task cap (~200), length caps in validator, panel scrolls | D10, D15, D17 |
| inputs | Duplicate ids / dangling `blockedBy` | TODO(verify) — render as-is by id order; unknown blocker shown as plain `#n` | open |
| identity & access | Another extension registers a `todo` tool | Strict validator + custom-entry type check; ignored if shape mismatches | D12 |
| identity & access | Viewer without access to an agent | n/a — todos ride the existing per-connection auth; same visibility as `agent_ui_*` | D15 |
| state | All tasks `deleted` or list cleared | Snapshot empty ⇒ panel hidden | D5 |
| state | Fork / rewind / tree navigation | Reconcile re-reads current branch, new seq, panel follows; also triggered by `agent_timeline_reset` | D7, D13 |
| state | Compaction | State survives in custom entries; reconcile after compaction | D13 |
| state | Sub-agents | Own lists, not merged into parent | D11 |
| timing | `ctx.executeTool` writes never appear as `toolResult` | Caught by turn-end reconcile (live lag until then) | D13 |
| timing | Out-of-order / stale frames, multi-connection | Monotonic `seq` per agent; client drops stale; late joiner uses list | D15 |
| timing | Interrupt/abort mid-turn | Panel untouched; snapshot is agent-lifetime state | D8 |
| scale | Many agents with todos | Per-agent snapshot, small frames, broadcast to all connections | D15 |
| dependencies | Old daemon (no flag) / new daemon with old client | No panel / frames ignored (append-only) | D18 |
| dependencies | `rpiv-todo` not installed, deselected or removed | No entries ⇒ no panel; existing snapshot clears on next reconcile | D12, D13 |
| dependencies | rpiv-todo schema drift on upgrade | Validator rejects ⇒ panel disappears rather than lying; re-check on bump | D12 |
| data lifecycle | Session file missing/corrupt | List answers empty; log at warn; never throws to client | D16 |
| data lifecycle | Archived/deleted agent | Snapshot swept | D14 |
| observability & ops | Logging/rollback | Debug log on reject/reconcile; rollback = ignore frames, nothing persisted | D16, D18 |

## Non-functional constraints
| Concern | Constraint / decision |
|---------|-----------------------|
| Performance / volume | Full snapshot per change, ≤ ~200 tasks; session file read only on list/reconcile (not per tool end) |
| Security & authorization | Plain-text render (D17); same auth as other session messages |
| Privacy | Todo text may contain code/paths; travels only over the existing authenticated/E2EE channels; not logged at info |
| Backward compatibility | Append-only protocol; new optional capability flag; old clients ignore the push |
| Rollout / feature flag | `agentTodos` capability, ships on, no toggle (D18) |
| Observability | Debug logs for validate-reject and reconcile |
| Rollback | Nothing persisted; revert = panel gone |

## Deferred
- CLI `pi-studio agent todos <id>` (D19).
- Screen-reader live announcements per task change (D19).
- User editing of tasks / write-back (D4).
- Nested display of sub-agent todos (D11).
- Markdown rendering of task text (D17).
- Generic §09/§10 retained-surface renderer (separate, unplanned).
- Right dock / todo tab kind (D3 superseded).

## Open questions — TODO(verify)
- [ ] Confirm real Pi emits `tool_execution_end` for `todo` with `result.details = {tasks,nextId}` over RPC (mapToolCall already reads `result.details` for edit) — owner: implementer, sprint t001 spike.
- [ ] Confirm `rpiv-todo-state` custom entries are present in `SessionManager.getBranch()` output with `type:"custom"`/`customType` — owner: implementer, t001 spike.
- [ ] Decide whether `nextId` is forwarded on the wire — owner: scope.
- [ ] Duplicate-id / dangling `blockedBy` rendering — owner: scope (non-blocking).

## Acceptance criteria (draft)
- [ ] Given an agent with `rpiv-todo` whose model calls `todo`, when the call completes, then the chat pane shows the panel above the composer within one frame of the push, with correct statuses and `n/m`.
- [ ] Given an in-progress task, then the collapsed header shows its `activeForm`.
- [ ] Given a browser reload or daemon restart, then the panel is restored from the session file with no agent process running.
- [ ] Given a fork/rewind/tree navigation, then the panel shows the list for the new branch.
- [ ] Given a todo change via `ctx.executeTool`, then the panel is correct after turn end.
- [ ] Given an invalid/foreign `todo` payload, then no panel appears and nothing throws.
- [ ] Given an old daemon without `agentTodos`, then no panel and no errors.
- [ ] Given two chat panes on two agents, then each shows only its own list; sub-agent lists are not merged.
- [ ] Given >5 completed tasks and a long list, then completed are grouped collapsed and the panel scrolls within ~40% of pane height.
- [ ] Given task text containing markdown/HTML, then it renders as literal text.
- [ ] Given the mock provider, a scripted todo emission drives the full UI on the dev daemon.

## Round log
| Round | Theme | Summary |
|-------|-------|---------|
| 1 | problem, scope, source, placement | D1-D4 decided; recon showed widget path is dead, state lives in tool details/custom entries |
| 2 | placement revisit, transport, truth source | D3 superseded (panel above composer); D5-D7 |
| 3 | panel behavior | D8-D11 |
| 4 | integration & timing | D12-D15; integration table filled |
| 5 | edge cases, security, rollout, surfaces | D16-D19; edge-case table, NFRs, deferred, acceptance drafted |

## Handoff to scope
| Spec file to produce | Fed by brief sections |
|----------------------|-----------------------|
| `swe/features/agent-todos.md` | Goals, Happy path, Decisions, Edge cases, Acceptance criteria, Deferred |
| `swe/features/agent-todos-ui.md` (web panel) | D3, D5, D8–D11, D17, Acceptance |
| `swe/architecture/` update (extension-ui / websocket-protocol) | Integration points, Data & state, NFRs, D12–D16 |
